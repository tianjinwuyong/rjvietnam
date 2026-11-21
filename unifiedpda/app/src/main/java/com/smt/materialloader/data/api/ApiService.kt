package com.smt.materialloader.data.api

import com.smt.materialloader.data.api.dto.*
import com.smt.materialloader.data.api.dto.ShelfListResponse
import com.smt.materialloader.data.api.dto.ShelfDetailResponse
import com.smt.materialloader.data.api.dto.ShelfInRequest
import com.smt.materialloader.data.api.dto.ShelfOutRequest
import com.smt.materialloader.data.api.dto.ShelfActionResponse
import com.smt.materialloader.data.api.dto.TransactionHistoryResponse
import retrofit2.Response
import retrofit2.http.*
import com.google.gson.JsonObject

interface ApiService {

    @GET("/api/wms/receiving/po-queue")
    suspend fun getReceivingPoQueue(): Response<JsonObject>

    // ── WMS incoming + IQC closed loop ────────────────────────────────
    // Verified against the WMS API: incoming receipt → inspection → defect
    // records → AQL completion, which updates the lot/incoming IQC status.
    @GET("/api/wms/incoming")
    suspend fun wmsIncoming(
        @Query("iqc_status") iqcStatus: String? = null,
        @Query("limit") limit: Int = 50
    ): Response<JsonObject>

    @GET("/api/wms/iqc/inspections")
    suspend fun iqcInspections(
        @Query("result") result: String? = null,
        @Query("limit") limit: Int = 50
    ): Response<JsonObject>

    @GET("/api/wms/iqc/inspections/{id}")
    suspend fun iqcInspection(@Path("id") id: String): Response<JsonObject>

    @POST("/api/wms/iqc/inspections")
    suspend fun createIqcInspection(@Body body: Map<String, @JvmSuppressWildcards Any?>): Response<JsonObject>

    @POST("/api/wms/iqc/inspections/{id}/defects")
    suspend fun addIqcDefect(
        @Path("id") id: String,
        @Body body: Map<String, @JvmSuppressWildcards Any?>
    ): Response<JsonObject>

    @POST("/api/wms/iqc/inspections/{id}/complete")
    suspend fun completeIqcInspection(@Path("id") id: String): Response<JsonObject>

    @GET("/wms/fetch-packages")
    suspend fun getMaterialFetchingQueue(
        @Query("status") status: String? = null,
        @Query("q") query: String? = null,
        @Query("limit") limit: Int = 200
    ): Response<JsonObject>

    @POST("/wms/fetch-packages/{qr}/handover")
    suspend fun confirmMaterialFetch(
        @Path("qr") qr: String,
        @Body body: Map<String, @JvmSuppressWildcards Any?>
    ): Response<JsonObject>

    @GET("/api/oa/documents")
    suspend fun oaSignificationDocuments(
        @Query("status") status: String = "PENDING_APPROVAL",
        @Query("mine") mine: Boolean = true
    ): Response<JsonObject>

    @POST("/api/oa/documents/{documentId}/decision")
    suspend fun oaSignificationDecision(
        @Path("documentId") documentId: Long,
        @Body body: Map<String, @JvmSuppressWildcards Any?>
    ): Response<JsonObject>

    @POST("/api/wms/receiving/label-ai")
    @Headers("X-PDA-WMS-OCR: updated")
    suspend fun parseReceivingLabel(@Body body: Map<String, @JvmSuppressWildcards Any?>): Response<JsonObject>

    // Compatibility route used by older WMS deployments.
    @POST("/wms/receiving/label-ai")
    @Headers("X-PDA-WMS-OCR: updated")
    suspend fun parseReceivingLabelLegacy(@Body body: Map<String, @JvmSuppressWildcards Any?>): Response<JsonObject>

    @POST("/api/pda/events")
    suspend fun postPdaEvent(@Body body: Map<String, @JvmSuppressWildcards Any?>): Response<JsonObject>

    // WMS storage locations for material receiver (location map)
    @GET("/wms/storage-locations")
    suspend fun getStorageLocations(): Response<JsonObject>

    // WMS control state — gives all 14 floor areas with proper labels
    @GET("/api/3d/wms-control-state")
    suspend fun getWmsControlState(): Response<JsonObject>

    // WMS 3D layout — gives PALLET positions per floor area (parentId → AREA.id)
    @GET("/api/3d/wms-layout")
    suspend fun getWmsLayout(): Response<JsonObject>

    @POST("/wms/receiving/pallet-box-bindings")
    suspend fun commitReceivingBox(@Body body: Map<String, @JvmSuppressWildcards Any?>): Response<JsonObject>

    @DELETE("/wms/receiving/pallet-box-bindings/last")
    suspend fun revokeLastReceivingBox(): Response<JsonObject>

    @GET("/api/wms/receiving/live-state")
    suspend fun wmsReceivingLiveState(): Response<JsonObject>

    @POST("/mes/heartbeat/{stationCode}")
    suspend fun stationHeartbeat(
        @Path("stationCode") stationCode: String,
        @Body body: Map<String, @JvmSuppressWildcards Any?>
    ): Response<JsonObject>

    @GET("/api/smt/loading/work-orders")
    suspend fun smtLoadingWorkOrders(
        @Query("lineCode") lineCode: String? = null,
        @Query("operatorBadge") operatorBadge: String = "",
        @Query("pdaId") pdaId: String = ""
    ): Response<JsonObject>

    // MES owns multi-PDA material allocation. A PDA may join/claim only the
    // assignments returned by this dispatch session.
    @POST("/api/dispatch/sessions")
    suspend fun dispatchSession(@Body body: Map<String, @JvmSuppressWildcards Any?>): Response<JsonObject>

    @POST("/api/dispatch/pdas")
    suspend fun dispatchJoinPda(@Body body: Map<String, @JvmSuppressWildcards Any?>): Response<JsonObject>

    @GET("/api/dispatch/sessions/{sessionId}")
    suspend fun dispatchSession(@Path("sessionId") sessionId: Long): Response<JsonObject>

    @GET("/api/dispatch/assignments")
    suspend fun dispatchAssignments(
        @Query("pdaId") pdaId: String,
        @Query("workOrderCode") workOrderCode: String,
        @Query("lineCode") lineCode: String
    ): Response<JsonObject>

    @POST("/api/dispatch/claim")
    suspend fun dispatchClaim(@Body body: Map<String, @JvmSuppressWildcards Any?>): Response<JsonObject>

    @GET("/api/smt/loading/operators")
    suspend fun smtLoadingOperators(): Response<JsonObject>

    @GET("/api/smt/loading/offline-violations")
    suspend fun smtLoadingOfflineViolations(
        @Query("status") status: String = "OPEN",
        @Query("lineCode") lineCode: String? = null
    ): Response<JsonObject>

    @GET("/api/pda/heartbeats")
    suspend fun pdaHeartbeats(): Response<JsonObject>

    @GET("/mes/lines/{lineCode}")
    suspend fun mesLine(@Path("lineCode") lineCode: String): Response<JsonObject>

    // Line Manager PDA: authoritative MES management interface.
    @GET("/api/manager/alerts")
    suspend fun managerAlerts(@Query("lineCode") lineCode: String, @Query("status") status: String = "open"): Response<JsonObject>

    @GET("/pmc/work-orders")
    suspend fun pmcWorkOrders(
        @Query("status") status: String? = null,
        @Query("limit") limit: Int = 100,
        @Query("lineCode") lineCode: String? = null
    ): Response<JsonObject>

    @POST("/pmc/work-orders")
    suspend fun pmcCreateWorkOrder(@Body body: Map<String, @JvmSuppressWildcards Any?>): Response<JsonObject>

    @GET("/api/manager/decisions")
    suspend fun managerDecisions(@Query("lineCode") lineCode: String, @Query("status") status: String = "pending"): Response<JsonObject>

    @GET("/api/manager/team")
    suspend fun managerTeam(@Query("lineCode") lineCode: String): Response<JsonObject>

    @GET("/hr/employees")
    suspend fun hrEmployees(
        @Query("status") status: String = "active",
        @Query("limit") limit: Int = 100,
        @Query("offset") offset: Int = 0
    ): Response<JsonObject>

    // Employee self-service: HR/MES owns the identity and all write decisions.
    @GET("/hr/employees/{employeeCode}")
    suspend fun hrEmployee(@Path("employeeCode") employeeCode: String): Response<JsonObject>

    @GET("/hr/attendance")
    suspend fun hrEmployeeAttendance(
        @Query("employeeId") employeeId: String,
        @Query("limit") limit: Int = 30
    ): Response<JsonObject>

    @POST("/hr/attendance/clock-in")
    suspend fun hrEmployeeClockIn(@Body body: Map<String, @JvmSuppressWildcards Any?>): Response<JsonObject>

    @POST("/hr/attendance/clock-out")
    suspend fun hrEmployeeClockOut(@Body body: Map<String, @JvmSuppressWildcards Any?>): Response<JsonObject>

    @GET("/hr/leave-requests")
    suspend fun hrEmployeeLeaveRequests(
        @Query("employeeId") employeeId: String,
        @Query("limit") limit: Int = 50
    ): Response<JsonObject>

    @POST("/hr/leave-requests")
    suspend fun hrEmployeeCreateLeave(@Body body: Map<String, @JvmSuppressWildcards Any?>): Response<JsonObject>

    @GET("/hr/grievance-cases/mine")
    suspend fun hrEmployeeGrievances(): Response<JsonObject>

    @POST("/hr/employees/{employeeId}/qr-code")
    suspend fun hrEmployeeGenerateQr(
        @Path("employeeId") employeeId: String,
        @Body body: Map<String, @JvmSuppressWildcards Any?> = emptyMap()
    ): Response<JsonObject>

    @POST("/hr/grievance-cases")
    suspend fun hrEmployeeCreateGrievance(@Body body: Map<String, @JvmSuppressWildcards Any?>): Response<JsonObject>

    @POST("/hr/grievance-cases/{caseId}/employee-ack")
    suspend fun hrEmployeeAcknowledgeGrievance(
        @Path("caseId") caseId: String,
        @Body body: Map<String, @JvmSuppressWildcards Any?>
    ): Response<JsonObject>

    @GET("/hr/governance/dashboard")
    suspend fun hrGovernanceDashboard(@Query("q") query: String = ""): Response<JsonObject>

    @GET("/hr/org-chart")
    suspend fun hrOrgChart(): Response<JsonObject>

    @GET("/api/manager/messages")
    suspend fun managerMessages(@Query("lineCode") lineCode: String): Response<JsonObject>

    @GET("/api/manager/targets")
    suspend fun managerTargets(@Query("lineCode") lineCode: String, @Query("period") period: String = "day"): Response<JsonObject>

    @GET("/api/manager/handover")
    suspend fun managerHandover(@Query("lineCode") lineCode: String, @Query("shift") shift: String = "current"): Response<JsonObject>

    @GET("/api/manager/audit")
    suspend fun managerAudit(@Query("lineCode") lineCode: String, @Query("limit") limit: Int = 50): Response<JsonObject>

    @GET("/api/manager/line-assignments")
    suspend fun managerLineAssignments(
        @Query("date") date: String? = null,
        @Query("lineCode") lineCode: String? = null,
        @Query("workOrderCode") workOrderCode: String? = null
    ): Response<JsonObject>

    @POST("/api/manager/line-assignments")
    suspend fun managerCreateLineAssignment(@Body body: Map<String, @JvmSuppressWildcards Any?>): Response<JsonObject>

    @POST("/api/manager/line-assignments/confirm")
    suspend fun managerConfirmLineAssignments(@Body body: Map<String, @JvmSuppressWildcards Any?>): Response<JsonObject>

    @GET("/api/manager/hiring-requests")
    suspend fun managerHiringRequests(@Query("status") status: String? = null): Response<JsonObject>

    @POST("/api/manager/hiring-requests")
    suspend fun managerCreateHiringRequest(@Body body: Map<String, @JvmSuppressWildcards Any?>): Response<JsonObject>

    @POST("/api/manager/hiring-requests/{id}/sign")
    suspend fun managerSignHiringRequest(@Path("id") id: String, @Body body: Map<String, @JvmSuppressWildcards Any?>): Response<JsonObject>

    @POST("/api/manager/hiring-requests/{id}/publish")
    suspend fun managerPublishHiringRequest(@Path("id") id: String, @Body body: Map<String, @JvmSuppressWildcards Any?> = emptyMap()): Response<JsonObject>

    @GET("/api/manager/grievance-cases")
    suspend fun managerGrievanceCases(): Response<JsonObject>

    @POST("/api/manager/grievance-cases/{id}/explanation")
    suspend fun managerSubmitGrievanceExplanation(@Path("id") id: String, @Body body: Map<String, @JvmSuppressWildcards Any?>): Response<JsonObject>

    // The face provider must be HR/MES controlled. The PDA submits only a
    // provider verification reference; it never stores or compares templates locally.
    @POST("/api/pda/operator/face-authorization")
    suspend fun requestOperatorFaceAuthorization(@Body body: Map<String, @JvmSuppressWildcards Any?>): Response<JsonObject>

    @POST("/api/manager/alerts/{alertId}/acknowledge")
    suspend fun managerAcknowledgeAlert(@Path("alertId") alertId: String, @Body body: Map<String, @JvmSuppressWildcards Any?>): Response<JsonObject>

    @POST("/api/manager/alerts/{alertId}/assign")
    suspend fun managerAssignAlert(@Path("alertId") alertId: String, @Body body: Map<String, @JvmSuppressWildcards Any?>): Response<JsonObject>

    @POST("/api/manager/alerts/{alertId}/escalate")
    suspend fun managerEscalateAlert(@Path("alertId") alertId: String, @Body body: Map<String, @JvmSuppressWildcards Any?>): Response<JsonObject>

    @POST("/api/manager/decisions/{decisionId}/approve")
    suspend fun managerApproveDecision(@Path("decisionId") decisionId: String, @Body body: Map<String, @JvmSuppressWildcards Any?>): Response<JsonObject>

    @POST("/api/manager/decisions/{decisionId}/reject")
    suspend fun managerRejectDecision(@Path("decisionId") decisionId: String, @Body body: Map<String, @JvmSuppressWildcards Any?>): Response<JsonObject>

    @POST("/api/manager/decisions/{decisionId}/information")
    suspend fun managerAskDecisionInformation(@Path("decisionId") decisionId: String, @Body body: Map<String, @JvmSuppressWildcards Any?>): Response<JsonObject>

    @POST("/api/manager/messages")
    suspend fun managerSendMessage(@Body body: Map<String, @JvmSuppressWildcards Any?>): Response<JsonObject>

    @POST("/api/manager/messages/{messageId}/acknowledge")
    suspend fun managerAcknowledgeMessage(@Path("messageId") messageId: String, @Body body: Map<String, @JvmSuppressWildcards Any?>): Response<JsonObject>

    @GET("/api/manager/channels")
    suspend fun managerChannels(): Response<JsonObject>

    @GET("/api/manager/channels/{channelCode}/messages")
    suspend fun managerChannelMessages(
        @Path("channelCode") channelCode: String,
        @Query("limit") limit: Int = 100
    ): Response<JsonObject>

    @POST("/api/manager/channels/{channelCode}/messages")
    suspend fun managerSendChannelMessage(
        @Path("channelCode") channelCode: String,
        @Body body: Map<String, @JvmSuppressWildcards Any?>
    ): Response<JsonObject>

    @POST("/api/manager/channels/messages/{messageId}/acknowledge")
    suspend fun managerAcknowledgeChannelMessage(
        @Path("messageId") messageId: String,
        @Body body: Map<String, @JvmSuppressWildcards Any?> = emptyMap()
    ): Response<JsonObject>

    @GET("/api/plant-manager/exception-requests")
    suspend fun plantManagerExceptionRequests(): Response<JsonObject>

    @GET("/api/smt/loading/approval-queue")
    suspend fun plantLoadingApprovalQueue(@Query("lineCode") lineCode: String? = null): Response<JsonObject>

    @GET("/api/pda/role-context")
    suspend fun pdaRoleContext(): Response<JsonObject>

    @POST("/api/smt/loading/items/{bindingId}/approval")
    suspend fun plantLoadingItemApproval(@Path("bindingId") bindingId: String, @Body body: Map<String, @JvmSuppressWildcards Any?>): Response<JsonObject>

    @POST("/api/plant-manager/exception-requests/{exceptionId}/authorize")
    suspend fun plantManagerAuthorizeException(
        @Path("exceptionId") exceptionId: String,
        @Body body: Map<String, @JvmSuppressWildcards Any?>
    ): Response<JsonObject>

    @POST("/api/plant-manager/authorizations/{authorizationId}/revoke")
    suspend fun plantManagerRevokeAuthorization(
        @Path("authorizationId") authorizationId: String,
        @Body body: Map<String, @JvmSuppressWildcards Any?> = emptyMap()
    ): Response<JsonObject>

    @POST("/api/plant-manager/authorizations/{authorizationId}/close")
    suspend fun plantManagerCloseAuthorization(
        @Path("authorizationId") authorizationId: String,
        @Body body: Map<String, @JvmSuppressWildcards Any?>
    ): Response<JsonObject>

    @POST("/api/manager/recovery-actions")
    suspend fun managerCreateRecoveryAction(@Body body: Map<String, @JvmSuppressWildcards Any?>): Response<JsonObject>

    @POST("/api/manager/handover/confirm")
    suspend fun managerConfirmHandover(@Body body: Map<String, @JvmSuppressWildcards Any?>): Response<JsonObject>

    @POST("/api/smt/loading/start")
    suspend fun smtLoadingStart(@Body body: Map<String, @JvmSuppressWildcards Any?>): Response<JsonObject>

    @POST("/api/smt/loading/recalculate-start")
    suspend fun smtLoadingRecalculateStart(@Body body: Map<String, @JvmSuppressWildcards Any?>): Response<JsonObject>

    @POST("/api/smt/loading/bind")
    suspend fun smtLoadingBind(@Body body: Map<String, @JvmSuppressWildcards Any?>): Response<JsonObject>

    @POST("/mes/smt-loading/complete")
    suspend fun smtLoadingComplete(@Body body: Map<String, @JvmSuppressWildcards Any?>): Response<JsonObject>

    /** WMS is the authority for physical roll QR/SN, quantity, location and release status. */
    @GET("/wms/material-rolls/resolve")
    suspend fun resolveMaterialRoll(@Query("qr") qr: String): Response<JsonObject>

    /** MES returns the active machine/slot/feeder assignment for a registered roll. */
    @GET("/mes/material-roll-bindings/active")
    suspend fun activeMaterialRollBinding(
        @Query("workOrderCode") workOrderCode: String,
        @Query("materialSn") materialSn: String
    ): Response<JsonObject>

    @POST("/api/smt/loading/offline-lease")
    suspend fun smtLoadingOfflineLease(@Body body: Map<String, @JvmSuppressWildcards Any?>): Response<JsonObject>

    @POST("/api/smt/loading/offline-events")
    suspend fun smtLoadingOfflineEvents(@Body body: Map<String, @JvmSuppressWildcards Any?>): Response<JsonObject>

    @POST("/api/smt/loading/release")
    suspend fun smtLoadingRelease(@Body body: Map<String, @JvmSuppressWildcards Any?>): Response<JsonObject>

    @POST("/api/smt/loading/roll-change")
    suspend fun smtLoadingRollChange(@Body body: Map<String, @JvmSuppressWildcards Any?>): Response<JsonObject>

    @POST("/api/smt/loading/feeder-remaining")
    suspend fun smtLoadingFeederRemaining(@Body body: Map<String, @JvmSuppressWildcards Any?>): Response<JsonObject>

    @GET("/api/smt/loading/session")
    suspend fun smtLoadingSession(
        @Query("workOrderCode") workOrderCode: String,
        @Query("machineCode") machineCode: String
    ): Response<JsonObject>

    // ── Auth ────────────────────────────────────────────────────────

    @POST("/auth/login")
    suspend fun login(@Body request: LoginRequest): Response<ApiEnvelope<LoginResponse>>

    @GET("/auth/session")
    suspend fun getSession(): Response<ApiEnvelope<SessionResponse>>

    // ── WMS / Material Lots ─────────────────────────────────────────

    @GET("/wms/material-lots")
    suspend fun getMaterialLots(
        @Query("lotNo") lotNo: String? = null,
        @Query("iqcStatus") iqcStatus: String? = null,
        @Query("q") q: String? = null,
        @Query("limit") limit: Int = 50,
        @Query("offset") offset: Int = 0
    ): Response<ApiEnvelope<ListEnvelope<MaterialLotDto>>>

    @GET("/wms/stock")
    suspend fun getStock(
        @Query("materialCode") materialCode: String? = null,
        @Query("iqcStatus") iqcStatus: String? = null
    ): Response<ApiEnvelope<ListEnvelope<StockDto>>>

    @GET("/wms/lot-transactions/{lotId}")
    suspend fun getLotTransactions(
        @Path("lotId") lotId: String
    ): Response<ApiEnvelope<ListEnvelope<InventoryTransactionDto>>>

    // ── WMS / Issue & Return ────────────────────────────────────────

    @POST("/wms/issue-to-line")
    suspend fun issueToLine(
        @Body request: IssueRequest
    ): Response<ApiEnvelope<IssueResponse>>

    @POST("/wms/work-orders/{woCode}/handover")
    suspend fun handover(
        @Path("woCode") woCode: String,
        @Body request: HandoverRequest
    ): Response<ApiEnvelope<HandoverResponse>>

    @GET("/wms/pick-orders")
    suspend fun getPickOrders(
        @Query("workOrderCode") workOrderCode: String? = null
    ): Response<ApiEnvelope<PickOrderListDto>>

    @POST("/wms/pick-orders/{woCode}/accept")
    suspend fun acceptPickOrder(
        @Path("woCode") woCode: String,
        @Body request: PickAcceptRequest
    ): Response<ApiEnvelope<PickAcceptResponse>>

    @GET("/wms/issue-announcements")
    suspend fun getIssueAnnouncements(
        @Query("lineCode") lineCode: String? = null,
        @Query("workOrderCode") workOrderCode: String? = null
    ): Response<JsonObject>

    @POST("/wms/issue-announcements/{id}/ack")
    suspend fun ackIssueAnnouncement(
        @Path("id") id: Long
    ): Response<JsonObject>

    // ── WMS / Material collect list (warehouse collector) ────────────

    @POST("/wms/collect-orders/generate")
    suspend fun generateCollectOrder(
        @Body body: Map<String, @JvmSuppressWildcards Any?>
    ): Response<JsonObject>

    @GET("/wms/collect-orders")
    suspend fun getCollectOrder(
        @Query("workOrderCode") workOrderCode: String? = null,
        @Query("domain") domain: String? = null,
        @Query("assignee") assignee: String? = null
    ): Response<JsonObject>

    @POST("/wms/collect-orders/{id}/confirm")
    suspend fun confirmCollectLine(
        @Path("id") id: Long,
        @Body body: Map<String, @JvmSuppressWildcards Any?>
    ): Response<JsonObject>

    @POST("/wms/collect-orders/{id}/assign")
    suspend fun assignCollectLines(
        @Path("id") id: Long,
        @Body body: Map<String, @JvmSuppressWildcards Any?>
    ): Response<JsonObject>

    @GET("/wms/shortages")
    suspend fun getShortages(): Response<JsonObject>

    @POST("/wms/shortages/{lineId}/resolve")
    suspend fun resolveShortage(
        @Path("lineId") lineId: Long
    ): Response<JsonObject>

    @POST("/wms/return-from-line")
    suspend fun returnFromLine(
        @Body request: ReturnRequest
    ): Response<ApiEnvelope<ReturnResponse>>

    // ── PMC / Work Orders ──────────────────────────────────────────

    @GET("/pmc/work-orders")
    suspend fun getWorkOrders(
        @Query("q") q: String? = null,
        @Query("status") status: String? = null,
        @Query("limit") limit: Int = 50,
        @Query("offset") offset: Int = 0
    ): Response<ApiEnvelope<ListEnvelope<WorkOrderDto>>>

    @GET("/erp/boms/product/{productCode}")
    suspend fun getBomForProduct(
        @Path("productCode") productCode: String
    ): Response<ApiEnvelope<BomDto>>

    // ── PMC / WO Lock/Unlock ───────────────────────────────────────

    @POST("/pmc/work-orders/{code}/lock")
    suspend fun lockWorkOrder(
        @Path("code") code: String,
        @Body payload: Map<String, String>
    ): Response<ApiEnvelope<Map<String, Any?>>>

    @POST("/pmc/work-orders/{code}/unlock")
    suspend fun unlockWorkOrder(
        @Path("code") code: String,
        @Body payload: Map<String, String>
    ): Response<ApiEnvelope<Map<String, Any?>>>

    @POST("/pmc/work-orders/{code}/complete")
    suspend fun completeWorkOrder(
        @Path("code") code: String,
        @Body payload: Map<String, String>
    ): Response<ApiEnvelope<Map<String, Any?>>>

    // ── MES / Feeder Loading ───────────────────────────────────────

    @POST("/mes/feeder-loading")
    suspend fun confirmFeederLoad(
        @Body request: FeederLoadRequest
    ): Response<ApiEnvelope<FeederLoadResponse>>

    @DELETE("/mes/feeder-loading/{id}")
    suspend fun returnFeederLoad(
        @Path("id") id: String,
        @Body request: FeederUnloadRequest
    ): Response<ApiEnvelope<FeederUnloadResponse>>

    // ── MES / Work Start ────────────────────────────────────────────

    @POST("/mes/work-start")
    suspend fun workStart(
        @Body request: WorkStartRequest
    ): Response<ApiEnvelope<WorkStartResponse>>

    @POST("/mes/feeder-validate")
    suspend fun validateFeeder(
        @Body request: FeederValidateRequest
    ): Response<ApiEnvelope<FeederValidateResponse>>

    // ── MES / Feeder Binding (4-way anti-error) ───────────────────────

    @POST("/mes/feeder-binding/validate")
    suspend fun feederBindingValidate(
        @Body request: FeederBindingValidateRequest
    ): Response<ApiEnvelope<FeederBindingValidateResponse>>

    @POST("/mes/feeder-binding/confirm")
    suspend fun feederBindingConfirm(
        @Body request: FeederBindingConfirmRequest
    ): Response<ApiEnvelope<FeederBindingConfirmResponse>>

    @DELETE("/mes/feeder-binding/{id}")
    suspend fun feederBindingUnbind(
        @Path("id") id: String,
        @Body request: FeederBindingUnbindRequest
    ): Response<ApiEnvelope<FeederBindingUnbindResponse>>

    @GET("/mes/feeder-binding/{workOrderCode}")
    suspend fun feederBindingList(
        @Path("workOrderCode") workOrderCode: String
    ): Response<ApiEnvelope<List<FeederBindingConfirmResponse>>>

    // ── MES / Return Reason Codes ─────────────────────────────────────

    @GET("/mes/return-reason-codes")
    suspend fun getReturnReasonCodes(): Response<ApiEnvelope<ListEnvelope<ReturnReasonDto>>>

    // ── WMS / Smart Shelf ───────────────────────────────────────────

    @GET("/wms/shelf/list")
    suspend fun getShelfList(): Response<ApiEnvelope<ShelfListResponse>>

    @GET("/wms/shelf/{shelfCode}")
    suspend fun getShelfDetail(@Path("shelfCode") shelfCode: String): Response<ApiEnvelope<ShelfDetailResponse>>

    @POST("/wms/shelf/shelf-in")
    suspend fun shelfIn(@Body request: ShelfInRequest): Response<ApiEnvelope<ShelfActionResponse>>

    @POST("/wms/shelf/shelf-out")
    suspend fun shelfOut(@Body request: ShelfOutRequest): Response<ApiEnvelope<ShelfActionResponse>>

    @POST("/api/wms/shelf/place-wo")
    suspend fun placeWo(@Body request: PlaceWoRequest): Response<ApiEnvelope<PlaceWoResponse>>

    @GET("/wms/shelf/transactions")
    suspend fun getShelfTransactions(
        @Query("shelfCode") shelfCode: String? = null,
        @Query("action") action: String? = null,
        @Query("limit") limit: Int? = null,
        @Query("offset") offset: Int? = null
    ): Response<ApiEnvelope<TransactionHistoryResponse>>

    // ── WMS / Count Sessions ──────────────────────────────────────────

    @GET("/wms/count-sessions")
    suspend fun getCountSessions(
        @Query("status") status: String? = null,
        @Query("locationCode") locationCode: String? = null,
        @Query("triggerType") triggerType: String? = null,
        @Query("limit") limit: Int = 100,
        @Query("offset") offset: Int = 0
    ): Response<ApiEnvelope<ListEnvelope<CountSessionDto>>>

    @GET("/wms/count-sessions/{id}")
    suspend fun getCountSessionDetail(
        @Path("id") id: String
    ): Response<ApiEnvelope<CountSessionDetailResponse>>

    @POST("/wms/count-sessions/{id}/claim")
    suspend fun claimCountSession(
        @Path("id") id: String
    ): Response<ApiEnvelope<CountClaimResponse>>

    @POST("/wms/count-items/{id}/count")
    suspend fun countItem(
        @Path("id") id: String,
        @Body request: CountItemCountRequest
    ): Response<ApiEnvelope<Map<String, Any>>>

    @POST("/wms/count-sessions/{id}/submit")
    suspend fun submitCountSession(
        @Path("id") id: String,
        @Body request: CountSubmitRequest
    ): Response<ApiEnvelope<CountSubmitResponse>>

    @GET("/wms/count-alerts")
    suspend fun getCountAlerts(
        @Query("acknowledged") acknowledged: Boolean? = null,
        @Query("alertType") alertType: String? = null,
        @Query("limit") limit: Int = 50
    ): Response<ApiEnvelope<ListEnvelope<CountAlertDto>>>

    @PATCH("/wms/count-alerts/{id}/acknowledge")
    suspend fun acknowledgeCountAlert(
        @Path("id") id: String
    ): Response<ApiEnvelope<Map<String, Any>>>

    // ── Document Management ────────────────────────────────────────

    @GET("/wms/inbound")
    suspend fun getInboundOrders(
        @Query("status") status: String? = null,
        @Query("page") page: Int = 1,
        @Query("pageSize") pageSize: Int = 20
    ): Response<ApiEnvelope<DocListResponse>>

    @GET("/wms/inbound/{id}")
    suspend fun getInboundOrder(@Path("id") id: Long): Response<ApiEnvelope<DocDto>>

    @POST("/wms/inbound")
    suspend fun createInboundOrder(@Body body: Map<String, @JvmSuppressWildcards Any>): Response<ApiEnvelope<DocDto>>

    @PATCH("/wms/inbound/{id}")
    suspend fun updateInboundOrder(@Path("id") id: Long, @Body body: Map<String, @JvmSuppressWildcards Any>): Response<ApiEnvelope<DocDto>>

    @DELETE("/wms/inbound/{id}")
    suspend fun deleteInboundOrder(@Path("id") id: Long): Response<ApiEnvelope<Map<String, Any>>>

    @POST("/wms/inbound/submit/{id}")
    suspend fun submitInboundOrder(@Path("id") id: Long): Response<ApiEnvelope<DocDto>>

    @POST("/wms/inbound/approve/{id}")
    suspend fun approveInboundOrder(@Path("id") id: Long): Response<ApiEnvelope<DocDto>>

    @POST("/wms/inbound/reject/{id}")
    suspend fun rejectInboundOrder(@Path("id") id: Long, @Body body: Map<String, Any> = emptyMap()): Response<ApiEnvelope<DocDto>>

    @POST("/wms/inbound/execute/{id}")
    suspend fun executeInboundOrder(@Path("id") id: Long): Response<ApiEnvelope<DocDto>>

    @POST("/wms/inbound/complete/{id}")
    suspend fun completeInboundOrder(@Path("id") id: Long): Response<ApiEnvelope<DocDto>>

    @GET("/wms/outbound")
    suspend fun getOutboundOrders(
        @Query("status") status: String? = null,
        @Query("page") page: Int = 1,
        @Query("pageSize") pageSize: Int = 20
    ): Response<ApiEnvelope<DocListResponse>>

    @GET("/wms/outbound/{id}")
    suspend fun getOutboundOrder(@Path("id") id: Long): Response<ApiEnvelope<DocDto>>

    @POST("/wms/outbound")
    suspend fun createOutboundOrder(@Body body: Map<String, @JvmSuppressWildcards Any>): Response<ApiEnvelope<DocDto>>

    @PATCH("/wms/outbound/{id}")
    suspend fun updateOutboundOrder(@Path("id") id: Long, @Body body: Map<String, @JvmSuppressWildcards Any>): Response<ApiEnvelope<DocDto>>

    @DELETE("/wms/outbound/{id}")
    suspend fun deleteOutboundOrder(@Path("id") id: Long): Response<ApiEnvelope<Map<String, Any>>>

    @POST("/wms/outbound/submit/{id}")
    suspend fun submitOutboundOrder(@Path("id") id: Long): Response<ApiEnvelope<DocDto>>

    @POST("/wms/outbound/approve/{id}")
    suspend fun approveOutboundOrder(@Path("id") id: Long): Response<ApiEnvelope<DocDto>>

    @POST("/wms/outbound/reject/{id}")
    suspend fun rejectOutboundOrder(@Path("id") id: Long, @Body body: Map<String, Any> = emptyMap()): Response<ApiEnvelope<DocDto>>

    @POST("/wms/outbound/execute/{id}")
    suspend fun executeOutboundOrder(@Path("id") id: Long): Response<ApiEnvelope<DocDto>>

    @POST("/wms/outbound/complete/{id}")
    suspend fun completeOutboundOrder(@Path("id") id: Long): Response<ApiEnvelope<DocDto>>

    @GET("/wms/requisition")
    suspend fun getRequisitions(
        @Query("status") status: String? = null,
        @Query("page") page: Int = 1,
        @Query("pageSize") pageSize: Int = 20
    ): Response<ApiEnvelope<DocListResponse>>

    @GET("/wms/requisition/{id}")
    suspend fun getRequisition(@Path("id") id: Long): Response<ApiEnvelope<DocDto>>

    @POST("/wms/requisition")
    suspend fun createRequisition(@Body body: Map<String, @JvmSuppressWildcards Any>): Response<ApiEnvelope<DocDto>>

    @PATCH("/wms/requisition/{id}")
    suspend fun updateRequisition(@Path("id") id: Long, @Body body: Map<String, @JvmSuppressWildcards Any>): Response<ApiEnvelope<DocDto>>

    @DELETE("/wms/requisition/{id}")
    suspend fun deleteRequisition(@Path("id") id: Long): Response<ApiEnvelope<Map<String, Any>>>

    @POST("/wms/requisition/submit/{id}")
    suspend fun submitRequisition(@Path("id") id: Long): Response<ApiEnvelope<DocDto>>

    @POST("/wms/requisition/approve/{id}")
    suspend fun approveRequisition(@Path("id") id: Long): Response<ApiEnvelope<DocDto>>

    @POST("/wms/requisition/reject/{id}")
    suspend fun rejectRequisition(@Path("id") id: Long, @Body body: Map<String, Any> = emptyMap()): Response<ApiEnvelope<DocDto>>

    @POST("/wms/requisition/execute/{id}")
    suspend fun executeRequisition(@Path("id") id: Long): Response<ApiEnvelope<DocDto>>

    @POST("/wms/requisition/complete/{id}")
    suspend fun completeRequisition(@Path("id") id: Long): Response<ApiEnvelope<DocDto>>

    @GET("/wms/return")
    suspend fun getReturnSlips(
        @Query("status") status: String? = null,
        @Query("page") page: Int = 1,
        @Query("pageSize") pageSize: Int = 20
    ): Response<ApiEnvelope<DocListResponse>>

    @GET("/wms/return/{id}")
    suspend fun getReturnSlip(@Path("id") id: Long): Response<ApiEnvelope<DocDto>>

    @POST("/wms/return")
    suspend fun createReturnSlip(@Body body: Map<String, @JvmSuppressWildcards Any>): Response<ApiEnvelope<DocDto>>

    @PATCH("/wms/return/{id}")
    suspend fun updateReturnSlip(@Path("id") id: Long, @Body body: Map<String, @JvmSuppressWildcards Any>): Response<ApiEnvelope<DocDto>>

    @DELETE("/wms/return/{id}")
    suspend fun deleteReturnSlip(@Path("id") id: Long): Response<ApiEnvelope<Map<String, Any>>>

    @POST("/wms/return/submit/{id}")
    suspend fun submitReturnSlip(@Path("id") id: Long): Response<ApiEnvelope<DocDto>>

    @POST("/wms/return/reject/{id}")
    suspend fun rejectReturnSlip(@Path("id") id: Long, @Body body: Map<String, Any> = emptyMap()): Response<ApiEnvelope<DocDto>>

    @POST("/wms/return/execute/{id}")
    suspend fun executeReturnSlip(@Path("id") id: Long): Response<ApiEnvelope<DocDto>>

    @POST("/wms/return/complete/{id}")
    suspend fun completeReturnSlip(@Path("id") id: Long): Response<ApiEnvelope<DocDto>>

    @GET("/wms/replenishment")
    suspend fun getReplenishments(
        @Query("status") status: String? = null,
        @Query("page") page: Int = 1,
        @Query("pageSize") pageSize: Int = 20
    ): Response<ApiEnvelope<DocListResponse>>

    @GET("/wms/replenishment/{id}")
    suspend fun getReplenishment(@Path("id") id: Long): Response<ApiEnvelope<DocDto>>

    @POST("/wms/replenishment")
    suspend fun createReplenishment(@Body body: Map<String, @JvmSuppressWildcards Any>): Response<ApiEnvelope<DocDto>>

    @PATCH("/wms/replenishment/{id}")
    suspend fun updateReplenishment(@Path("id") id: Long, @Body body: Map<String, @JvmSuppressWildcards Any>): Response<ApiEnvelope<DocDto>>

    @DELETE("/wms/replenishment/{id}")
    suspend fun deleteReplenishment(@Path("id") id: Long): Response<ApiEnvelope<Map<String, Any>>>

    @POST("/wms/replenishment/submit/{id}")
    suspend fun submitReplenishment(@Path("id") id: Long): Response<ApiEnvelope<DocDto>>

    @POST("/wms/replenishment/approve/{id}")
    suspend fun approveReplenishment(@Path("id") id: Long): Response<ApiEnvelope<DocDto>>

    @POST("/wms/replenishment/reject/{id}")
    suspend fun rejectReplenishment(@Path("id") id: Long, @Body body: Map<String, Any> = emptyMap()): Response<ApiEnvelope<DocDto>>

    @POST("/wms/replenishment/execute/{id}")
    suspend fun executeReplenishment(@Path("id") id: Long): Response<ApiEnvelope<DocDto>>

    @POST("/wms/replenishment/complete/{id}")
    suspend fun completeReplenishment(@Path("id") id: Long): Response<ApiEnvelope<DocDto>>
}
