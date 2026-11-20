package com.smt.materialloader.ui.receiving

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.smt.materialloader.MaterialLoaderApp
import com.smt.materialloader.BuildConfig
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONObject
import org.json.JSONArray
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import android.graphics.Bitmap
import android.util.Base64
import android.util.Log
import java.io.ByteArrayOutputStream
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import com.google.mlkit.vision.common.InputImage
import com.smt.materialloader.data.repository.SupplierMap
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.chinese.ChineseTextRecognizerOptions
import com.smt.materialloader.ui.components.MaterialLabelOcrParser

enum class ReceivingStep { MATERIAL, CONTAINERS, PRINT_LABELS, APPLY_LABELS, GENERATE_PALLET, QUANTITY, LOCATION, CERTIFICATE, REVIEW }

data class MaterialReceivingState(
    val step: ReceivingStep = ReceivingStep.MATERIAL,
    val language: String = "en",
    val materialCode: String = "",
    val internalMaterialCode: String = "",
    val msLevel: String = "",
    val referenceSn: String = "",
    val materialName: String = "",
    val specification: String = "",
    val supplier: String = "",
    val supplierBarcode: String = "",
    val purchaseOrder: String = "",
    val asn: String = "",
    val preReceivingManifestId: String = "",
    val lotNo: String = "",
    val palletCode: String = "",
    val palletType: String = "HIDDEN_AUTO",
    val palletSize: String = "1100x1100x110 mm",
    val palletMaterial: String = "木材",
    val boxCode: String = "",
    val labelsPrinted: Boolean = false,
    val labelsApplied: Boolean = false,
    val scannedLabelCodes: List<String> = emptyList(),
    val materialSnCodes: List<String> = emptyList(),
    val outerBoxSns: List<String> = emptyList(),
    val subBoxSns: List<String> = emptyList(),
    val duplicateSns: List<String> = emptyList(),
    val mixedMaterialLines: List<String> = emptyList(),
    val passedSns: List<String> = emptyList(),
    val ngSns: List<String> = emptyList(),
    val missingSns: List<String> = emptyList(),
    val unexpectedSns: List<String> = emptyList(),
    val passedQuantity: String = "",
    val ngQuantity: String = "",
    val shortageQuantity: String = "0",
    val excessQuantity: String = "0",
    val damageImageDataUrls: List<String> = emptyList(),
    val receivingSyncStatus: String = "DRAFT",
    val receivingIdempotencyKey: String = UUID.randomUUID().toString(),
    val expectedQty: String = "",
    val receivedQty: String = "",
    val palletQuantity: String = "",
    val quantityPerBox: String = "",
    val boxCount: String = "",
    val boxNumber: String = "",
    val partialBox: Boolean = false,
    val manufactureDate: String = "",
    val expiryDate: String = "",
    val receiptDate: String = "",
    val unit: String = "PCS",
    val msdFloorLifeHours: String = "",
    val ulCode: String = "",
    val invoice: String = "",
    val location: String = "",
    val areaQr: String = "",
    val locationMap: Map<String, List<String>> = emptyMap(),
    val warehouseAreas: List<WarehouseArea> = emptyList(),
    val showAreaDialog: Boolean = false,
    val lockedArea: String = "",
    val showLocationDialog: Boolean = false,
    val positionBoxCounts: Map<String, Int> = emptyMap(),
    val activePosition: String = "",
    val bindingResult: String = "",
    val voicePrompt: String = "",
    val nextScanRequested: Boolean = false,
    /** Lock the scanner when a duplicate box is detected; user must tap
     *  "继续扫描" (continueScanning) to manually re-arm. */
    val dupLocked: Boolean = false,
    /** Box QRs already bound in this receiving session (local dup guard). */
    val boundBoxQrs: List<String> = emptyList(),
    /** Raw text of the most recent scan — the exact dup key. */
    val lastScanRaw: String = "",
    val showCertificateSection: Boolean = false,
    val areaLoadError: String? = null,
    val allStorageLocations: List<StorageLocationItem> = emptyList(),
    val areaPalletMap: Map<String, List<String>> = emptyMap(),
    val areaPalletQrMap: Map<String, Map<String, String>> = emptyMap(),
    val pdaX: String = "",
    val pdaY: String = "",
    val pdaAccuracy: String = "",
    val iqc: String = "pending",
    val certificatePhotoCount: Int = 0,
    val submitted: Boolean = false
    ,val aiStatus: String = "",
    val ocrParseFailed: Boolean = false,
    val labelImageDataUrl: String = "",
    val labelImageCount: Int = 0,
    val ocrAttemptCount: Int = 0,
    val lastLabelCapturedAt: Long = 0L
    ,val inputMethod: String = ""
    ,val labelImagePending: Boolean = false
    ,val workflowStage: String = "AREA_SCAN"
)

data class WarehouseArea(
    val area: String,
    val nameZh: String = "",
    val areaType: String = "",
    val areaId: String = "",
    val areaQr: String = "",
    val availableCount: Int = 0,
    val totalCount: Int = 0
)

data class StorageLocationItem(
    val code: String,
    val area: String,
    val nameZh: String,
    val allowReceiving: Boolean
)

class MaterialReceivingViewModel : ViewModel() {
    private val _state = MutableStateFlow(MaterialReceivingState())
    val state: StateFlow<MaterialReceivingState> = _state.asStateFlow()
    private var syncJob: Job? = null
    private var pendingLabelImage: Bitmap? = null

    fun markLabelParseFailed() {
        _state.value = _state.value.copy(aiStatus = "无法解析", ocrParseFailed = true)
    }

    fun captureLabelImage(image: Bitmap) {
        pendingLabelImage = image
        val previewOut = ByteArrayOutputStream()
        image.compress(Bitmap.CompressFormat.JPEG, 78, previewOut)
        val previewDataUrl = "data:image/jpeg;base64," + Base64.encodeToString(previewOut.toByteArray(), Base64.NO_WRAP)
        _state.value = _state.value.copy(
            labelImageDataUrl = previewDataUrl,
            labelImageCount = 0,
            ocrAttemptCount = _state.value.ocrAttemptCount + 1,
            lastLabelCapturedAt = System.currentTimeMillis(),
            labelImagePending = false,
            ocrParseFailed = false,
            aiStatus = "新图片已拍摄，正在自动发送到 WMS OCR…"
        )
        // OCR ownership is WMS. Run on-device MLKit Chinese recognition for
        // instant preview + localOcrText context; WMS vision/OCR stays authoritative.
        val recognizer = TextRecognition.getClient(ChineseTextRecognizerOptions.Builder().build())
        recognizer.process(InputImage.fromBitmap(image, 0))
            .addOnSuccessListener { result ->
                val parsed = MaterialLabelOcrParser.parse(result.text)
                _state.value = _state.value.copy(
                    materialCode = ocrFill(_state.value.materialCode, parsed.materialCode),
                    materialName = ocrFill(_state.value.materialName, parsed.materialName),
                    specification = ocrFill(_state.value.specification, parsed.specification),
                    supplier = ocrFill(_state.value.supplier, parsed.supplier),
                    purchaseOrder = ocrFill(_state.value.purchaseOrder, parsed.purchaseOrder),
                    lotNo = ocrFill(_state.value.lotNo, parsed.lot),
                    manufactureDate = ocrFill(_state.value.manufactureDate, parsed.manufactureDate),
                    expiryDate = ocrFill(_state.value.expiryDate, parsed.expiryDate),
                    receivedQty = ocrFill(_state.value.receivedQty, parsed.quantity?.toString()),
                    expectedQty = ocrFill(_state.value.expectedQty, parsed.quantity?.toString()),
                    quantityPerBox = ocrFill(_state.value.quantityPerBox, parsed.quantity?.toString()),
                    unit = ocrFill(_state.value.unit, parsed.unit),
                    ulCode = ocrFill(_state.value.ulCode, parsed.ulCode),
                    invoice = ocrFill(_state.value.invoice, parsed.invoice),
                    inputMethod = "MLKIT_OCR"
                )
                analyzeLabelImage(image, result.text)
            }
            .addOnFailureListener { analyzeLabelImage(image, "") }
            .addOnCompleteListener { recognizer.close() }
    }

    fun sendPendingLabelImage() {
        val image = pendingLabelImage ?: return
        _state.value = _state.value.copy(aiStatus = "正在发送图片到 WMS OCR…")
        analyzeLabelImage(image)
    }
    private var wmsDraftJob: Job? = null

    init {
        wmsDraftJob = viewModelScope.launch {
            var lastAt = 0L
            while (true) {
                runCatching {
                    val response = MaterialLoaderApp.instance.apiService.wmsReceivingLiveState()
                    val root = response.body()?.getAsJsonObject("data")
                    val at = root?.get("at")?.asLong ?: 0L
                    if (response.isSuccessful && at > lastAt) {
                        val data = root?.getAsJsonObject("payload")
                        if (data != null) {
                            lastAt = at
                            if (data.text("phase").equals("HEARTBEAT", ignoreCase = true)) return@runCatching
                            // The shared live-state can also contain this PDA's
                            // own upload. Only consume explicit WMS -> PDA data.
                            if (!data.text("source").equals("WMS_WEB", ignoreCase = true)) return@runCatching
                            val current = _state.value
                            _state.value = _state.value.copy(
                                materialCode = data.text("vietnamMaterialCode").ifBlank { data.text("materialCode") }.ifBlank { current.materialCode },
                                internalMaterialCode = data.text("ruijingMaterialCode").ifBlank { data.text("internalMaterialCode") }.ifBlank { current.internalMaterialCode },
                                materialName = data.text("materialName").ifBlank { current.materialName },
                                supplier = data.text("supplier").ifBlank { current.supplier },
                                receiptDate = data.text("receiptDate").ifBlank { current.receiptDate },
                                lotNo = data.text("lotNo").ifBlank { current.lotNo },
                                unit = data.text("unit").ifBlank { current.unit },
                                expectedQty = data.text("expectedQty").ifBlank { current.expectedQty },
                                receivedQty = data.text("receivedQty").ifBlank { current.receivedQty },
                                palletQuantity = data.text("palletQuantity").ifBlank { data.text("receivedQty") }.ifBlank { current.palletQuantity },
                                quantityPerBox = data.text("quantity").ifBlank { data.text("quantityPerBox") }.ifBlank { current.quantityPerBox },
                                palletCode = data.text("palletQr").ifBlank { current.palletCode },
                                palletType = data.text("palletType").ifBlank { _state.value.palletType },
                                palletSize = data.text("palletSize").ifBlank { _state.value.palletSize },
                                palletMaterial = data.text("palletMaterial").ifBlank { _state.value.palletMaterial },
                                boxCode = data.text("boxQr").ifBlank { current.boxCode },
                                location = data.text("storageLocation").ifBlank { data.text("locationCode") }.ifBlank { current.location },
                                areaQr = data.text("areaQr").ifBlank { data.text("floorAreaCode") }.ifBlank { _state.value.areaQr },
                                pdaX = data.text("pdaX").ifBlank { _state.value.pdaX },
                                pdaY = data.text("pdaY").ifBlank { _state.value.pdaY },
                                pdaAccuracy = data.text("pdaLocationAccuracyM").ifBlank { _state.value.pdaAccuracy },
                                msLevel = data.text("msdLevel").ifBlank { data.text("msLevel") },
                                msdFloorLifeHours = data.text("floorLifeHours").ifBlank { data.text("msdFloorLifeHours") },
                                iqc = data.text("iqcResult").ifBlank { "pending" },
                                workflowStage = data.text("workflowStage").ifBlank { _state.value.workflowStage },
                                aiStatus = if (current.ocrParseFailed) current.aiStatus else "WMS收料页面内容已实时同步到PDA"
                            )
                        }
                    }
                }
                delay(1000)
            }
        }
    }

    private fun com.google.gson.JsonObject.text(key: String): String =
        get(key)?.takeUnless { it.isJsonNull }?.toString()?.trim('"') ?: ""

    fun analyzeLabelImage(image: Bitmap, localOcrText: String = "") {
        Log.i("WmsReceivingOcr", "preparing OCR upload ${image.width}x${image.height}")
        _state.value = _state.value.copy(aiStatus = "Sending image to WMS...")
        viewModelScope.launch {
            runCatching {
                check(MaterialLoaderApp.instance.prefs.hasToken()) { "MES session required for WMS OCR" }
                // Camera frames can exceed the API's 8 MB base64 limit. Keep
                // the label readable while guaranteeing it can be uploaded.
                // Preserve small printed label characters for server-side WMS OCR.
                // The previous 1200px/JPEG-62 upload destroyed thin strokes.
                val scale = minOf(1f, 2400f / maxOf(image.width, image.height).toFloat())
                val uploadImage = if (scale < 1f) Bitmap.createScaledBitmap(
                    image, (image.width * scale).toInt(), (image.height * scale).toInt(), true
                ) else image
                val out = ByteArrayOutputStream()
                withContext(Dispatchers.Default) { uploadImage.compress(Bitmap.CompressFormat.JPEG, 90, out) }
                val imageDataUrl = "data:image/jpeg;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
                _state.value = _state.value.copy(
                    labelImageDataUrl = imageDataUrl,
                    labelImageCount = _state.value.labelImageCount + 1,
                    lastLabelCapturedAt = System.currentTimeMillis(),
                    aiStatus = "图片已保存，正在发送到WMS OCR..."
                )
                pendingLabelImage = null
                _state.value = _state.value.copy(labelImagePending = false)
                _state.value = _state.value.copy(aiStatus = "图片已发送到WMS，正在进行OCR...")
                val requestBody = mapOf("image" to imageDataUrl, "localOcrText" to localOcrText)
                Log.i("WmsReceivingOcr", "POST /api/wms/receiving/label-ai bytes=${out.size()}")
                var response = MaterialLoaderApp.instance.apiService.parseReceivingLabel(requestBody)
                Log.i("WmsReceivingOcr", "OCR response HTTP ${response.code()}")
                if (response.code() == 404) {
                    response = MaterialLoaderApp.instance.apiService.parseReceivingLabelLegacy(requestBody)
                }
                if (response.code() == 401) {
                    error("MES session expired; sign in again")
                }
                if (!response.isSuccessful) error("WMS image upload HTTP ${response.code()}")
                val data = response.body()?.getAsJsonObject("data") ?: error("WMS AI returned no data")
                val parseFailed = data.get("parseFailed")?.asBoolean == true
                if (parseFailed) {
                    _state.value = _state.value.copy(
                        aiStatus = "无法解析",
                        ocrParseFailed = true
                    )
                    return@runCatching
                }
                _state.value = _state.value.copy(
                    materialCode = ocrFill(_state.value.materialCode, data.stringOrNull("materialCode")),
                    internalMaterialCode = ocrFill(_state.value.internalMaterialCode, data.stringOrNull("ruijingMaterialCode")),
                    materialName = ocrFill(_state.value.materialName, data.stringOrNull("materialName")),
                    specification = ocrFill(_state.value.specification, data.stringOrNull("specification")),
                    supplier = ocrFill(_state.value.supplier, data.stringOrNull("supplier")),
                    purchaseOrder = ocrFill(_state.value.purchaseOrder, data.stringOrNull("purchaseOrder")),
                    lotNo = ocrFill(_state.value.lotNo, data.stringOrNull("lot")),
                    manufactureDate = ocrFill(_state.value.manufactureDate, data.stringOrNull("manufactureDate")),
                    expiryDate = ocrFill(_state.value.expiryDate, data.stringOrNull("expiryDate")),
                    receivedQty = ocrFill(_state.value.receivedQty, data.numberOrString("quantity")),
                    expectedQty = ocrFill(_state.value.expectedQty, data.numberOrString("quantity")),
                    quantityPerBox = ocrFill(_state.value.quantityPerBox, data.numberOrString("quantityPerBox")),
                    palletQuantity = ocrFill(_state.value.palletQuantity, data.numberOrString("quantity")),
                    boxNumber = ocrFill(_state.value.boxNumber, data.numberOrString("boxNumber")),
                    boxCode = ocrFill(_state.value.boxCode, data.stringOrNull("boxSn")),
                    msLevel = ocrFill(_state.value.msLevel, data.stringOrNull("msdLevel")),
                    msdFloorLifeHours = ocrFill(_state.value.msdFloorLifeHours, data.numberOrString("floorLifeHours")),
                    ulCode = ocrFill(_state.value.ulCode, data.stringOrNull("ulCode")),
                    invoice = ocrFill(_state.value.invoice, data.stringOrNull("invoice")),
                    inputMethod = "OCR_SUPPLEMENT",
                    ocrParseFailed = false,
                    aiStatus = if (parseFailed)
                        data.stringOrNull("parseMessage") ?: "标签解析不完整，请重新拍摄"
                    else
                        "WMS OCR 已自动完成并回填。置信度：${data.numberOrString("confidence") ?: "?"}"
                )
                syncToWms("wms-ollama-ai")
            }.onFailure {
                Log.e("WmsReceivingOcr", "OCR upload failed", it)
                _state.value = _state.value.copy(aiStatus = "无法解析", ocrParseFailed = true)
            }
        }
    }

    fun deleteLastLabelImage() {
        _state.value = _state.value.copy(
            labelImageDataUrl = "",
            labelImageCount = (_state.value.labelImageCount - 1).coerceAtLeast(0),
            lastLabelCapturedAt = 0L,
            aiStatus = "标签图片已删除，请重新拍摄。"
        )
    }

    fun markQrInput() {
        _state.value = _state.value.copy(inputMethod = "STANDARD_QR", aiStatus = "标准二维码已解读，数据已直接填入WMS收料表单。")
        syncToWms("standard-qr-complete")
    }

    private fun com.google.gson.JsonObject.stringOrNull(key: String): String? = get(key)?.takeUnless { it.isJsonNull }?.asString?.trim()?.takeIf { it.isNotEmpty() }
    private fun com.google.gson.JsonObject.numberOrString(key: String): String? = get(key)?.takeUnless { it.isJsonNull }?.toString()?.trim('"')?.takeIf { it.isNotEmpty() && it != "null" }
    // Latest confirmed OCR wins for any non-empty field; keep the old value only when the latest image did not contain that field.
    private fun ocrFill(current: String, candidate: String?): String = candidate?.trim()?.takeIf { it.isNotEmpty() } ?: current

    private fun workflowStage(s: MaterialReceivingState): String = when {
        s.location.isBlank() -> "LOCATION_SCAN"
        s.palletType.isBlank() -> "PALLET_TYPE"
        s.materialCode.isBlank() || s.lotNo.isBlank() -> "MATERIAL_INFO"
        s.boxCode.isBlank() && s.scannedLabelCodes.isEmpty() -> "BOX_SCAN"
        !s.labelsPrinted -> "LABEL_PRINT"
        !s.labelsApplied -> "LABEL_APPLY"
        s.palletCode.isBlank() -> "PALLET_QR"
        s.location.isBlank() -> "LOCATION_BIND"
        else -> "RECEIVING_COMPLETE"
    }

    private fun syncToWms(field: String) {
        syncJob?.cancel()
        syncJob = viewModelScope.launch {
            delay(250)
            val s = _state.value
            runCatching {
                val payload: Map<String, Any?> = mapOf(
                    "phase" to if (field == "receiving-complete") "COMPLETED" else "DRAFT",
                    "idempotencyKey" to s.receivingIdempotencyKey,
                    "workflowStage" to workflowStage(s),
                    "changedField" to field,
                    "inputMethod" to s.inputMethod,
                    "step" to s.step.name,
                    "materialCode" to s.materialCode,
                    "vietnamMaterialCode" to s.materialCode,
                    "internalMaterialCode" to s.internalMaterialCode,
                    "ruijingMaterialCode" to s.internalMaterialCode,
                    "materialId" to s.internalMaterialCode.ifBlank { s.materialCode },
                    "materialPalletRelation" to "ONE_MATERIAL_ID_TO_MANY_PALLETS",
                    "materialLotPalletKey" to "${s.internalMaterialCode.ifBlank { s.materialCode }}|${s.lotNo}|${s.palletCode}",
                    "msLevel" to s.msLevel,
                    "msdLevel" to s.msLevel,
                        "referenceSn" to s.referenceSn,
                    "materialName" to s.materialName,
                    "specification" to s.specification,
                    "supplier" to s.supplier,
                    "supplierBarcode" to s.supplierBarcode,
                    "purchaseOrder" to s.purchaseOrder,
                    "asn" to s.asn,
                    "preReceivingManifestId" to s.preReceivingManifestId,
                    "lotNo" to s.lotNo,
                    "palletQr" to s.palletCode,
                    "boxBindingTarget" to "PALLET",
                    "boxBindingBoxQr" to s.boxCode,
                    "boxBindingPalletQr" to s.palletCode,
                    "boxPalletBindingStatus" to if (s.boxCode.isNotBlank() && s.palletCode.isNotBlank()) "BOUND" else "PENDING",
                    "palletType" to s.palletType,
                    "palletSize" to s.palletSize,
                    "palletMaterial" to s.palletMaterial,
                    "boxQr" to s.boxCode,
                    "boxQrValues" to boxQrValues(),
                    "labelsPrinted" to s.labelsPrinted,
                    "labelsApplied" to s.labelsApplied,
                    "labelTotal" to (s.boxCount.toIntOrNull()?.coerceAtLeast(1) ?: 1),
                    "labelsScanned" to s.scannedLabelCodes,
                    "materialSnCodes" to s.materialSnCodes,
                    "outerBoxSns" to s.outerBoxSns,
                    "subBoxSns" to s.subBoxSns,
                    "duplicateSns" to s.duplicateSns,
                    "mixedMaterialLines" to s.mixedMaterialLines,
                    "passedSns" to s.passedSns,
                    "ngSns" to s.ngSns,
                    "missingSns" to s.missingSns,
                    "unexpectedSns" to s.unexpectedSns,
                    "passedQuantity" to s.passedQuantity,
                    "ngQuantity" to s.ngQuantity,
                    "shortageQuantity" to s.shortageQuantity,
                    "excessQuantity" to s.excessQuantity,
                    "damageImages" to s.damageImageDataUrls,
                    "receivingSyncStatus" to s.receivingSyncStatus,
                    "expectedQty" to s.expectedQty,
                    "receivedQty" to s.receivedQty,
                    "palletQuantity" to s.palletQuantity,
                    "totalPalletQuantity" to s.palletQuantity,
                    "quantityPerBox" to s.quantityPerBox,
                    "quantity" to s.quantityPerBox,
                    "boxCount" to s.boxCount,
                    "boxNumber" to s.boxNumber,
                    "partialBox" to s.partialBox,
                    "manufactureDate" to s.manufactureDate,
                    "expiryDate" to s.expiryDate,
                    "receiptDate" to s.receiptDate,
                    "unit" to s.unit,
                    "msdFloorLifeHours" to s.msdFloorLifeHours,
                    "locationCode" to s.location,
                    "locationQr" to s.location,
                    "storageLocation" to s.location,
                    "areaQr" to s.areaQr,
                    "receivingArea" to s.areaQr,
                    "locationBindingTarget" to "BOXES",
                    "locationBindingPalletQr" to s.palletCode,
                    "pdaX" to s.pdaX,
                    "pdaY" to s.pdaY,
                    "pdaLocationAccuracyM" to s.pdaAccuracy,
                    "floorLifeHours" to s.msdFloorLifeHours,
                    "iqcResult" to s.iqc,
                    "certificatePhotoCount" to s.certificatePhotoCount,
                    "imageDataUrl" to s.labelImageDataUrl,
                    "at" to System.currentTimeMillis()
                )
                val event: Map<String, Any?> = mapOf(
                    "from" to "unified_pda",
                    "to" to "wms_receiving",
                    "type" to "WMS_RECEIVING_PDA_ACTIVITY",
                    "stationCode" to "wms_receiving",
                    "payload" to payload
                )
                val response = MaterialLoaderApp.instance.apiService.postPdaEvent(event)
                if (!response.isSuccessful) error("WMS draft sync HTTP ${response.code()}")
                // Handle location map returned by WMS
                val json = response.body() ?: run { _state.value = _state.value.copy(locationMap = emptyMap()); return@launch }
                val area = json.get("area")?.asString?.takeIf { it.isNotBlank() } ?: ""
                val locationMapJson = json.getAsJsonObject("locationMap")
                if (area.isNotBlank() && locationMapJson != null) {
                    val map = mutableMapOf<String, MutableList<String>>()
                    locationMapJson.entrySet().forEach { (key, value) ->
                        if (value.isJsonArray) {
                            val list = mutableListOf<String>()
                            value.asJsonArray.forEach { elem ->
                                val code = elem.asJsonObject.get("code")?.asString ?: ""
                                if (code.isNotBlank()) list.add(code)
                            }
                            map[key] = list
                        }
                    }
                    _state.value = _state.value.copy(areaQr = area, locationMap = map)
                }
                if (field == "receiving-complete") {
                    val qrs = boxQrValues()
                    if (qrs.isEmpty()) error("No material QR is available for position binding")
                    var rejectedAny = false
                    var rejectMessage = ""
                    qrs.forEachIndexed { index, qr ->
                        val committed = MaterialLoaderApp.instance.apiService.commitReceivingBox(mapOf(
                            "idempotencyKey" to "${s.receivingIdempotencyKey}:$index",
                            "areaQr" to s.areaQr,
                            "palletQr" to s.palletCode,
                            "palletQrType" to "HIDDEN_INTERNAL",
                            "boxQr" to qr,
                            "sourceBoxQr" to s.materialSnCodes.getOrNull(index).orEmpty(),
                            "generatedCaseQr" to qr,
                            "caseQrValue" to qr,
                            "materialCode" to s.materialCode,
                            "vietnamMaterialCode" to s.materialCode,
                            "ruijingMaterialCode" to s.internalMaterialCode,
                            "materialName" to s.materialName,
                            "specification" to s.specification,
                            "lotNo" to s.lotNo,
                            "supplier" to s.supplier,
                            "purchaseOrder" to s.purchaseOrder,
                            "quantity" to s.quantityPerBox.toDoubleOrNull(),
                            "declaredQty" to s.quantityPerBox.toDoubleOrNull(),
                            "unit" to s.unit,
                            "locationQr" to s.location,
                            "msdLevel" to s.msLevel,
                            "msdFloorLifeHours" to s.msdFloorLifeHours.toDoubleOrNull(),
                            "iqcResult" to "PENDING",
                            "inventoryStatus" to "BOUND",
                            "queueStatus" to "BOUND",
                            "sourceType" to "POSITION_BINDING"
                        ))
                        // A duplicate box QR is a warning + registration rejection:
                        // the server enforces UNIQUE(box_qr) and returns 409
                        // BOX_ALREADY_BOUND. Record the rejection and continue with
                        // the next box — one bad QR must not abort the whole batch.
                        if (committed.code() == 409) {
                            rejectedAny = true
                            rejectMessage = "重复：箱 QR $qr 已被绑定，拒绝注册"
                            return@forEachIndexed
                        }
                        if (!committed.isSuccessful) error("WMS box receiving HTTP ${committed.code()}")
                        // Binding succeeded: increment the box count for the
                        // position that is currently being filled.
                        val posCode = positionCodeOf(s.location)
                        if (posCode.isNotEmpty()) {
                            val current = _state.value.positionBoxCounts
                            val next = current.toMutableMap()
                            next[posCode] = (next[posCode] ?: 0) + 1
                            _state.value = _state.value.copy(positionBoxCounts = next)
                        }
                    }
                    if (rejectedAny)
                        _state.value = _state.value.copy(
                            receivingSyncStatus = "DUPLICATE_REJECTED",
                            aiStatus = "重复，拒绝注册：$rejectMessage"
                        )
                    else
                        _state.value = _state.value.copy(receivingSyncStatus = "SYNCED", iqc = "pending", submitted = true)
                }
            }.onFailure { error ->
                if (field == "receiving-complete") {
                    // Preserve the duplicate-rejected state (a deliberate warning +
                    // reject), otherwise surface a plain retry state.
                    val s = _state.value
                    _state.value = if (s.receivingSyncStatus == "DUPLICATE_REJECTED")
                        s.copy(aiStatus = "重复，拒绝注册：${error.message}")
                    else
                        s.copy(receivingSyncStatus = "PENDING_RETRY", submitted = false, aiStatus = "WMS sync pending: ${error.message}")
                }
            }
        }
    }

    fun selectLocationFromMap(loc: String) {
        val area = _state.value.areaQr
        val qr = _state.value.areaPalletQrMap[area]?.get(loc)?.takeIf { it.isNotBlank() } ?: loc
        // New position = new scan session: clear any dup lock/result from the
        // previous session so the scanner is armed and accepts new QRs.
        _state.value = _state.value.copy(
            location = qr,
            activePosition = loc,
            locationMap = emptyMap(),
            showLocationDialog = false,
            dupLocked = false,
            bindingResult = "",
            boxCode = "",
            voicePrompt = "请扫箱码"
        )
    }

    // Clear a duplicate/rejected binding state so the operator can scan a new box
    // QR. Keeps the selected position, resets the result/voice prompt.
    fun resetForRescan() {
        _state.value = _state.value.copy(bindingResult = "", voicePrompt = "请扫箱码", boxCode = "")
    }

    fun consumeNextScan() {
        _state.value = _state.value.copy(nextScanRequested = false)
    }

    // Manual re-arm after a duplicate lock: clears the lock and the stale box,
    // then requests the next scan (the screen bumps its camera cycle).
    fun continueScanning() {
        _state.value = _state.value.copy(
            dupLocked = false,
            bindingResult = "",
            boxCode = "",
            voicePrompt = "请扫箱码",
            nextScanRequested = true
        )
    }

    // Full parsed box data for the duplicate warning: the COMPLETE QR content
    // first (so the operator sees exactly which code collided), then every
    // parsed field.
    private fun dupWarningText(s: MaterialReceivingState, boxCode: String): String {
        val lines = mutableListOf<String>()
        lines.add("重复箱码（整码内容）：")
        lines.add(s.lastScanRaw.ifBlank { boxCode })
        lines.add("────────────────")
        if (s.supplierBarcode.isNotBlank() || s.supplier.isNotBlank())
            lines.add("供应商：${listOf(s.supplierBarcode, s.supplier).filter { it.isNotBlank() }.joinToString(" / ")}")
        if (s.materialCode.isNotBlank()) lines.add("物料编码：${s.materialCode}")
        if (s.internalMaterialCode.isNotBlank()) lines.add("内部料号：${s.internalMaterialCode}")
        if (s.materialName.isNotBlank()) lines.add("物料名称：${s.materialName}")
        if (s.lotNo.isNotBlank()) lines.add("批次：${s.lotNo}")
        if (s.manufactureDate.isNotBlank()) lines.add("生产日期：${s.manufactureDate}")
        if (s.quantityPerBox.isNotBlank()) lines.add("数量：${s.quantityPerBox} ${s.unit}")
        if (s.referenceSn.isNotBlank()) lines.add("流水号：${s.referenceSn}")
        if (s.purchaseOrder.isNotBlank()) lines.add("PO：${s.purchaseOrder}")
        if (s.location.isNotBlank()) lines.add("库位：${s.location}")
        lines.add("点击绿色按钮继续扫描")
        return lines.joinToString("\n")
    }

    // Extract the short position code (e.g. "P01-01") from a full location QR
    // like "WMS-AREA:B01:F01:HOUTAI:P01-01" — or return it unchanged if it
    // already looks like a position code. Used as the box-count map key so each
    // position grid box can show how many boxes are bound to it.
    private fun positionCodeOf(locationQr: String): String {
        val v = locationQr.trim()
        if (v.isEmpty()) return ""
        val last = v.substringAfterLast(":").substringAfterLast(" ").trim()
        if (last.matches(Regex("^P\\d+-\\d+$"))) return last
        return last.uppercase()
    }
    fun language(value: String) { _state.value = _state.value.copy(language = value) }
    fun showAreaDialog() { _state.value = _state.value.copy(showAreaDialog = true) }
    fun hideAreaDialog() { _state.value = _state.value.copy(showAreaDialog = false) }
    fun unlockArea() { _state.value = _state.value.copy(lockedArea = "") }
    fun showLocationDialog() { _state.value = _state.value.copy(showLocationDialog = true) }
    fun hideLocationDialog() { _state.value = _state.value.copy(showLocationDialog = false) }

    // Load all warehouse areas from /api/3d/wms-control-state (14 floorAreas) + layout PALLETs for per-area positions
    fun loadWarehouseAreas() {
        val locked = _state.value.lockedArea
        // Locked area: skip picker, apply directly after fetch
        android.util.Log.d("MR-VM", "loadWarehouseAreas: locked='${locked}'")
        _state.value = _state.value.copy(showAreaDialog = locked.isBlank(), areaLoadError = null)
        viewModelScope.launch {
            runCatching {
                // Fetch all 3 endpoints in parallel
                val floorAreasResp = MaterialLoaderApp.instance.apiService.getWmsControlState()
                val storageResp = MaterialLoaderApp.instance.apiService.getStorageLocations()
                val layoutResp = MaterialLoaderApp.instance.apiService.getWmsLayout()
                if (!floorAreasResp.isSuccessful) {
                    android.util.Log.e("MR-VM", "loadWarehouseAreas: floorAreas not successful code=${floorAreasResp.code()}")
                    _state.value = _state.value.copy(areaLoadError = "HTTP ${floorAreasResp.code()}")
                    return@runCatching
                }
                val floorBody = floorAreasResp.body()
                if (floorBody == null) {
                    android.util.Log.e("MR-VM", "loadWarehouseAreas: floorAreas null body")
                    _state.value = _state.value.copy(areaLoadError = "empty body")
                    return@runCatching
                }
                val floorAreas = floorBody.getAsJsonObject("data")?.getAsJsonArray("floorAreas")
                if (floorAreas == null) {
                    android.util.Log.e("MR-VM", "loadWarehouseAreas: no floorAreas array")
                    _state.value = _state.value.copy(areaLoadError = "no floorAreas array")
                    return@runCatching
                }
                // Parse storage locations
                val locationItems = mutableListOf<StorageLocationItem>()
                if (storageResp.isSuccessful) {
                    val storageBody = storageResp.body()
                    val items = storageBody?.getAsJsonObject("data")?.getAsJsonArray("items")
                    if (items != null) {
                        for (i in 0 until items.size()) {
                            val obj = items.get(i).asJsonObject
                            val area = obj.get("area")?.asString ?: continue
                            val locationCode = obj.get("code")?.asString ?: continue
                            val allowReceiving = obj.get("allowReceiving")?.asBoolean ?: false
                            val nameZh = obj.get("name_zh")?.asString ?: obj.get("name_en")?.asString ?: ""
                            locationItems.add(StorageLocationItem(code = locationCode, area = area, nameZh = nameZh, allowReceiving = allowReceiving))
                        }
                    }
                }
                // Parse layout items — AREA.qrCode → AREA.id, PALLET.parentId → positions.
                // floorAreas.areaQr uses the same "WMS-AREA:..." scheme, so join by QR.
                val layoutAreaIdByQr = mutableMapOf<String, String>()
                val palletsByParent = mutableMapOf<String, MutableList<Pair<String, String>>>()
                if (layoutResp.isSuccessful) {
                    val layoutBody = layoutResp.body()
                    val items = layoutBody?.getAsJsonObject("data")?.getAsJsonArray("items")
                    if (items != null) {
                        for (i in 0 until items.size()) {
                            val obj = items.get(i).asJsonObject
                            val kind = obj.get("kind")?.asString ?: continue
                            if (kind == "AREA") {
                                val id = obj.get("id")?.asString ?: continue
                                val qr = obj.get("qrCode")?.asString ?: continue
                                layoutAreaIdByQr[qr] = id
                            }
                        }
                        for (i in 0 until items.size()) {
                            val obj = items.get(i).asJsonObject
                            val kind = obj.get("kind")?.asString ?: continue
                            if (kind != "PALLET") continue
                            val parentId = obj.get("parentId")?.asString ?: continue
                            val label = obj.get("label")?.asString ?: continue
                            // Display code, e.g. "新仓储区域 R1-C1 P01-01" -> "P01-01"
                            val positionCode = label.substringAfterLast(" ").trim()
                            val positionQr = obj.get("positionQrCode")?.asString
                                ?: obj.get("qrCode")?.asString ?: ""
                            if (positionCode.isNotEmpty()) {
                                palletsByParent.getOrPut(parentId) { mutableListOf() }.add(positionCode to positionQr)
                            }
                        }
                    }
                }
                // Parse floorAreas into WarehouseArea list, with per-area count from its own PALLETs
                val areaPallets = mutableMapOf<String, List<String>>()
                val areaPalletQrs = mutableMapOf<String, Map<String, String>>()
                val areas = (0 until floorAreas.size()).mapNotNull { i ->
                    val obj = floorAreas.get(i).asJsonObject
                    val areaCode = obj.get("areaCode")?.asString ?: return@mapNotNull null
                    val areaName = obj.get("areaName")?.asString ?: areaCode
                    val areaType = obj.get("areaType")?.asString ?: areaCode
                    val areaQr = obj.get("areaQr")?.asString ?: ""
                    val layoutId = layoutAreaIdByQr[areaQr] ?: ""
                    val pallets = (if (layoutId.isNotEmpty()) palletsByParent[layoutId] else null)
                        ?: palletsByParent[areaCode] ?: emptyList()
                    val codes = pallets.map { it.first }.sorted()
                    areaPallets[areaCode] = codes
                    areaPalletQrs[areaCode] = pallets.toMap()
                    WarehouseArea(
                        area = areaCode,
                        nameZh = areaName,
                        areaType = areaType,
                        areaId = layoutId,
                        areaQr = areaQr,
                        availableCount = codes.size,
                        totalCount = codes.size
                    )
                }
                android.util.Log.d("MR-VM", "loadWarehouseAreas: parsed ${areas.size} floorAreas, ${locationItems.size} storage locs, ${palletsByParent.size} layout area maps")
                _state.value = _state.value.copy(
                    warehouseAreas = areas,
                    allStorageLocations = locationItems,
                    areaPalletMap = areaPallets,
                    areaPalletQrMap = areaPalletQrs,
                    areaLoadError = null
                )
                val lockedNow = _state.value.lockedArea
                if (lockedNow.isNotBlank()) {
                    if (areas.any { it.area == lockedNow }) loadAreaLocations(lockedNow)
                    else _state.value = _state.value.copy(showAreaDialog = true)
                }
            }.onFailure { e ->
                android.util.Log.e("MR-VM", "loadWarehouseAreas FAILED: ${e.javaClass.simpleName}: ${e.message}", e)
                _state.value = _state.value.copy(areaLoadError = "${e.javaClass.simpleName}: ${e.message}")
            }
        }
    }

    // Load all positions in a specific area — layout PALLETs first, storage_locations by areaType as fallback
    fun loadAreaLocations(area: String) {
        val selectedArea = _state.value.warehouseAreas.find { it.area == area }
        val fromLayout = _state.value.areaPalletMap[area] ?: emptyList()
        val locations = if (fromLayout.isNotEmpty()) {
            fromLayout
        } else {
            val typeToMatch = selectedArea?.areaType ?: area
            _state.value.allStorageLocations
                .filter { it.area == typeToMatch && it.allowReceiving }
                .map { it.code }
                .sorted()
        }
        android.util.Log.d("MR-VM", "loadAreaLocations($area type=${selectedArea?.areaType}): ${locations.size} locations")
        _state.value = _state.value.copy(
            areaQr = area,
            lockedArea = area,
            locationMap = if (locations.isNotEmpty()) mapOf(area to locations) else emptyMap(),
            showLocationDialog = locations.isNotEmpty()
        )
    }
    fun material(code: String, lot: String) { _state.value = _state.value.copy(materialCode = code, lotNo = lot); syncToWms("material") }
    fun updateMaterialField(field: String, value: String) {
        if (field == "areaQr" && value.trim().isNotBlank() && value.trim() != _state.value.areaQr.trim()) {
            val currentLanguage = _state.value.language
            _state.value = MaterialReceivingState(language = currentLanguage, areaQr = value.trim(), lockedArea = value.trim())
            pendingLabelImage = null
            syncToWms("areaQr")
            return
        }
        val next = when (field) {
            "code" -> _state.value.copy(materialCode = value)
            "internalCode" -> _state.value.copy(internalMaterialCode = value)
            "msLevel" -> _state.value.copy(msLevel = value)
            "referenceSn" -> _state.value.copy(referenceSn = value)
            "name" -> _state.value.copy(materialName = value)
            "specification" -> _state.value.copy(specification = value)
            "supplier" -> _state.value.copy(supplier = value)
            "supplierBarcode" -> _state.value.copy(supplierBarcode = value)
            "po" -> _state.value.copy(purchaseOrder = value)
            "asn" -> _state.value.copy(asn = value)
            "manifestId" -> _state.value.copy(preReceivingManifestId = value)
            "lot" -> _state.value.copy(lotNo = value)
            "manufactureDate" -> _state.value.copy(manufactureDate = value)
            "expiryDate" -> _state.value.copy(expiryDate = value)
            "receiptDate" -> _state.value.copy(receiptDate = value)
            "expected" -> _state.value.copy(expectedQty = value)
            "received" -> _state.value.copy(receivedQty = value)
            "palletQuantity" -> _state.value.copy(palletQuantity = value)
            "quantityPerBox" -> _state.value.copy(quantityPerBox = value)
            "boxCount" -> _state.value.copy(boxCount = value)
            "boxNumber" -> _state.value.copy(boxNumber = value)
            "partialBox" -> _state.value.copy(partialBox = value.equals("true", ignoreCase = true))
            "pallet" -> _state.value.copy(palletCode = value)
            "palletType" -> _state.value.copy(palletType = value)
            "palletSize" -> _state.value.copy(palletSize = value)
            "palletMaterial" -> _state.value.copy(palletMaterial = value)
            "box" -> {
                val code = value.trim(); val known = _state.value.outerBoxSns + _state.value.subBoxSns
                if (code.isBlank()) _state.value.copy(boxCode = value)
                else if (known.contains(code)) _state.value.copy(boxCode = code, duplicateSns = (_state.value.duplicateSns + code).distinct())
                else if (code.split('*').getOrNull(6).equals("SUB_BOX", ignoreCase = true) || code.contains("-S")) _state.value.copy(boxCode = code, subBoxSns = _state.value.subBoxSns + code)
                else _state.value.copy(boxCode = code, outerBoxSns = _state.value.outerBoxSns + code)
            }
            "location" -> _state.value.copy(location = value)
            "areaQr" -> _state.value.copy(areaQr = value)
            "pdaX" -> _state.value.copy(pdaX = value)
            "pdaY" -> _state.value.copy(pdaY = value)
            "pdaAccuracy" -> _state.value.copy(pdaAccuracy = value)
            "ulCode" -> _state.value.copy(ulCode = value)
            "invoice" -> _state.value.copy(invoice = value)
            "passedQuantity" -> _state.value.copy(passedQuantity = value)
            "ngQuantity" -> _state.value.copy(ngQuantity = value)
            "shortageQuantity" -> _state.value.copy(shortageQuantity = value)
            "excessQuantity" -> _state.value.copy(excessQuantity = value)
            else -> _state.value
        }
        val perBox = next.quantityPerBox.toDoubleOrNull()
        val boxes = next.boxCount.toIntOrNull()
        _state.value = if (perBox != null && perBox > 0 && boxes != null && boxes > 0) {
            val total = (perBox * boxes).toLong().toString()
            next.copy(expectedQty = total, receivedQty = total)
        } else next
        syncToWms(field)
    }
    fun applyMaterialRollQr(raw: String): Boolean {
        // Record the exact scan text FIRST for every branch — the dup guard and
        // the dup warning both use the COMPLETE QR content, never a sub-field.
        _state.value = _state.value.copy(lastScanRaw = raw.trim())
        // v2 is the generated material-label payload. Keep the legacy parser
        // below so labels already printed in the factory remain usable.
        val structured = runCatching { JSONObject(raw.trim()) }.getOrNull()
        if (structured?.optString("schema") == "ruijing.material-roll.v2") {
            val quantity = structured.optDouble("quantity", Double.NaN)
            if (quantity.isNaN()) return false
            fun value(key: String): String = structured.optString(key).trim()
            _state.value = _state.value.copy(
                materialCode = value("materialCode").ifBlank { _state.value.materialCode },
                internalMaterialCode = value("internalCode").ifBlank { _state.value.internalMaterialCode },
                referenceSn = value("materialSn").ifBlank { _state.value.referenceSn },
                msLevel = value("msdLevel").ifBlank { _state.value.msLevel },
                materialName = value("materialName").ifBlank { _state.value.materialName },
                specification = value("specification").ifBlank { _state.value.specification },
                supplier = value("supplierName").ifBlank { _state.value.supplier },
                supplierBarcode = value("supplierBarcode").ifBlank { _state.value.supplierBarcode },
                purchaseOrder = value("purchaseOrder").ifBlank { _state.value.purchaseOrder },
                lotNo = value("lotNo").ifBlank { _state.value.lotNo },
                manufactureDate = (value("manufacturingDate").ifBlank { value("dateCode") }).ifBlank { _state.value.manufactureDate },
                expiryDate = value("expiryDate").ifBlank { _state.value.expiryDate },
                expectedQty = quantity.toString(),
                receivedQty = quantity.toString(),
                quantityPerBox = quantity.toString(),
                unit = value("unit").ifBlank { _state.value.unit },
                location = value("locationCode").ifBlank { _state.value.location },
                boxCode = value("boxQr").ifBlank { _state.value.boxCode }.ifBlank { raw.trim() }
            )
            syncToWms("material-roll-qr-v2")
            tryAutoBind()
            return true
        }
        val scanned = raw.trim()
        // Supplier label format used on the SMT rolls:
        // SM<barcode>|P<material>|Q<qty>|9D<date>|1T<lot>|R|2T<lot>|K<supplier>.
        if (scanned.contains('|')) {
            val tokens = scanned.split('|').map(String::trim).filter(String::isNotBlank)
            val first = tokens.firstOrNull().orEmpty()
            if (first.startsWith("SM", ignoreCase = true)) {
                val field = { prefix: String -> tokens.firstOrNull { it.startsWith(prefix, ignoreCase = true) }?.drop(prefix.length).orEmpty() }
                val quantity = field("Q").toDoubleOrNull()
                val code = field("P")
                val lot = field("1T").ifBlank { field("2T") }
                val date = field("9D")
                _state.value = _state.value.copy(
                    supplierBarcode = first,
                    materialCode = code.ifBlank { _state.value.materialCode },
                    lotNo = lot.ifBlank { _state.value.lotNo },
                    manufactureDate = date.ifBlank { _state.value.manufactureDate },
                    expectedQty = quantity?.toString() ?: _state.value.expectedQty,
                    receivedQty = quantity?.toString() ?: _state.value.receivedQty,
                    quantityPerBox = quantity?.toString() ?: _state.value.quantityPerBox,
                    supplier = field("K").ifBlank { _state.value.supplier }
                )
                syncToWms("supplier-label-qr")
                return code.isNotBlank() || quantity != null || date.isNotBlank()
            }
        }
        // Supplier label format: supplierCode*materialCode*manufactureDate*quantity*lotNo*serialNo
        // Example: A.001*0.00.00.00.0108L-HF*2026-4-28*5000*XS001*R001
        if (scanned.contains('*')) {
            val parts = scanned.split('*').map(String::trim)
            if (parts.size >= 6) {
                val quantity = parts.getOrNull(3)?.toDoubleOrNull()
                val materialCode = parts.getOrNull(1).orEmpty()
                // Supplier label: supplierCode*materialCode*date*qty*lot*serial.
                // Accept any supplier-code shape (A.101, SUP-T03, …) — the real
                // discriminators are a numeric qty at [3] and a material-code at [1].
                if (quantity != null && quantity > 0 && materialCode.matches(Regex("[0-9]+(\\.[0-9A-Za-z-]+)+"))) {
                    val lotNo = parts.getOrNull(4).orEmpty()
                    val rawDate = parts.getOrNull(2).orEmpty()
                    val manufactureDate = runCatching {
                        val d = java.time.LocalDate.parse(rawDate, java.time.format.DateTimeFormatter.ofPattern("yyyy-M-d"))
                        d.format(java.time.format.DateTimeFormatter.ISO_LOCAL_DATE)
                    }.getOrDefault(rawDate)
                    val supplierCode = parts[0]
                    val supplierName = SupplierMap.getName(supplierCode)
                    _state.value = _state.value.copy(
                        supplierBarcode = supplierCode,
                        // New scan always wins: keep the OLD supplier only when
                        // the new QR genuinely has none (fixes stale supplier
                        // leaking into every following box).
                        supplier = supplierName.ifBlank { _state.value.supplier },
                        materialCode = materialCode,
                        lotNo = lotNo.ifBlank { _state.value.lotNo },
                        manufactureDate = manufactureDate.ifBlank { _state.value.manufactureDate },
                        expectedQty = quantity?.toString().orEmpty(),
                        receivedQty = quantity?.toString().orEmpty(),
                        quantityPerBox = quantity?.toString().orEmpty(),
                        referenceSn = parts.getOrNull(5).orEmpty(),
                        lastScanRaw = scanned,
                        inputMethod = "SUPPLIER_LABEL_QR"
                    )
                    syncToWms("supplier-label-qr")
                    tryAutoBind()
                    return materialCode.isNotBlank() || quantity != null
                }
            }
            // Logistics label format: internalCode*lot*date*supplier*qty*barcode.
            val quantity = parts.getOrNull(4)?.toDoubleOrNull()
            if (parts.size >= 5 && (quantity != null || parts.getOrNull(1).orEmpty().isNotBlank())) {
                val rawLogDate = parts.getOrNull(2).orEmpty()
                val logDate = runCatching {
                    val d = java.time.LocalDate.parse(rawLogDate, java.time.format.DateTimeFormatter.ofPattern("yyyy-M-d"))
                    d.format(java.time.format.DateTimeFormatter.ISO_LOCAL_DATE)
                }.getOrDefault(rawLogDate)
                _state.value = _state.value.copy(
                    materialCode = "",
                    internalMaterialCode = parts[0],
                    materialName = "",
                    specification = "",
                    boxCode = parts.getOrNull(5).orEmpty(),
                    lotNo = parts.getOrNull(1).orEmpty(),
                    manufactureDate = logDate,
                    expiryDate = "",
                    supplier = parts.getOrNull(3).orEmpty(),
                    purchaseOrder = "",
                    expectedQty = quantity?.toString().orEmpty(),
                    receivedQty = quantity?.toString().orEmpty(),
                    quantityPerBox = quantity?.toString().orEmpty(),
                    supplierBarcode = parts.getOrNull(5).orEmpty(),
                    inputMethod = "STANDARD_QR"
                )
                syncToWms("logistics-label-qr")
                return true
            }
        }
        // Location QR: "前台 P01-02" (area + position) or just "P01-02" (position only)
        val locParts = scanned.split(' ').map(String::trim).filter(String::isNotBlank)
        if (locParts.size == 2 && locParts[1].matches(Regex("^[A-Z]?\\d+-\\d+$"))) {
            // "前台 P01-02"
            _state.value = _state.value.copy(
                areaQr = locParts[0],
                location = locParts[1],
                inputMethod = "LOCATION_QR"
            )
            syncToWms("location-qr")
            return true
        } else if (locParts.size == 1 && scanned.matches(Regex("^[A-Z]?\\d+-\\d+$"))) {
            // "P01-02"
            _state.value = _state.value.copy(
                location = scanned,
                inputMethod = "LOCATION_QR"
            )
            syncToWms("location-qr")
            return true
        }
        // Some labels encode only the material code in the QR.
        if (scanned.matches(Regex("[0-9]+(\\.[0-9A-Za-z-]+){3,}"))) {
            _state.value = _state.value.copy(materialCode = scanned)
            syncToWms("material-code-qr")
            return true
        }
        val parts = raw.trim().split('/').map(String::trim)
        if (parts.size < 4) return false
        val quantity = parts[3].toDoubleOrNull() ?: return false
        _state.value = _state.value.copy(
            materialCode = parts[0].ifBlank { _state.value.materialCode },
            referenceSn = parts.getOrNull(5).orEmpty().ifBlank { _state.value.referenceSn },
            internalMaterialCode = parts.getOrNull(6).orEmpty().ifBlank { _state.value.internalMaterialCode },
            msLevel = parts.getOrNull(4).orEmpty().ifBlank { _state.value.msLevel },
            lotNo = parts[1].ifBlank { _state.value.lotNo },
            manufactureDate = parts[2].ifBlank { _state.value.manufactureDate },
            expectedQty = quantity.toString(),
            receivedQty = quantity.toString(),
            quantityPerBox = quantity.toString()
        )
        syncToWms("material-roll-qr")
        return true
    }
    fun applyOcr(result: com.smt.materialloader.ui.components.MaterialLabelOcrResult) { _state.value = _state.value.copy(materialCode = result.materialCode ?: _state.value.materialCode, materialName = result.materialName ?: _state.value.materialName, specification = result.specification ?: _state.value.specification, supplier = result.supplier ?: _state.value.supplier, purchaseOrder = result.purchaseOrder ?: _state.value.purchaseOrder, lotNo = result.lot ?: _state.value.lotNo, manufactureDate = result.manufactureDate ?: _state.value.manufactureDate, expiryDate = result.expiryDate ?: _state.value.expiryDate, expectedQty = result.quantity?.toString() ?: _state.value.expectedQty, receivedQty = result.quantity?.toString() ?: _state.value.receivedQty, quantityPerBox = result.quantity?.toString() ?: _state.value.quantityPerBox, unit = result.unit ?: _state.value.unit, ulCode = result.ulCode ?: _state.value.ulCode, invoice = result.invoice ?: _state.value.invoice); syncToWms("ocr") }
    fun applyOcrField(field: String, result: com.smt.materialloader.ui.components.MaterialLabelOcrResult) {
        val value = when (field) {
            "code" -> result.materialCode
            "name" -> result.materialName
            "specification" -> result.specification
            "supplier" -> result.supplier
            "po" -> result.purchaseOrder
            "lot" -> result.lot
            "manufactureDate" -> result.manufactureDate
            "expiryDate" -> result.expiryDate
            "expected", "received" -> result.quantity?.toString()
            "ulCode" -> result.ulCode
            "invoice" -> result.invoice
            else -> null
        }
        if (!value.isNullOrBlank()) updateMaterialField(field, value)
    }
    fun containers(pallet: String, box: String) { _state.value = _state.value.copy(palletCode = pallet, boxCode = box); syncToWms("containers") }
    fun quantities(expected: String, received: String) { _state.value = _state.value.copy(expectedQty = expected, receivedQty = received); syncToWms("quantity") }
    fun addSameLabelBox() {
        val current = _state.value
        val quantityPerBox = current.quantityPerBox.toDoubleOrNull() ?: return
        if (quantityPerBox <= 0 || current.materialCode.isBlank() || current.lotNo.isBlank()) return
        val nextBoxCount = (current.boxCount.toIntOrNull() ?: 1) + 1
        val totalQuantity = quantityPerBox * nextBoxCount
        _state.value = current.copy(
            boxCount = nextBoxCount.toString(),
            boxNumber = nextBoxCount.toString(),
            palletQuantity = formatQuantity(totalQuantity),
            expectedQty = formatQuantity(totalQuantity),
            receivedQty = formatQuantity(totalQuantity),
            aiStatus = "同标签箱数已增加为 $nextBoxCount 箱"
        )
        syncToWms("same-label-box-added")
    }

    private fun formatQuantity(value: Double): String =
        if (value % 1.0 == 0.0) value.toLong().toString() else value.toString()

    fun location(value: String, iqc: String) { _state.value = _state.value.copy(location = value, iqc = iqc); syncToWms("location-or-iqc") }
    fun addCertificatePhoto() { _state.value = _state.value.copy(certificatePhotoCount = _state.value.certificatePhotoCount + 1) }
    fun uploadSupplierCertificate(image: Bitmap) {
        viewModelScope.launch {
            runCatching {
                val scale = minOf(1f, 1600f / maxOf(image.width, image.height).toFloat())
                val uploadImage = if (scale < 1f) Bitmap.createScaledBitmap(image, (image.width * scale).toInt(), (image.height * scale).toInt(), true) else image
                val out = ByteArrayOutputStream()
                withContext(Dispatchers.Default) { uploadImage.compress(Bitmap.CompressFormat.JPEG, 82, out) }
                val dataUrl = "data:image/jpeg;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
                val s = _state.value
                val response = MaterialLoaderApp.instance.apiService.postPdaEvent(mapOf(
                    "from" to "unified_pda", "to" to "wms_receiving", "type" to "WMS_RECEIVING_SUPPLIER_CERTIFICATE",
                    "stationCode" to "wms_receiving", "payload" to mapOf(
                        "materialCode" to s.materialCode, "lotNo" to s.lotNo, "boxQr" to s.boxCode,
                        "palletQr" to s.palletCode, "imageDataUrl" to dataUrl, "at" to System.currentTimeMillis()
                    )
                ))
                if (!response.isSuccessful) error("WMS certificate upload HTTP ${response.code()}")
                _state.value = _state.value.copy(certificatePhotoCount = _state.value.certificatePhotoCount + 1, aiStatus = "供应商质量证书已上传并留存 WMS")
            }.onFailure { error -> _state.value = _state.value.copy(aiStatus = "证书上传失败：${error.message}") }
        }
    }
    fun markLabelsPrinted() {
        val boxQrs = boxQrValues()
        _state.value = _state.value.copy(labelsPrinted = true, step = ReceivingStep.APPLY_LABELS)
        syncToWms("labels-printed")
        viewModelScope.launch {
            runCatching { MaterialLoaderApp.instance.apiService.postPdaEvent(mapOf(
                "from" to "unified_pda", "to" to "wms_receiving", "type" to "WMS_RECEIVING_PRINT_LABELS",
                "stationCode" to "wms_receiving", "payload" to mapOf(
                    "labelScope" to "BOXES_ONLY_HIDDEN_PALLET", "palletLabelCount" to 0,
                    "materialCode" to _state.value.materialCode,
                    "internalMaterialCode" to _state.value.internalMaterialCode,
                    "lotNo" to _state.value.lotNo,
                    "boxSns" to _state.value.materialSnCodes,
                    "boxQrValues" to boxQrs,
                    "inventoryRegistration" to "CREATE_OR_UPDATE_BOX_INVENTORY",
                    "boxLabelCount" to (_state.value.boxCount.toIntOrNull()?.coerceAtLeast(1) ?: 1),
                    "totalLabelCount" to (_state.value.boxCount.toIntOrNull()?.coerceAtLeast(1) ?: 1),
                    "at" to System.currentTimeMillis()
                )
            )) }
        }
    }
    fun boxQrValues(): List<String> {
        val s = _state.value
        val source = s.materialSnCodes.ifEmpty { listOf(s.boxCode) }.filter { it.isNotBlank() }
        return source.map { sn ->
            val safeSn = sn.trim().replace(" ", "-")
            "WMS-BOX:${s.internalMaterialCode.ifBlank { s.materialCode }}:${s.lotNo}:$safeSn"
        }
    }
    fun printCurrentBoxLabel() {
        val s = _state.value
        if (s.boxCode.isBlank()) return
        viewModelScope.launch {
            runCatching { MaterialLoaderApp.instance.apiService.postPdaEvent(mapOf(
                "from" to "unified_pda", "to" to "wms_receiving", "type" to "WMS_RECEIVING_PRINT_LABELS",
                "stationCode" to "wms_receiving", "payload" to mapOf(
                    "labelScope" to "SINGLE_BOX_REPRINT",
                    "boxQr" to s.boxCode,
                    "materialCode" to s.materialCode,
                    "internalMaterialCode" to s.internalMaterialCode,
                    "lotNo" to s.lotNo,
                    "boxLabelCount" to 1,
                    "totalLabelCount" to 1,
                    "at" to System.currentTimeMillis()
                )
            )) }
        }
    }
    fun markLabelsApplied(value: Boolean) {
        val hidden = if (value && _state.value.palletCode.isBlank()) "WMS-HIDDEN:${UUID.randomUUID()}" else _state.value.palletCode
        _state.value = _state.value.copy(labelsApplied = value, palletCode = hidden, step = if (value) ReceivingStep.QUANTITY else _state.value.step)
        syncToWms("labels-applied-hidden-pallet")
    }
    fun generatePalletQr() {
        if (_state.value.palletCode.isNotBlank()) return
        val qr = "WMS-PALLET:P${java.text.SimpleDateFormat("yyyyMMdd", java.util.Locale.US).format(java.util.Date())}-${UUID.randomUUID().toString().take(6).uppercase()}"
        _state.value = _state.value.copy(palletCode = qr, step = ReceivingStep.QUANTITY)
        syncToWms("pallet-qr-generated")
    }
    fun recordLabelScan(raw: String) {
        val code = raw.trim()
        if (code.isBlank() || _state.value.scannedLabelCodes.contains(code)) return
        _state.value = _state.value.copy(scannedLabelCodes = _state.value.scannedLabelCodes + code)
        syncToWms("label-scanned")
    }
    fun recordMaterialSn(raw: String) {
        val code = raw.trim()
        if (code.isBlank() || _state.value.materialSnCodes.contains(code)) return
        _state.value = _state.value.copy(materialSnCodes = _state.value.materialSnCodes + code)
        syncToWms("material-sn-scanned")
    }
    fun recordPackageSn(raw: String) {
        val code = raw.trim()
        if (code.isBlank()) return
        val known = _state.value.outerBoxSns + _state.value.subBoxSns
        if (known.contains(code)) {
            _state.value = _state.value.copy(duplicateSns = (_state.value.duplicateSns + code).distinct())
            syncToWms("duplicate-package-sn")
            return
        }
        val parts = code.split('*')
        val isSubBox = parts.getOrNull(6).equals("SUB_BOX", ignoreCase = true) || code.contains("-S")
        _state.value = if (isSubBox) _state.value.copy(subBoxSns = _state.value.subBoxSns + code) else _state.value.copy(outerBoxSns = _state.value.outerBoxSns + code)
        syncToWms(if (isSubBox) "sub-box-scanned" else "outer-box-scanned")
    }
    fun addCurrentMaterialToMixedPallet() {
        val s = _state.value
        val line = listOf(s.materialCode, s.lotNo, s.receivedQty, s.unit).joinToString("|")
        if (s.materialCode.isNotBlank() && !s.mixedMaterialLines.contains(line)) {
            _state.value = s.copy(mixedMaterialLines = s.mixedMaterialLines + line)
            syncToWms("mixed-material-added")
        }
    }
    fun updateSnReconciliation(kind: String, raw: String) {
        val values = raw.split(',', '\n', ';').map(String::trim).filter(String::isNotBlank).distinct()
        _state.value = when (kind) {
            "passed" -> _state.value.copy(passedSns = values)
            "ng" -> _state.value.copy(ngSns = values)
            "missing" -> _state.value.copy(missingSns = values)
            "unexpected" -> _state.value.copy(unexpectedSns = values)
            else -> _state.value
        }
        syncToWms("reconciliation-$kind")
    }
    fun uploadDamagePhoto(image: Bitmap) {
        viewModelScope.launch {
            runCatching {
                val scale = minOf(1f, 1600f / maxOf(image.width, image.height).toFloat())
                val upload = if (scale < 1f) Bitmap.createScaledBitmap(image, (image.width * scale).toInt(), (image.height * scale).toInt(), true) else image
                val out = ByteArrayOutputStream(); withContext(Dispatchers.Default) { upload.compress(Bitmap.CompressFormat.JPEG, 80, out) }
                val dataUrl = "data:image/jpeg;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
                _state.value = _state.value.copy(damageImageDataUrls = _state.value.damageImageDataUrls + dataUrl)
                syncToWms("damage-photo")
            }.onFailure { _state.value = _state.value.copy(aiStatus = "Damage image upload pending: ${it.message}") }
        }
    }
    fun retryReceivingSync() { syncToWms("receiving-complete") }
    fun next() {
        if (_state.value.step.ordinal >= ReceivingStep.REVIEW.ordinal) return
        val current = _state.value
        val next = if (current.step == ReceivingStep.APPLY_LABELS) ReceivingStep.QUANTITY else ReceivingStep.entries[current.step.ordinal + 1]
        _state.value = current.copy(step = next)
    }
    fun previous() {
        if (_state.value.step.ordinal <= 0) return
        val previous = if (_state.value.step == ReceivingStep.QUANTITY) ReceivingStep.APPLY_LABELS else ReceivingStep.entries[_state.value.step.ordinal - 1]
        _state.value = _state.value.copy(step = previous)
    }
    fun jumpToStep(step: ReceivingStep) { _state.value = _state.value.copy(step = step) }
    // One scan = one box = one binding. Submit ONLY the box that was just
    // scanned (s.boxCode) to the current working position (s.location). If the
    // WMS reports a duplicate (409) we warn + reject this box; otherwise the
    // binding succeeds, the position box count increments and a result is shown.
    fun bindCurrentBox() {
        val s = _state.value
        if (s.submitted) return
        if (s.location.isBlank()) return
        val boxCode = s.boxCode.ifBlank { s.referenceSn.ifBlank { s.materialCode } }
        if (boxCode.isBlank()) return
        val boxQrPreview = "WMS-BOX:${s.internalMaterialCode.ifBlank { s.materialCode }}:${s.lotNo}:${boxCode.trim().replace(" ", "-")}"
        // Local dup guard keyed on the EXACT raw scanned text: the same
        // physical box QR scanned twice is a dup; any different QR passes even
        // when material/lot look identical. Dup = warning only, NO binding,
        // NO lock — 3s warning then the scanner re-arms for the next box.
        val dupKey = s.lastScanRaw.ifBlank { boxQrPreview }
        if (_state.value.boundBoxQrs.contains(dupKey)) {
            _state.value = _state.value.copy(
                bindingResult = dupWarningText(s, boxCode),
                voicePrompt = "重复，请更换"
            )
            viewModelScope.launch {
                delay(3000)
                _state.value = _state.value.copy(boxCode = "", nextScanRequested = true)
            }
            return
        }
        viewModelScope.launch {
            runCatching {
                _state.value = _state.value.copy(bindingResult = "正在绑定...")
                val boxQr = "WMS-BOX:${s.internalMaterialCode.ifBlank { s.materialCode }}:${s.lotNo}:${boxCode.trim().replace(" ", "-")}"
                val committed = MaterialLoaderApp.instance.apiService.commitReceivingBox(mapOf(
                    "idempotencyKey" to "${s.receivingIdempotencyKey}:$boxCode",
                    "areaQr" to s.areaQr,
                    "palletQr" to s.palletCode.ifBlank { s.areaQr }.ifBlank { s.location },
                    "palletQrType" to "HIDDEN_INTERNAL",
                    "boxQr" to boxQr,
                    "sourceBoxQr" to boxCode,
                    "generatedCaseQr" to boxQr,
                    "caseQrValue" to boxQr,
                    "materialCode" to s.materialCode,
                    // Raw codes only — WMS owns the mapping tables and resolves
                    // supplier code -> name and Ruijing <-> Vietnam material
                    // codes. The PDA must not pre-resolve names.
                    "ruijingMaterialCode" to s.internalMaterialCode,
                    "materialName" to s.materialName,
                    "specification" to s.specification,
                    "lotNo" to s.lotNo,
                    "supplierCode" to s.supplierBarcode,
                    "supplier" to s.supplier,
                    "purchaseOrder" to s.purchaseOrder,
                    "quantity" to s.quantityPerBox.toDoubleOrNull(),
                    "declaredQty" to s.quantityPerBox.toDoubleOrNull(),
                    "unit" to s.unit,
                    "locationQr" to s.location,
                    "manufactureDate" to s.manufactureDate,
                    "msdLevel" to s.msLevel,
                    "msdFloorLifeHours" to s.msdFloorLifeHours.toDoubleOrNull(),
                    "iqcResult" to "PENDING",
                    "inventoryStatus" to "BOUND",
                    "queueStatus" to "BOUND",
                    "sourceType" to "POSITION_BINDING"
                ))
                if (committed.code() == 409) {
                    // Dup from WMS: warning only, NO lock — re-arm for the next box.
                    _state.value = _state.value.copy(
                        bindingResult = dupWarningText(s, boxCode),
                        voicePrompt = "重复，请更换"
                    )
                    delay(1500)
                    _state.value = _state.value.copy(boxCode = "", nextScanRequested = true)
                    return@launch
                }
                if (!committed.isSuccessful) error("WMS box receiving HTTP ${committed.code()}")
                val posCode = positionCodeOf(s.location)
                // Record the EXACT scan text as the dup key for this box.
                val newBound = _state.value.boundBoxQrs + dupKey
                if (posCode.isNotEmpty()) {
                    val next = _state.value.positionBoxCounts.toMutableMap()
                    next[posCode] = (next[posCode] ?: 0) + 1
                    _state.value = _state.value.copy(
                        positionBoxCounts = next,
                        bindingResult = "物料已收货（Material received）：$boxCode",
                        voicePrompt = "绑定成功",
                        boxCode = "",
                        boundBoxQrs = newBound,
                        nextScanRequested = true
                    )
                } else {
                    _state.value = _state.value.copy(bindingResult = "物料已收货（Material received）：$boxCode", voicePrompt = "绑定成功", boxCode = "", boundBoxQrs = newBound, nextScanRequested = true)
                }
            }.onFailure { e ->
                _state.value = _state.value.copy(bindingResult = "绑定失败：${e.message}")
                // Failure: show 1s, then auto-continue with the next box (never lock).
                delay(1000)
                _state.value = _state.value.copy(boxCode = "", nextScanRequested = true)
            }
        }
    }

    fun submit() {
        // Completion is only shown after WMS writes the box bindings; a local
        // "submitted" flag would fake a receipt the warehouse never committed.
        _state.value = _state.value.copy(receivingSyncStatus = "PENDING", aiStatus = "正在提交 WMS…")
        syncToWms("receiving-complete")
    }

    // Revoke ONLY the last box binding (PDA + WMS). The WMS deletes the newest
    // pallet-box binding row and the local position box count rolls back by one.
    fun revokeLastBinding() {
        viewModelScope.launch {
            runCatching {
                val resp = MaterialLoaderApp.instance.apiService.revokeLastReceivingBox()
                if (resp.code() == 404) {
                    _state.value = _state.value.copy(bindingResult = "没有可撤销的绑定", voicePrompt = "没有可撤销的绑定")
                    return@launch
                }
                if (!resp.isSuccessful) error("WMS revoke HTTP ${resp.code()}")
                val revokedQr = resp.body()?.getAsJsonObject("data")?.getAsJsonObject("revoked")?.get("locationQr")?.asString ?: ""
                // Roll back the bound position box count by one and drop the last
                // locally-tracked box so it can be re-bound after a revoke.
                val posCode = positionCodeOf(revokedQr.ifBlank { _state.value.location })
                val current = _state.value.positionBoxCounts
                val remaining = if (_state.value.boundBoxQrs.isNotEmpty()) _state.value.boundBoxQrs.dropLast(1) else _state.value.boundBoxQrs
                if (posCode.isNotEmpty() && (current[posCode] ?: 0) > 0) {
                    val next = current.toMutableMap()
                    next[posCode] = (next[posCode] ?: 0) - 1
                    _state.value = _state.value.copy(positionBoxCounts = next, boundBoxQrs = remaining, dupLocked = false, bindingResult = "取消成功，继续绑定", voicePrompt = "取消成功，继续绑定")
                } else {
                    _state.value = _state.value.copy(boundBoxQrs = remaining, dupLocked = false, bindingResult = "取消成功，继续绑定", voicePrompt = "取消成功，继续绑定")
                }
            }.onFailure { e ->
                _state.value = _state.value.copy(bindingResult = "撤销失败：${e.message}", voicePrompt = "撤销失败")
            }
        }
    }

    // Auto-binding: after a scan parses successfully and every binding field is
    // filled (material + lot + supplier + qty + box + location), bind this one
    // box immediately. One scan = one box = one binding.
    fun tryAutoBind() {
        val s = _state.value
        if (s.submitted) return
        // Single-screen flow runs in MATERIAL; also allow bind from LOCATION/REVIEW.
        if (s.step != ReceivingStep.MATERIAL && s.step != ReceivingStep.LOCATION && s.step != ReceivingStep.REVIEW) return
        val boxCode = s.boxCode.ifBlank { s.referenceSn.ifBlank { s.materialCode } }
        // Require every essential field before binding; if any is missing, do NOT
        // bind and prompt the operator to re-scan. Never claim "binding success"
        // when a field is absent.
        val missing = mutableListOf<String>().apply {
            if (s.materialCode.isBlank()) add("物料编码")
            if (s.lotNo.isBlank()) add("批次")
            if (s.supplier.isBlank()) add("供应商")
            if (s.manufactureDate.isBlank()) add("生产日期")
            if (s.quantityPerBox.toDoubleOrNull()?.let { it > 0 } != true) add("数量")
            if (boxCode.isBlank()) add("流水号/箱")
        }
        if (missing.isNotEmpty()) {
            _state.value = _state.value.copy(
                bindingResult = "字段缺失（${missing.joinToString("、")}），请重新扫描",
                voicePrompt = "字段缺失，请重新扫描"
            )
            // Never lock the camera: re-arm so the operator can scan again.
            viewModelScope.launch {
                delay(1500)
                _state.value = _state.value.copy(nextScanRequested = true)
            }
            return
        }
        if (s.location.isNotBlank()) bindCurrentBox()
    }
    fun clearDraft() { _state.value = MaterialReceivingState(language = _state.value.language) }
}
