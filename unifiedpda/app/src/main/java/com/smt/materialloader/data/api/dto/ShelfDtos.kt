package com.smt.materialloader.data.api.dto

import com.google.gson.annotations.SerializedName

// ── Shelf Types ──────────────────────────────────────────────────

enum class CellStatus {
    @SerializedName("empty") EMPTY,
    @SerializedName("occupied") OCCUPIED,
    @SerializedName("reserved") RESERVED,
    @SerializedName("fault") FAULT
}

enum class ShelfConnectionStatus {
    @SerializedName("online") ONLINE,
    @SerializedName("offline") OFFLINE,
    @SerializedName("fault") FAULT
}

enum class ShelfAction {
    @SerializedName("SHELF_IN") SHELF_IN,
    @SerializedName("SHELF_OUT") SHELF_OUT,
    @SerializedName("LIGHT_ON") LIGHT_ON,
    @SerializedName("LIGHT_OFF") LIGHT_OFF,
    @SerializedName("LABEL_REMOVE") LABEL_REMOVE
}

data class SmartRack(
    @SerializedName("shelfCode") val shelfCode: String,
    @SerializedName("totalCells") val totalCells: Int,
    @SerializedName("emptyCount") val emptyCount: Int,
    @SerializedName("occupiedCount") val occupiedCount: Int,
    @SerializedName("reservedCount") val reservedCount: Int,
    @SerializedName("faultCount") val faultCount: Int,
    @SerializedName("connectionStatus") val connectionStatus: ShelfConnectionStatus,
    @SerializedName("lastPingAt") val lastPingAt: String? = null
)

data class ShelfCell(
    @SerializedName("shelfCode") val shelfCode: String,
    @SerializedName("cellNumber") val cellNumber: String,
    @SerializedName("cellLabel") val cellLabel: String,
    @SerializedName("storageLocationId") val storageLocationId: Int? = null,
    @SerializedName("materialLotId") val materialLotId: Int? = null,
    @SerializedName("materialCode") val materialCode: String? = null,
    @SerializedName("materialName") val materialName: String? = null,
    @SerializedName("lotNo") val lotNo: String? = null,
    @SerializedName("labelId") val labelId: String? = null,
    @SerializedName("cellStatus") val cellStatus: CellStatus,
    @SerializedName("qty") val qty: Int? = null,
    @SerializedName("supplierCode") val supplierCode: String? = null,
    @SerializedName("iqcStatus") val iqcStatus: String? = null
)

data class ShelfTransaction(
    @SerializedName("id") val id: String,
    @SerializedName("action") val action: ShelfAction,
    @SerializedName("shelfCode") val shelfCode: String,
    @SerializedName("cellNumber") val cellNumber: String? = null,
    @SerializedName("labelId") val labelId: String? = null,
    @SerializedName("materialCode") val materialCode: String? = null,
    @SerializedName("lotNo") val lotNo: String? = null,
    @SerializedName("qty") val qty: Int? = null,
    @SerializedName("operator") val operator: String,
    @SerializedName("result") val result: String,
    @SerializedName("occurredAt") val occurredAt: String,
    @SerializedName("errorMessage") val errorMessage: String? = null
)

data class ShelfDashboardSummary(
    @SerializedName("totalRacks") val totalRacks: Int,
    @SerializedName("onlineRacks") val onlineRacks: Int,
    @SerializedName("totalOccupiedCells") val totalOccupiedCells: Int,
    @SerializedName("totalEmptyCells") val totalEmptyCells: Int,
    @SerializedName("todayTransactions") val todayTransactions: Int
)

// ── API Request/Response ─────────────────────────────────────────

data class ShelfListResponse(
    @SerializedName("shelves") val shelves: List<SmartRack>,
    @SerializedName("summary") val summary: ShelfDashboardSummary
)

data class ShelfDetailResponse(
    @SerializedName("shelf") val shelf: SmartRack,
    @SerializedName("cells") val cells: List<ShelfCell>
)

data class ShelfInRequest(
    @SerializedName("labelId") val labelId: String,
    @SerializedName("shelfCode") val shelfCode: String,
    @SerializedName("cellNumber") val cellNumber: String,
    @SerializedName("materialCode") val materialCode: String,
    @SerializedName("lotNo") val lotNo: String,
    @SerializedName("qty") val qty: Int,
    @SerializedName("operator") val operator: String
)

data class ShelfOutRequest(
    @SerializedName("labelIds") val labelIds: List<String>,
    @SerializedName("shelfCode") val shelfCode: String,
    @SerializedName("cellNumbers") val cellNumbers: List<String>,
    @SerializedName("workOrderCode") val workOrderCode: String? = null,
    @SerializedName("operator") val operator: String
)

data class ShelfActionResponse(
    @SerializedName("success") val success: Boolean,
    @SerializedName("transactionId") val transactionId: String? = null,
    @SerializedName("message") val message: String
)

data class TransactionHistoryResponse(
    @SerializedName("transactions") val transactions: List<ShelfTransaction>,
    @SerializedName("total") val total: Int
)