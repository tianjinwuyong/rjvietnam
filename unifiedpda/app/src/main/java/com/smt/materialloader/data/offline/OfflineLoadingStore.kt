package com.smt.materialloader.data.offline

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import com.google.gson.Gson
import com.google.gson.JsonObject
import java.security.MessageDigest
import java.time.Instant
import java.time.LocalDate
import java.util.UUID

data class OfflineBindingResult(
    val eventId: String,
    val materialCode: String,
    val lotNo: String,
    val allowed: Boolean,
    val reason: String
)

class OfflineLoadingStore(context: Context) :
    SQLiteOpenHelper(context, "smt_pda_offline_loading.db", null, 1) {

    private val gson = Gson()

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            """CREATE TABLE lease_cache(
              lease_id TEXT PRIMARY KEY, work_order_code TEXT NOT NULL, line_code TEXT NOT NULL,
              machine_code TEXT NOT NULL, device_id TEXT NOT NULL, operator_badge TEXT NOT NULL,
              issued_at TEXT NOT NULL, expires_at TEXT NOT NULL, disconnected_at TEXT,
              cache_version TEXT NOT NULL, rule_version TEXT NOT NULL)"""
        )
        db.execSQL(
            """CREATE TABLE lot_cache(
              material_sn TEXT PRIMARY KEY, lot_no TEXT NOT NULL, material_code TEXT NOT NULL,
              available_qty REAL NOT NULL, iqc_status TEXT NOT NULL, lot_status TEXT NOT NULL,
              lifecycle_status TEXT NOT NULL, expiry_date TEXT, opened_at TEXT,
              opened_shelf_life_days INTEGER, baking_required INTEGER NOT NULL,
              baking_status TEXT)"""
        )
        db.execSQL(
            """CREATE TABLE slot_cache(
              slot_no TEXT PRIMARY KEY, material_code TEXT, feeder_width TEXT)"""
        )
        db.execSQL(
            """CREATE TABLE offline_queue(
              event_id TEXT PRIMARY KEY, sequence_no INTEGER NOT NULL UNIQUE,
              previous_hash TEXT, record_hash TEXT NOT NULL, payload_json TEXT NOT NULL,
              state TEXT NOT NULL DEFAULT 'PENDING', attempts INTEGER NOT NULL DEFAULT 0,
              last_error TEXT, created_at TEXT NOT NULL)"""
        )
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) = Unit

    fun saveSnapshot(data: JsonObject, workOrder: String, machine: String, device: String, operator: String) {
        val db = writableDatabase
        db.beginTransaction()
        try {
            db.delete("lease_cache", null, null)
            db.delete("lot_cache", null, null)
            db.delete("slot_cache", null, null)
            val lease = ContentValues().apply {
                put("lease_id", data["leaseId"].asString)
                put("work_order_code", workOrder)
                put("line_code", "L001")
                put("machine_code", machine)
                put("device_id", device)
                put("operator_badge", operator)
                put("issued_at", data["issuedAt"].asString)
                put("expires_at", data["expiresAt"].asString)
                put("cache_version", data["cacheVersion"].asString)
                put("rule_version", data["ruleVersion"].asString)
            }
            db.insertOrThrow("lease_cache", null, lease)
            data.getAsJsonArray("lots")?.forEach { element ->
                val row = element.asJsonObject
                db.insertOrThrow("lot_cache", null, ContentValues().apply {
                    put("material_sn", row["materialSn"].asString)
                    put("lot_no", row["lotNo"].asString)
                    put("material_code", row["materialCode"].asString)
                    put("available_qty", row["availableQty"].asDouble)
                    put("iqc_status", row["iqcStatus"].asString)
                    put("lot_status", row["lotStatus"].asString)
                    put("lifecycle_status", row["lifecycleStatus"].asString)
                    if (!row["expiryDate"].isJsonNull) put("expiry_date", row["expiryDate"].asString)
                    if (!row["openedAt"].isJsonNull) put("opened_at", row["openedAt"].asString)
                    if (!row["openedShelfLifeDays"].isJsonNull) put("opened_shelf_life_days", row["openedShelfLifeDays"].asInt)
                    put("baking_required", if (row["bakingRequired"].asBoolean) 1 else 0)
                    if (!row["bakingStatus"].isJsonNull) put("baking_status", row["bakingStatus"].asString)
                })
            }
            data.getAsJsonArray("slots")?.forEach { element ->
                val row = element.asJsonObject
                db.insertOrThrow("slot_cache", null, ContentValues().apply {
                    put("slot_no", row["slotNo"].asString)
                    if (!row["materialCode"].isJsonNull) put("material_code", row["materialCode"].asString)
                    if (!row["feederWidth"].isJsonNull) put("feeder_width", row["feederWidth"].asString)
                })
            }
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    fun markDisconnected() {
        writableDatabase.execSQL(
            "UPDATE lease_cache SET disconnected_at=COALESCE(disconnected_at,?)",
            arrayOf(Instant.now().toString())
        )
    }

    fun validateAndQueue(
        workOrder: String,
        machine: String,
        slot: String,
        feeder: String,
        rawMaterialScan: String,
        qty: Double,
        operator: String,
        deviceId: String,
        appVersion: String
    ): OfflineBindingResult {
        val db = writableDatabase
        val lease = db.rawQuery("SELECT * FROM lease_cache LIMIT 1", null).use { c ->
            if (!c.moveToFirst()) return OfflineBindingResult("", "", "", false, "没有MES离线授权缓存")
            (0 until c.columnCount).associate { c.getColumnName(it) to c.getString(it) }
        }
        val now = Instant.now()
        if (lease["work_order_code"] != workOrder || lease["machine_code"] != machine ||
            lease["device_id"] != deviceId || now.isAfter(Instant.parse(lease["expires_at"]))) {
            return OfflineBindingResult("", "", "", false, "离线授权不匹配或已超过30分钟")
        }
        val lot = db.rawQuery("SELECT * FROM lot_cache WHERE material_sn=?", arrayOf(rawMaterialScan)).use { c ->
            if (!c.moveToFirst()) return OfflineBindingResult("", "", "", false, "本地缓存找不到该料盘，禁止上料")
            (0 until c.columnCount).associate { c.getColumnName(it) to c.getString(it) }
        }
        val expected = db.rawQuery("SELECT material_code FROM slot_cache WHERE slot_no=?", arrayOf(slot)).use { c ->
            if (c.moveToFirst()) c.getString(0) else null
        }
        val floorExpiry = if (!lot["opened_at"].isNullOrBlank() &&
            (lot["opened_shelf_life_days"]?.toLongOrNull() ?: 0) > 0) {
            Instant.parse(lot["opened_at"]).plusSeconds(
                lot["opened_shelf_life_days"]!!.toLong() * 86400
            )
        } else null
        val checks = linkedMapOf(
            "IQC_RELEASED" to (lot["iqc_status"] == "released"),
            "LIFECYCLE_USABLE" to (lot["lot_status"] == "open" &&
                lot["lifecycle_status"]?.uppercase() !in setOf("EXPIRED","SCRAPPED","RETURNED","QUARANTINED","ISOLATED")),
            "QUANTITY_AVAILABLE" to ((lot["available_qty"]?.toDoubleOrNull() ?: 0.0) >= qty),
            "BOM_AND_SLOT_MATCH" to (expected == null || expected == lot["material_code"]),
            "NOT_EXPIRED" to (lot["expiry_date"].isNullOrBlank() ||
                LocalDate.parse(lot["expiry_date"]?.take(10)).isAfter(LocalDate.now())),
            "MSD_VALID" to ((floorExpiry == null || floorExpiry.isAfter(now)) &&
                (lot["baking_required"] != "1" || lot["baking_status"]?.uppercase() == "PASS"))
        )
        val failed = checks.filterValues { !it }.keys
        if (failed.isNotEmpty()) {
            return OfflineBindingResult("", lot["material_code"].orEmpty(), lot["lot_no"].orEmpty(), false,
                "离线质量门阻断：${failed.joinToString(",")}")
        }
        val sequence = db.rawQuery("SELECT COALESCE(MAX(sequence_no),0)+1 FROM offline_queue", null)
            .use { it.moveToFirst(); it.getLong(0) }
        val previousHash = db.rawQuery("SELECT record_hash FROM offline_queue ORDER BY sequence_no DESC LIMIT 1", null)
            .use { if (it.moveToFirst()) it.getString(0) else "" }
        val eventId = UUID.randomUUID().toString()
        val occurredAt = now.toString()
        val disconnectedAt = lease["disconnected_at"] ?: occurredAt
        val canonicalQty = if (qty % 1.0 == 0.0) qty.toLong().toString() else qty.toString()
        val canonical = listOf(
            eventId, lease["lease_id"], sequence, workOrder, machine, slot, feeder,
            rawMaterialScan, lot["material_code"], lot["lot_no"], canonicalQty, operator, deviceId,
            occurredAt, previousHash
        ).joinToString("|")
        val recordHash = sha256(canonical)
        val payload = linkedMapOf<String, Any?>(
            "eventId" to eventId, "leaseId" to lease["lease_id"], "sequenceNo" to sequence,
            "previousHash" to previousHash, "recordHash" to recordHash,
            "workOrderCode" to workOrder, "lineCode" to "L001", "machineCode" to machine,
            "slotNo" to slot, "feederCode" to feeder, "rawMaterialScan" to rawMaterialScan,
            "materialCode" to lot["material_code"], "lotNo" to lot["lot_no"], "qty" to qty,
            "operatorBadge" to operator, "deviceId" to deviceId, "appVersion" to appVersion,
            "ruleVersion" to lease["rule_version"], "cacheVersion" to lease["cache_version"],
            "sourceOccurredAt" to occurredAt, "disconnectedAt" to disconnectedAt,
            "localChecks" to checks.map { mapOf("code" to it.key, "pass" to it.value) }
        )
        db.insertOrThrow("offline_queue", null, ContentValues().apply {
            put("event_id", eventId); put("sequence_no", sequence); put("previous_hash", previousHash)
            put("record_hash", recordHash); put("payload_json", gson.toJson(payload))
            put("created_at", occurredAt)
        })
        return OfflineBindingResult(eventId, lot["material_code"].orEmpty(), lot["lot_no"].orEmpty(), true, "离线上料已记录，等待MES复核")
    }

    fun pendingPayloads(): List<JsonObject> =
        readableDatabase.rawQuery(
            "SELECT payload_json FROM offline_queue WHERE state='PENDING' ORDER BY sequence_no", null
        ).use { c ->
            buildList {
                while (c.moveToNext()) add(gson.fromJson(c.getString(0), JsonObject::class.java))
            }
        }

    fun markSynced(eventIds: List<String>) {
        val db = writableDatabase
        eventIds.forEach { id ->
            db.execSQL("UPDATE offline_queue SET state='SYNCED',attempts=attempts+1,last_error=NULL WHERE event_id=?", arrayOf(id))
        }
    }

    private fun sha256(value: String): String =
        MessageDigest.getInstance("SHA-256").digest(value.toByteArray())
            .joinToString("") { "%02x".format(it) }
}
