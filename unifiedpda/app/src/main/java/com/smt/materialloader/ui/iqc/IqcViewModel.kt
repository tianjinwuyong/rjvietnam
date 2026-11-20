package com.smt.materialloader.ui.iqc

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.google.gson.JsonObject
import com.smt.materialloader.MaterialLoaderApp
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** One receipt waiting for incoming quality inspection (WMS authority). */
data class IqcIncoming(
    val recordId: String,
    val lotNo: String,
    val materialCode: String,
    val materialName: String,
    val supplierCode: String,
    val qty: String,
    val receivedAt: String
)

/** The inspection document MES/WMS created for a receipt. */
data class IqcInspection(
    val id: String,
    val inspectionNo: String,
    val sampleSize: Int,
    val aqlLevel: String,
    val acCritical: Int,
    val reCritical: Int,
    val acMajor: Int,
    val reMajor: Int,
    val acMinor: Int,
    val reMinor: Int
)

data class IqcResultSummary(val result: String, val critical: Int, val major: Int, val minor: Int, val supplierSynced: Boolean?, val supplierError: String?)

data class IqcState(
    val loading: Boolean = false,
    val online: Boolean = false,
    val queue: List<IqcIncoming> = emptyList(),
    val selected: IqcIncoming? = null,
    val inspection: IqcInspection? = null,
    val starting: Boolean = false,
    val submitting: Boolean = false,
    val results: Map<Int, Boolean> = emptyMap(),
    val defectCounts: Map<Int, Int> = emptyMap(),
    val severities: Map<Int, String> = emptyMap(),
    val verdict: IqcResultSummary? = null,
    val message: String? = null,
    val error: String? = null
) {
    val isComplete: Boolean get() = results.size == IqcChecklist.items.size
}

/** One checklist category. The checklist is evidence guidance; WMS rules decide sampling and AQL. */
data class IqcCheckItem(val titleZh: String, val titleEn: String, val titleVi: String, val checksZh: List<String>)

object IqcChecklist {
    val items = listOf(
        IqcCheckItem("物料身份/BOM与采购单", "Material identity / BOM / PO", "Danh tinh vat tu / BOM / PO", listOf("料号与采购单", "制造商/原厂型号", "规格书与BOM版本", "替代料批准状态")),
        IqcCheckItem("数量、批次、日期码", "Quantity, lot, date code", "So luong, lo, ma ngay", listOf("外箱数量", "内包装数量", "批次号/日期码", "卷数/盘数与单据")),
        IqcCheckItem("包装、载带、卷盘完整性", "Packaging, carrier, reel integrity", "Bao bi, carrier, cuon nguyen ven", listOf("外箱无破损", "内袋密封完整", "载带/卷盘无变形", "无污染/混料")),
        IqcCheckItem("标签、条码、原厂标识", "Labels, barcodes, OEM marks", "Nhan, ma vach, dau hieu hang that", listOf("供应商标签", "原厂标识", "条码可扫描", "批次/原产地可追溯")),
        IqcCheckItem("外观、丝印、引脚、焊端", "Appearance, marking, leads, terminals", "Ngoai quan, in, chan, diem han", listOf("本体无裂纹", "引脚/焊端无氧化", "丝印清晰", "无变形/缺件")),
        IqcCheckItem("尺寸、间距、厚度", "Dimensions, pitch, thickness", "Kich thuoc, buoc, do day", listOf("长/宽/高", "引脚间距", "厚度/外形", "载带孔距/腔体")),
        IqcCheckItem("电气参数/功能", "Electrical parameters / function", "Thong so dien / chuc nang", listOf("标称值", "容差", "耐压/漏电", "ESR或功能参数")),
        IqcCheckItem("可焊性", "Solderability", "Kha nang han", listOf("焊端润湿", "焊点覆盖", "无拒焊/虚焊", "测试方法与时间")),
        IqcCheckItem("MSD、HIC、Floor Life、烘烤", "MSD, HIC, floor life, bake", "MSD, HIC, floor life, say kho", listOf("MSL等级", "HIC湿度指示", "干燥剂/真空袋", "开封时间", "Floor Life/烘烤")),
        IqcCheckItem("ESD包装与处理", "ESD packaging and handling", "Bao bi va xu ly ESD", listOf("防静电包装", "ESD标签", "接地状态", "操作与运输条件")),
        IqcCheckItem("COA、RoHS/REACH及文件", "COA, RoHS/REACH, documents", "COA, RoHS/REACH, tai lieu", listOf("COA/检验报告", "RoHS/REACH", "客户特殊要求", "文件版本有效")),
        IqcCheckItem("风险/假料/重大缺陷升级", "Risk, counterfeit, major defect escalation", "Rui ro, hang gia, nang cap loi nghiem trong", listOf("假料/改标识别", "重大缺陷升级", "隔离状态", "供应商8D要求"))
    )
}

class IqcViewModel : ViewModel() {
    private val api = MaterialLoaderApp.instance.apiService
    private val _state = MutableStateFlow(IqcState())
    val state: StateFlow<IqcState> = _state.asStateFlow()

    fun refresh() {
        viewModelScope.launch {
            _state.value = _state.value.copy(loading = true, error = null)
            runCatching { api.wmsIncoming(iqcStatus = "pending", limit = 50) }
                .onSuccess { response ->
                    if (!response.isSuccessful) {
                        _state.value = _state.value.copy(
                            loading = false, online = false,
                            error = local("WMS 返回 HTTP ${response.code()}", "WMS returned HTTP ${response.code()}", "WMS tra ve HTTP ${response.code()}")
                        )
                        return@onSuccess
                    }
                    val rows = response.body()?.getAsJsonArray("items") ?: response.body()?.getAsJsonArray("data")
                    val queue = rows?.mapNotNull { element ->
                        val o = element.asJsonObject
                        val recordId = o.text("id")
                        val lotNo = o.text("lot_no", "lotNo")
                        if (recordId.isBlank() || lotNo.isBlank()) return@mapNotNull null
                        IqcIncoming(
                            recordId = recordId,
                            lotNo = lotNo,
                            materialCode = o.text("material_code", "materialCode"),
                            materialName = o.text("material_name", "materialName"),
                            supplierCode = o.text("supplier_code", "supplierCode"),
                            qty = o.text("received_qty", "receivedQty"),
                            receivedAt = o.text("received_at", "receivedAt")
                        )
                    }.orEmpty()
                    _state.value = _state.value.copy(
                        loading = false,
                        online = true,
                        queue = queue,
                        error = null,
                        message = local("WMS 待检队列 ${queue.size} 项", "WMS pending queue: ${queue.size}", "Hang cho IQC: ${queue.size}")
                    )
                }
                .onFailure { error ->
                    _state.value = _state.value.copy(
                        loading = false, online = false,
                        error = local("WMS 连接失败：${error.message}", "WMS connection failed: ${error.message}", "Ket noi WMS that bai: ${error.message}")
                    )
                }
        }
    }

    /** Creates the WMS inspection document for the selected receipt. */
    fun start(item: IqcIncoming) {
        viewModelScope.launch {
            _state.value = _state.value.copy(starting = true, selected = item, inspection = null, results = emptyMap(), defectCounts = emptyMap(), severities = emptyMap(), verdict = null, error = null)
            runCatching {
                api.createIqcInspection(
                    mapOf(
                        "incoming_record_id" to item.recordId,
                        "lot_no" to item.lotNo,
                        "material_code" to item.materialCode,
                        "supplier_code" to item.supplierCode,
                        "batch_size" to (item.qty.toDoubleOrNull()?.toLong() ?: 1L),
                        "inspection_types" to listOf("INCOMING")
                    )
                )
            }
                .onSuccess { response ->
                    val body = response.body()
                    if (!response.isSuccessful || body == null) {
                        _state.value = _state.value.copy(
                            starting = false,
                            error = local("WMS 拒绝创建检验单：HTTP ${response.code()}", "WMS rejected the inspection: HTTP ${response.code()}", "WMS tu choi tao phieu: HTTP ${response.code()}")
                        )
                        return@onSuccess
                    }
                    _state.value = _state.value.copy(
                        starting = false,
                        inspection = IqcInspection(
                            id = body.text("id"),
                            inspectionNo = body.text("inspection_no", "inspectionNo"),
                            sampleSize = body.int("sample_size", "sampleSize"),
                            aqlLevel = body.text("aql_level", "aqlLevel"),
                            acCritical = body.int("ac_critical", "acCritical"),
                            reCritical = body.int("re_critical", "reCritical"),
                            acMajor = body.int("ac_major", "acMajor"),
                            reMajor = body.int("re_major", "reMajor"),
                            acMinor = body.int("ac_minor", "acMinor"),
                            reMinor = body.int("re_minor", "reMinor")
                        ),
                        message = local("WMS 检验单已创建", "WMS inspection created", "Da tao phieu kiem tra WMS")
                    )
                }
                .onFailure { error ->
                    _state.value = _state.value.copy(starting = false, error = local("创建检验单失败：${error.message}", "Inspection creation failed: ${error.message}", "Tao phieu that bai: ${error.message}"))
                }
        }
    }

    fun setResult(index: Int, pass: Boolean) {
        val current = _state.value
        val results = current.results + (index to pass)
        val counts = if (pass) current.defectCounts - index else current.defectCounts + (index to (current.defectCounts[index] ?: 1))
        val severities = if (pass) current.severities - index else current.severities + (index to (current.severities[index] ?: "major"))
        _state.value = current.copy(results = results, defectCounts = counts, severities = severities, verdict = null)
    }

    fun setDefectCount(index: Int, count: Int) {
        _state.value = _state.value.copy(defectCounts = _state.value.defectCounts + (index to count.coerceAtLeast(1)))
    }

    fun setSeverity(index: Int, severity: String) {
        _state.value = _state.value.copy(severities = _state.value.severities + (index to severity))
    }

    /** Submits every defect to WMS and completes the AQL verdict. */
    fun submit() {
        val current = _state.value
        val inspection = current.inspection ?: return
        val selected = current.selected ?: return
        if (!current.isComplete) {
            _state.value = current.copy(error = local("必须完成全部检查项", "Every checklist item must be decided", "Phai quyet dinh tat ca muc"))
            return
        }
        viewModelScope.launch {
            _state.value = current.copy(submitting = true, error = null)
            runCatching {
                var defectError: String? = null
                current.results.filterValues { !it }.forEach { (index, _) ->
                    val item = IqcChecklist.items[index]
                    val defectResponse = api.addIqcDefect(
                        inspection.id,
                        mapOf(
                            "defect_type" to item.titleEn,
                            "defect_location" to selected.lotNo,
                            "defect_count" to (current.defectCounts[index] ?: 1),
                            "severity" to (current.severities[index] ?: "major"),
                            "photo_url" to null
                        )
                    )
                    if (!defectResponse.isSuccessful) {
                        defectError = "HTTP ${defectResponse.code()}"
                    }
                }
                if (defectError != null) error("WMS defect write failed: $defectError")
                api.completeIqcInspection(inspection.id)
            }
                .onSuccess { response ->
                    val body = response.body()
                    if (!response.isSuccessful || body == null) {
                        _state.value = _state.value.copy(
                            submitting = false,
                            error = local("WMS 拒绝完成检验：HTTP ${response.code()}", "WMS rejected completion: HTTP ${response.code()}", "WMS tu choi hoan tat: HTTP ${response.code()}")
                        )
                        return@onSuccess
                    }
                    val summary = runCatching {
                        val defects = body.getAsJsonObject("defects_summary")
                        val supplier = body.getAsJsonObject("supplierCommunication")
                        IqcResultSummary(
                            result = body.text("result"),
                            critical = defects?.int("critical") ?: 0,
                            major = defects?.int("major") ?: 0,
                            minor = defects?.int("minor") ?: 0,
                            supplierSynced = supplier?.get("synced")?.takeUnless { it.isJsonNull }?.asBoolean,
                            supplierError = supplier?.text("error")?.takeIf { it.isNotBlank() }
                        )
                    }.getOrNull()
                    _state.value = _state.value.copy(
                        submitting = false,
                        verdict = summary,
                        message = local("WMS 已判定并回写来料状态", "WMS decided and updated the incoming status", "WMS da ket luan va cap nhat trang thai"),
                        selected = null,
                        inspection = null,
                        results = emptyMap(),
                        defectCounts = emptyMap(),
                        severities = emptyMap()
                    )
                    refresh()
                }
                .onFailure { error ->
                    _state.value = _state.value.copy(
                        submitting = false,
                        error = local("检验结果未确认：${error.message}", "Inspection result not confirmed: ${error.message}", "Ket qua chua duoc xac nhan: ${error.message}")
                    )
                }
        }
    }

    fun cancel() {
        _state.value = _state.value.copy(selected = null, inspection = null, results = emptyMap(), defectCounts = emptyMap(), severities = emptyMap(), verdict = null, error = null)
    }

    private fun local(zh: String, en: String, vi: String): String = when (MaterialLoaderApp.instance.prefs.getLocale()) {
        "vi-VN" -> vi
        "en-US" -> en
        else -> zh
    }
}

private fun JsonObject.text(vararg names: String): String =
    names.asSequence().mapNotNull { name ->
        get(name)?.takeUnless { it.isJsonNull }?.let { element ->
            runCatching { element.asString }.getOrNull()
        }
    }.firstOrNull { it.isNotBlank() }.orEmpty()

private fun JsonObject.int(vararg names: String): Int =
    names.asSequence().mapNotNull { name ->
        get(name)?.takeUnless { it.isJsonNull }?.let { element ->
            runCatching { element.asInt }.getOrNull() ?: runCatching { element.asString.toInt() }.getOrNull()
        }
    }.firstOrNull() ?: 0
