package com.smt.materialloader.data.api.dto

import com.google.gson.annotations.SerializedName

data class ApiEnvelope<T>(
    @SerializedName("data") val data: T?,
    @SerializedName("meta") val meta: Meta?,
    @SerializedName("error") val error: ErrorInfo?
)

data class ListEnvelope<T>(
    @SerializedName("items") val items: List<T>,
    @SerializedName("total") val total: Int
)

data class MutateEnvelope<T>(
    @SerializedName("item") val item: T?,
    @SerializedName("id") val id: String?,
    @SerializedName("txNo") val txNo: String?
)

data class Meta(
    @SerializedName("serverTime") val serverTime: String
)

data class ErrorInfo(
    @SerializedName("code") val code: String,
    @SerializedName("message") val message: String,
    @SerializedName("details") val details: Any? = null
)

data class MaterialLotDto(
    @SerializedName("id") val id: String,
    @SerializedName("labelId") val labelId: String? = null,
    @SerializedName("rollQr") val rollQr: String? = null,
    @SerializedName("lotNo") val lotNo: String,
    @SerializedName("qty") val qty: Int = 0,
    @SerializedName("receivedQty") val receivedQty: Int? = 0,
    @SerializedName("reservedQty") val reservedQty: Int? = 0,
    @SerializedName("availableQty") val wmsAvailableQty: Int? = null,
    @SerializedName("iqcStatus") val iqcStatus: String,
    @SerializedName("materialCode") val materialCode: String,
    @SerializedName("name_zh") val nameZh: String? = null,
    @SerializedName("name_en") val nameEn: String? = null,
    @SerializedName("name_vi") val nameVi: String? = null,
    @SerializedName("locationCode") val locationCode: String? = null,
    @SerializedName("supplierCode") val supplierCode: String? = null,
    @SerializedName("createdAt") val createdAt: String? = null
) {
    val availableQty: Int get() = wmsAvailableQty ?: ((receivedQty ?: 0) - (reservedQty ?: 0))
}

data class StockDto(
    @SerializedName("materialCode") val materialCode: String,
    @SerializedName("name_zh") val nameZh: String? = null,
    @SerializedName("name_en") val nameEn: String? = null,
    @SerializedName("name_vi") val nameVi: String? = null,
    @SerializedName("iqcStatus") val iqcStatus: String,
    @SerializedName("qty") val qty: Int,
    @SerializedName("locationCode") val locationCode: String? = null
)

data class InventoryTransactionDto(
    @SerializedName("id") val id: String,
    @SerializedName("txNo") val txNo: String,
    @SerializedName("action") val action: String,
    @SerializedName("qty") val qty: Int,
    @SerializedName("txStatus") val txStatus: String? = null,
    @SerializedName("occurredAt") val occurredAt: String? = null,
    @SerializedName("workOrderCode") val workOrderCode: String? = null,
    @SerializedName("lotNo") val lotNo: String? = null
)

data class IssueRequest(
    @SerializedName("lotNo") val lotNo: String,
    @SerializedName("workOrderCode") val workOrderCode: String,
    @SerializedName("qty") val qty: Int,
    @SerializedName("operator") val operator: String
)

data class IssueResponse(
    @SerializedName("id") val id: String,
    @SerializedName("txNo") val txNo: String,
    @SerializedName("lotNo") val lotNo: String? = null,
    @SerializedName("workOrderCode") val workOrderCode: String? = null,
    @SerializedName("qty") val qty: Int? = null
)

data class HandoverItem(
    @SerializedName("issueTxId") val issueTxId: Long,
    @SerializedName("reservationId") val reservationId: Long? = null
)

data class HandoverRequest(
    @SerializedName("operatorTo") val operatorTo: String,
    @SerializedName("signatureHash") val signatureHash: String,
    @SerializedName("evidenceQr") val evidenceQr: String? = null,
    @SerializedName("notes") val notes: String? = null,
    @SerializedName("items") val items: List<HandoverItem>
)

data class HandoverResponse(
    @SerializedName("workOrderCode") val workOrderCode: String? = null,
    @SerializedName("signedCount") val signedCount: Int? = null
)

// ── WMS pick orders (PO → materials → check → sign) ──────────────
data class PickOrderListDto(
    @SerializedName("items") val items: List<PickOrderDto> = emptyList()
)

data class PickOrderDto(
    @SerializedName("id") val id: String? = null,
    @SerializedName("orderNo") val orderNo: String? = null,
    @SerializedName("workOrderCode") val workOrderCode: String = "",
    @SerializedName("lineCode") val lineCode: String? = null,
    @SerializedName("status") val status: String? = null,
    @SerializedName("collectNo") val collectNo: String? = null,
    @SerializedName("items") val items: List<PickOrderItemDto> = emptyList()
)

data class PickOrderItemDto(
    @SerializedName("id") val id: String? = null,
    @SerializedName("materialCode") val materialCode: String? = null,
    @SerializedName("ruijingCode") val ruijingCode: String? = null,
    @SerializedName("materialName") val materialName: MaterialNameDto? = null,
    @SerializedName("requiredQty") val requiredQty: Int = 0,
    @SerializedName("pickedQty") val pickedQty: Int = 0,
    @SerializedName("lotNo") val lotNo: String? = null,
    @SerializedName("locationCode") val locationCode: String? = null,
    @SerializedName("locationQr") val locationQr: String? = null,
    @SerializedName("processDomain") val processDomain: String? = null,
    @SerializedName("status") val status: String? = null
)

data class MaterialNameDto(
    @SerializedName("name_zh") val nameZh: String? = null,
    @SerializedName("name_en") val nameEn: String? = null,
    @SerializedName("name_vi") val nameVi: String? = null
)

data class PickAcceptLine(
    @SerializedName("materialCode") val materialCode: String? = null,
    @SerializedName("lotNo") val lotNo: String,
    @SerializedName("qty") val qty: Int
)

data class PickAcceptRequest(
    @SerializedName("operator") val operator: String,
    @SerializedName("signatureHash") val signatureHash: String,
    @SerializedName("evidenceQr") val evidenceQr: String? = null,
    @SerializedName("notes") val notes: String? = null,
    @SerializedName("items") val items: List<PickAcceptLine>
)

data class PickAcceptResponse(
    @SerializedName("acceptanceId") val acceptanceId: String? = null,
    @SerializedName("workOrderCode") val workOrderCode: String? = null,
    @SerializedName("operator") val operator: String? = null,
    @SerializedName("acceptedAt") val acceptedAt: String? = null
)

data class ReturnRequest(
    @SerializedName("lotNo") val lotNo: String,
    @SerializedName("workOrderCode") val workOrderCode: String,
    @SerializedName("qty") val qty: Int,
    @SerializedName("operator") val operator: String,
    @SerializedName("reason") val reason: String = "",
    @SerializedName("reasonCode") val reasonCode: String = "UNUSED"
)

data class ReturnResponse(
    @SerializedName("id") val id: String,
    @SerializedName("txNo") val txNo: String,
    @SerializedName("lotNo") val lotNo: String? = null,
    @SerializedName("workOrderCode") val workOrderCode: String? = null,
    @SerializedName("qty") val qty: Int? = null,
    @SerializedName("reason") val reason: String? = null,
    @SerializedName("reasonCode") val reasonCode: String? = null,
    @SerializedName("reopenedLines") val reopenedLines: Int? = null
)

data class WorkOrderDto(
    @SerializedName("id") val id: String,
    @SerializedName("code") val code: String,
    @SerializedName("status") val status: String,
    @SerializedName("productCode") val productCode: String? = null,
    @SerializedName("lineCode") val lineCode: String? = null,
    @SerializedName("plannedQty") val plannedQty: Int = 0,
    @SerializedName("completedQty") val completedQty: Int = 0,
    @SerializedName("productNameZh") val productNameZh: String? = null,
    @SerializedName("lockedBy") val lockedBy: String? = null,
    @SerializedName("lockedAt") val lockedAt: String? = null
) {
    val isLocked: Boolean get() = lockedBy != null
}

data class FeederLoadRequest(
    @SerializedName("workOrderCode") val workOrderCode: String,
    @SerializedName("lineCode") val lineCode: String?,
    @SerializedName("slotNo") val slotNo: String,
    @SerializedName("lotNo") val lotNo: String,
    @SerializedName("materialCode") val materialCode: String?,
    @SerializedName("qty") val qty: Int?,
    @SerializedName("operator") val operator: String
)

data class StockWarning(
    @SerializedName("code") val code: String,
    @SerializedName("message") val message: String,
    @SerializedName("available") val available: Double?,
    @SerializedName("requested") val requested: Double?,
    @SerializedName("shortage") val shortage: Double?,
    @SerializedName("threshold") val threshold: Double?
)

data class FeederLoadResponse(
    @SerializedName("id") val id: String,
    @SerializedName("workOrderCode") val workOrderCode: String,
    @SerializedName("lineCode") val lineCode: String?,
    @SerializedName("slotNo") val slotNo: String,
    @SerializedName("lotNo") val lotNo: String,
    @SerializedName("materialCode") val materialCode: String?,
    @SerializedName("qty") val qty: Int?,
    @SerializedName("operator") val operator: String?,
    @SerializedName("loadedAt") val loadedAt: String?,
    @SerializedName("warnings") val warnings: List<StockWarning>?
)

data class FeederUnloadRequest(
    @SerializedName("reasonCode") val reasonCode: String,
    @SerializedName("reasonNote") val reasonNote: String? = null,
    @SerializedName("qualityVerdict") val qualityVerdict: String  // PASS | NG | DAMAGED
)

data class FeederUnloadResponse(
    @SerializedName("id") val id: String,
    @SerializedName("workOrderCode") val workOrderCode: String?,
    @SerializedName("slotNo") val slotNo: String?,
    @SerializedName("lotNo") val lotNo: String?,
    @SerializedName("materialCode") val materialCode: String?,
    @SerializedName("qty") val qty: Int?,
    @SerializedName("returnReasonCode") val returnReasonCode: String?,
    @SerializedName("returnReasonNote") val returnReasonNote: String?,
    @SerializedName("qualityVerdict") val qualityVerdict: String?,
    @SerializedName("returnedAt") val returnedAt: String?,
    @SerializedName("returnedBy") val returnedBy: String?
)

data class ReturnReasonDto(
    @SerializedName("code") val code: String,
    @SerializedName("nameZh") val nameZh: String,
    @SerializedName("nameEn") val nameEn: String,
    @SerializedName("nameVi") val nameVi: String,
    @SerializedName("category") val category: String
)

data class BomLineDto(
    @SerializedName("id") val id: String,
    @SerializedName("materialId") val materialId: String,
    @SerializedName("materialCode") val materialCode: String,
    @SerializedName("qtyPer") val qtyPer: Double,
    @SerializedName("lossRate") val lossRate: Double,
    @SerializedName("referenceDesignators") val referenceDesignators: List<String>,
    @SerializedName("unit") val unit: String,
    @SerializedName("materialNameZh") val materialNameZh: String
)

data class BomDto(
    @SerializedName("id") val id: String,
    @SerializedName("productCode") val productCode: String,
    @SerializedName("productNameZh") val productNameZh: String?,
    @SerializedName("revision") val revision: String,
    @SerializedName("status") val status: String,
    @SerializedName("lines") val lines: List<BomLineDto>
)

// ── Count Session DTOs ────────────────────────────────────────────────────────

data class CountSessionDto(
    @SerializedName("id") val id: String,
    @SerializedName("sessionCode") val sessionCode: String,
    @SerializedName("triggerType") val triggerType: String,   // INVENTORY_TX | SCHEDULED
    @SerializedName("triggerAction") val triggerAction: String?, // RECEIVE|PUT_AWAY|ISSUE_TO_LINE|...
    @SerializedName("inventoryTxNo") val inventoryTxNo: String?,
    @SerializedName("storageLocationId") val storageLocationId: Long?,
    @SerializedName("locationCode") val locationCode: String?,
    @SerializedName("locationName") val locationName: String?,
    @SerializedName("materialLotId") val materialLotId: Long?,
    @SerializedName("lotNo") val lotNo: String?,
    @SerializedName("materialCode") val materialCode: String?,
    @SerializedName("materialNameZh") val materialNameZh: String?,
    @SerializedName("systemQty") val systemQty: Int?,
    @SerializedName("countedQty") val countedQty: Int?,
    @SerializedName("variance") val variance: Int?,
    @SerializedName("thresholdPct") val thresholdPct: Int = 10,
    @SerializedName("timeoutHours") val timeoutHours: Int = 4,
    @SerializedName("status") val status: String,  // open | in_progress | completed | cancelled
    @SerializedName("operatorId") val operatorId: Long?,
    @SerializedName("operatorName") val operatorName: String?,
    @SerializedName("claimedAt") val claimedAt: String?,
    @SerializedName("completedAt") val completedAt: String?,
    @SerializedName("createdAt") val createdAt: String?
)

data class CountItemDto(
    @SerializedName("id") val id: String,
    @SerializedName("countSessionId") val countSessionId: Long,
    @SerializedName("materialLotId") val materialLotId: Long?,
    @SerializedName("lotNo") val lotNo: String?,
    @SerializedName("materialCode") val materialCode: String?,
    @SerializedName("materialNameZh") val materialNameZh: String?,
    @SerializedName("systemQty") val systemQty: Int = 0,
    @SerializedName("countedQty") val countedQty: Int?,
    @SerializedName("variance") val variance: Int?,
    @SerializedName("counted") val counted: Boolean = false,
    @SerializedName("countedAt") val countedAt: String?,
    @SerializedName("countedBy") val countedBy: Long?,
    @SerializedName("countedByName") val countedByName: String?
)

data class CountAlertDto(
    @SerializedName("id") val id: String,
    @SerializedName("countSessionId") val countSessionId: Long?,
    @SerializedName("countItemId") val countItemId: Long?,
    @SerializedName("alertType") val alertType: String,  // VARIANCE | TIMEOUT
    @SerializedName("priority") val priority: Int = 2,
    @SerializedName("title") val title: String,
    @SerializedName("message") val message: String,
    @SerializedName("variancePct") val variancePct: Double?,
    @SerializedName("thresholdPct") val thresholdPct: Int?,
    @SerializedName("systemQty") val systemQty: Int?,
    @SerializedName("countedQty") val countedQty: Int?,
    @SerializedName("locationCode") val locationCode: String?,
    @SerializedName("lotNo") val lotNo: String?,
    @SerializedName("materialCode") val materialCode: String?,
    @SerializedName("acknowledged") val acknowledged: Boolean = false,
    @SerializedName("acknowledgedAt") val acknowledgedAt: String?,
    @SerializedName("createdAt") val createdAt: String?
)

data class CountSessionDetailResponse(
    @SerializedName("session") val session: CountSessionDto,
    @SerializedName("items") val items: List<CountItemDto>
)

data class CountItemCountRequest(
    @SerializedName("countedQty") val countedQty: Int,
    @SerializedName("operatorId") val operatorId: Long?,
    @SerializedName("operatorName") val operatorName: String?
)

data class CountSubmitRequest(
    @SerializedName("notes") val notes: String? = null
)

data class CountClaimResponse(
    @SerializedName("success") val success: Boolean
)

data class CountSubmitResponse(
    @SerializedName("success") val success: Boolean,
    @SerializedName("totalCounted") val totalCounted: Int?,
    @SerializedName("totalVariance") val totalVariance: Int?
)

// ═══════════════════════════════════════════════════════════════════
// DOCUMENT MANAGEMENT DTOs
// ═══════════════════════════════════════════════════════════════════

data class DocLineDto(
    @SerializedName("id") val id: Long? = null,
    @SerializedName("material_id") val materialId: Long? = null,
    @SerializedName("material_code") val materialCode: String? = null,
    @SerializedName("material_name_zh") val materialNameZh: String? = null,
    @SerializedName("unit") val unit: String? = null,
    @SerializedName("requested_qty") val requestedQty: Double? = null,
    @SerializedName("approved_qqty") val approvedQqty: Double? = null,
    @SerializedName("executed_qty") val executedQty: Double? = null,
    @SerializedName("lot_no") val lotNo: String? = null,
    @SerializedName("location_code") val locationCode: String? = null,
    @SerializedName("line_status") val lineStatus: String? = null,
    @SerializedName("remarks") val remarks: String? = null
)

data class DocDto(
    @SerializedName("id") val id: Long,
    @SerializedName("doc_no") val docNo: String,
    @SerializedName("status") val status: String,
    @SerializedName("created_at") val createdAt: String,
    @SerializedName("created_by") val createdBy: Long,
    @SerializedName("supplier_code") val supplierCode: String? = null,
    @SerializedName("supplier_name") val supplierName: String? = null,
    @SerializedName("work_order_code") val workOrderCode: String? = null,
    @SerializedName("requestor_name") val requestorName: String? = null,
    @SerializedName("lines") val lines: List<DocLineDto>? = null
)

data class DocListResponse(
    @SerializedName("items") val items: List<DocDto>,
    @SerializedName("total") val total: Int
)

// ── MES / Work Start ───────────────────────────────────────────────────────────

data class WorkStartRequest(
    @SerializedName("workOrderCode") val workOrderCode: String,
    @SerializedName("operator") val operator: String,
    @SerializedName("lineCode") val lineCode: String? = null,
    @SerializedName("machineCode") val machineCode: String? = null
)

data class WorkStartResponse(
    @SerializedName("id") val id: String,
    @SerializedName("workOrderCode") val workOrderCode: String,
    @SerializedName("operator") val operator: String,
    @SerializedName("operatorName") val operatorName: String?,
    @SerializedName("lineCode") val lineCode: String?,
    @SerializedName("machineCode") val machineCode: String?,
    @SerializedName("startedAt") val startedAt: String?
)

// ── MES / Feeder Validate ─────────────────────────────────────────────────────

data class FeederValidateRequest(
    @SerializedName("workOrderCode") val workOrderCode: String,
    @SerializedName("lineCode") val lineCode: String?,
    @SerializedName("machineCode") val machineCode: String?,
    @SerializedName("channelCode") val channelCode: String?,
    @SerializedName("feederCode") val feederCode: String,
    @SerializedName("slotNo") val slotNo: String,
    @SerializedName("materialCode") val materialCode: String?,
    @SerializedName("operator") val operator: String
)

data class FeederValidateResponse(
    @SerializedName("passed") val passed: Boolean,
    @SerializedName("feederCode") val feederCode: String?,
    @SerializedName("slotNo") val slotNo: String?,
    @SerializedName("machineCode") val machineCode: String?,
    @SerializedName("channelCode") val channelCode: String?,
    @SerializedName("expectedMaterialCode") val expectedMaterialCode: String?,
    @SerializedName("scannedMaterialCode") val scannedMaterialCode: String?,
    @SerializedName("message") val message: String?
)

// ── WMS / Place WO to Rack ─────────────────────────────────────────────────────

data class PlaceWoRequest(
    @SerializedName("wo_code") val woCode: String,
    @SerializedName("operator") val operator: String
)

data class PlaceWoResponse(
    @SerializedName("wo_code") val woCode: String,
    @SerializedName("placed_materials") val placedMaterials: Int,
    @SerializedName("shelves_lit") val shelvesLit: List<String>,
    @SerializedName("message") val message: String?
)

// ══════════════════════════════════════════════════════════════════════════════════
// MES / Feeder Binding — 4-way anti-error (machine + channel + feeder + reel)
// ══════════════════════════════════════════════════════════════════════════════════

/**
 * 4-way anti-error validation request.
 * Sent when: (a) feeder scanned → validate before advancing to reel scan,
 *            (b) reel scanned → full validation before binding confirm.
 */
data class FeederBindingValidateRequest(
    @SerializedName("workOrderCode") val workOrderCode: String,
    @SerializedName("lineCode") val lineCode: String? = null,
    @SerializedName("machineCode") val machineCode: String,
    @SerializedName("channelCode") val channelCode: String? = null,
    @SerializedName("slotNo") val slotNo: String,
    @SerializedName("feederCode") val feederCode: String? = null,
    @SerializedName("lotNo") val lotNo: String,
    @SerializedName("materialCode") val materialCode: String? = null,
    @SerializedName("qty") val qty: Int? = null,
    @SerializedName("operator") val operator: String
)

data class QualityGateCheckDto(
    @SerializedName("code") val code: String,
    @SerializedName("label") val label: String,
    @SerializedName("pass") val pass: Boolean,
    @SerializedName("detail") val detail: String
)

/** Individual validation error with field and code */
data class BindingErrorDto(
    @SerializedName("code") val code: String,
    @SerializedName("message") val message: String,
    @SerializedName("field") val field: String? = null,
    @SerializedName("expected") val expected: String? = null,
    @SerializedName("actual") val actual: String? = null,
    @SerializedName("currentBinding") val currentBinding: CurrentBindingDto? = null
)

data class CurrentBindingDto(
    @SerializedName("id") val id: String,
    @SerializedName("lotNo") val lotNo: String,
    @SerializedName("materialCode") val materialCode: String?,
    @SerializedName("operator") val operator: String?,
    @SerializedName("boundAt") val boundAt: String?
)

data class BindingWarningDto(
    @SerializedName("code") val code: String,
    @SerializedName("message") val message: String
)

data class BindingMatchedDto(
    @SerializedName("slotSource") val slotSource: String? = null,
    @SerializedName("bomMaterialAtSlot") val bomMaterialAtSlot: String? = null,
    @SerializedName("expectedMaterialCode") val expectedMaterialCode: String? = null,
    @SerializedName("lotStatus") val lotStatus: String? = null,
    @SerializedName("lotQty") val lotQty: Int? = null,
    @SerializedName("lotReserved") val lotReserved: Double? = null,
    @SerializedName("lotLabelId") val lotLabelId: String? = null,
    @SerializedName("bom") val bom: Boolean? = null
)

data class FeederBindingValidateResponse(
    @SerializedName("success") val success: Boolean,
    @SerializedName("pass") val pass: Boolean,
    @SerializedName("workOrderCode") val workOrderCode: String,
    @SerializedName("machineCode") val machineCode: String,
    @SerializedName("slotNo") val slotNo: String,
    @SerializedName("lotNo") val lotNo: String,
    @SerializedName("materialCode") val materialCode: String?,
    @SerializedName("errors") val errors: List<BindingErrorDto> = emptyList(),
    @SerializedName("warnings") val warnings: List<BindingWarningDto> = emptyList(),
    @SerializedName("qualityChecks") val qualityChecks: List<QualityGateCheckDto> = emptyList(),
    @SerializedName("matched") val matched: BindingMatchedDto? = null
)

/** Confirm binding after validation passes — writes to feeder_binding_events */
data class FeederBindingConfirmRequest(
    @SerializedName("workOrderCode") val workOrderCode: String,
    @SerializedName("lineCode") val lineCode: String? = null,
    @SerializedName("machineCode") val machineCode: String,
    @SerializedName("channelCode") val channelCode: String? = null,
    @SerializedName("slotNo") val slotNo: String,
    @SerializedName("feederCode") val feederCode: String? = null,
    @SerializedName("lotNo") val lotNo: String,
    @SerializedName("materialCode") val materialCode: String? = null,
    @SerializedName("qty") val qty: Int? = null,
    @SerializedName("operator") val operator: String,
    @SerializedName("signatureHash") val signatureHash: String? = null,
    @SerializedName("signedBy") val signedBy: String? = null,
    @SerializedName("evidenceQr") val evidenceQr: String? = null
)

data class FeederBindingConfirmResponse(
    @SerializedName("id") val id: String,
    @SerializedName("workOrderCode") val workOrderCode: String,
    @SerializedName("lineCode") val lineCode: String?,
    @SerializedName("machineCode") val machineCode: String,
    @SerializedName("channelCode") val channelCode: String?,
    @SerializedName("slotNo") val slotNo: String,
    @SerializedName("feederCode") val feederCode: String?,
    @SerializedName("lotNo") val lotNo: String,
    @SerializedName("materialCode") val materialCode: String?,
    @SerializedName("materialNameZh") val materialNameZh: String?,
    @SerializedName("qty") val qty: Int?,
    @SerializedName("operator") val operator: String?,
    @SerializedName("boundAt") val boundAt: String?,
    @SerializedName("handoverId") val handoverId: String? = null
)

/** Unbind / return material from slot */
data class FeederBindingUnbindRequest(
    @SerializedName("reasonCode") val reasonCode: String,
    @SerializedName("reasonNote") val reasonNote: String? = null,
    @SerializedName("qualityVerdict") val qualityVerdict: String, // PASS | NG | DAMAGED
    @SerializedName("operator") val operator: String? = null
)

data class FeederBindingUnbindResponse(
    @SerializedName("id") val id: String,
    @SerializedName("workOrderCode") val workOrderCode: String?,
    @SerializedName("machineCode") val machineCode: String?,
    @SerializedName("slotNo") val slotNo: String?,
    @SerializedName("lotNo") val lotNo: String?,
    @SerializedName("qualityVerdict") val qualityVerdict: String?,
    @SerializedName("unboundAt") val unboundAt: String?
)
