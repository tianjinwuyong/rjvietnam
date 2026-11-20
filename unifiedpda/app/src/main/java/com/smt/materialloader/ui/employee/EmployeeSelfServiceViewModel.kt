package com.smt.materialloader.ui.employee

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.google.gson.JsonObject
import com.smt.materialloader.MaterialLoaderApp
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class EmployeeSelfServiceState(
    val loading: Boolean = false,
    val profile: JsonObject? = null,
    val attendance: List<JsonObject> = emptyList(),
    val leaveRequests: List<JsonObject> = emptyList(),
    val grievances: List<JsonObject> = emptyList(),
    val employeeQr: String? = null,
    val message: String? = null
)

class EmployeeSelfServiceViewModel : ViewModel() {
    private val app = MaterialLoaderApp.instance
    private val _state = MutableStateFlow(EmployeeSelfServiceState())
    val state: StateFlow<EmployeeSelfServiceState> = _state.asStateFlow()

    private fun userCode(): String = app.prefs.getUser()?.username.orEmpty()

    fun refresh(preserveMessage: String? = null) {
        viewModelScope.launch {
            _state.value = _state.value.copy(loading = true, message = preserveMessage ?: _state.value.message)
            runCatching {
                val profileResponse = app.apiService.hrEmployee(userCode())
                val profile = profileResponse.body()?.getAsJsonObject("item")
                val employeeId = profile?.get("id")?.asString ?: app.prefs.getUser()?.id.orEmpty()
                val attendance = app.apiService.hrEmployeeAttendance(employeeId).body().items("items")
                val leave = app.apiService.hrEmployeeLeaveRequests(employeeId).body().items("items")
                val grievances = app.apiService.hrEmployeeGrievances().body().items("items")
                _state.value = EmployeeSelfServiceState(
                    profile = profile,
                    attendance = attendance,
                    leaveRequests = leave,
                    grievances = grievances,
                    message = preserveMessage ?: local("HR/MES 已同步", "HR/MES synchronized", "HR/MES da dong bo")
                )
            }.onFailure { error ->
                _state.value = _state.value.copy(message = local("HR/MES 同步失败：${error.message}", "HR/MES sync failed: ${error.message}", "Dong bo HR/MES that bai: ${error.message}"))
            }
            _state.value = _state.value.copy(loading = false)
        }
    }

    fun clockIn() = clock("in")
    fun clockOut() = clock("out")

    private fun clock(direction: String) {
        viewModelScope.launch {
            val employeeId = _state.value.profile?.get("id")?.asString ?: app.prefs.getUser()?.id.orEmpty()
            val body = mapOf("payload" to mapOf("employeeId" to employeeId))
            val response = if (direction == "in") app.apiService.hrEmployeeClockIn(body) else app.apiService.hrEmployeeClockOut(body)
            val message = if (response.isSuccessful) {
                local("考勤已记录", "Attendance recorded", "Da ghi nhan cham cong")
            } else {
                local("考勤被拒绝（HTTP ${response.code()}）", "Attendance rejected (HTTP ${response.code()})", "Cham cong bi tu choi (HTTP ${response.code()})")
            }
            refresh(message)
        }
    }

    fun submitLeave(leaveType: String, startDate: String, endDate: String, reason: String) {
        viewModelScope.launch {
            val response = app.apiService.hrEmployeeCreateLeave(
                mapOf("payload" to mapOf("leaveType" to leaveType, "startDate" to startDate, "endDate" to endDate, "reason" to reason))
            )
            val message = if (response.isSuccessful) {
                local("请假申请已提交，等待 MES/HR 审批", "Leave request submitted; waiting for MES/HR approval", "Da gui don xin phep; cho MES/HR phe duyet")
            } else {
                local("请假被拒绝（HTTP ${response.code()}）", "Leave request rejected (HTTP ${response.code()})", "Don xin phep bi tu choi (HTTP ${response.code()})")
            }
            refresh(message)
        }
    }

    fun acknowledgeGrievance(caseId: String, accept: Boolean) {
        viewModelScope.launch {
            val response = app.apiService.hrEmployeeAcknowledgeGrievance(
                caseId,
                mapOf("payload" to mapOf("accepted" to accept, "acknowledgedBy" to userCode()))
            )
            val message = if (response.isSuccessful) {
                local("已回执 HR 处理结果", "HR outcome acknowledged", "Da xac nhan ket qua HR")
            } else {
                local("回执失败（HTTP ${response.code()}）", "Acknowledgement failed (HTTP ${response.code()})", "Xac nhan that bai (HTTP ${response.code()})")
            }
            refresh(message)
        }
    }

    fun generateEmployeeQr() {
        viewModelScope.launch {
            val employeeId = _state.value.profile?.get("id")?.asString ?: app.prefs.getUser()?.id.orEmpty()
            val response = app.apiService.hrEmployeeGenerateQr(employeeId, mapOf("validDays" to 365))
            val qr = response.body()?.getAsJsonObject("item")?.get("qrContent")?.asString
            _state.value = _state.value.copy(employeeQr = qr, message = if (response.isSuccessful) local("员工二维码已签发", "Employee QR issued", "Da cap ma QR nhan vien") else local("二维码签发失败（HTTP ${response.code()}）", "Employee QR rejected (HTTP ${response.code()})", "Cap QR that bai (HTTP ${response.code()})"))
        }
    }

    fun submitGrievance(subjectEmployeeCode: String, lineCode: String, category: String, text: String) {
        viewModelScope.launch {
            val response = app.apiService.hrEmployeeCreateGrievance(
                mapOf("payload" to mapOf(
                    "subjectEmployeeCode" to subjectEmployeeCode,
                    "lineCode" to lineCode,
                    "allegationCategory" to category,
                    "complaintText" to text
                ))
            )
            val message = if (response.isSuccessful) {
                local("申诉已提交，HR 将按保密流程处理", "Grievance submitted; HR will follow the confidential process", "Da gui khieu nai; HR se xu ly bao mat")
            } else {
                local("申诉被拒绝（HTTP ${response.code()}）", "Grievance rejected (HTTP ${response.code()})", "Khieu nai bi tu choi (HTTP ${response.code()})")
            }
            refresh(message)
        }
    }

    private fun local(zh: String, en: String, vi: String): String = when (app.prefs.getLocale()) {
        "vi-VN" -> vi
        "en-US" -> en
        else -> zh
    }

    private fun JsonObject?.items(name: String): List<JsonObject> =
        this?.getAsJsonArray(name)?.mapNotNull { it.asJsonObject } ?: emptyList()
}
