package com.smt.materialloader.data.repository

import com.smt.materialloader.data.api.RetrofitClient
import com.smt.materialloader.data.api.dto.*

class WorkOrderRepository {

    private val api get() = RetrofitClient.getApiService()

    suspend fun getWorkOrders(
        query: String? = null,
        status: String? = null
    ): Result<List<WorkOrderDto>> {
        return try {
            val response = api.getWorkOrders(q = query, status = status)
            if (response.isSuccessful) {
                val items = response.body()?.data?.items ?: emptyList()
                Result.success(items)
            } else {
                Result.failure(parseError(response))
            }
        } catch (e: Exception) {
            Result.failure(Exception("Network error: ${e.message}"))
        }
    }

    suspend fun getBomForProduct(productCode: String): Result<BomDto> {
        return try {
            val response = api.getBomForProduct(productCode)
            if (response.isSuccessful) {
                val bom = response.body()?.data
                if (bom != null) Result.success(bom)
                else Result.failure(Exception("BOM not found for product $productCode"))
            } else {
                Result.failure(parseError(response))
            }
        } catch (e: Exception) {
            Result.failure(Exception("Network error: ${e.message}"))
        }
    }

    suspend fun getMaterialLotByNo(lotNo: String): Result<MaterialLotDto> {
        return try {
            val response = api.getMaterialLots(lotNo = lotNo, limit = 1)
            if (response.isSuccessful) {
                val items = response.body()?.data?.items ?: emptyList()
                if (items.isNotEmpty()) {
                    Result.success(items.first())
                } else {
                    Result.failure(Exception("Lot not found: $lotNo"))
                }
            } else {
                Result.failure(parseError(response))
            }
        } catch (e: Exception) {
            Result.failure(Exception("Network error: ${e.message}"))
        }
    }

    suspend fun issueToLine(lotNo: String, workOrderCode: String, qty: Int, operator: String): Result<IssueResponse> {
        return try {
            val request = IssueRequest(
                lotNo = lotNo,
                workOrderCode = workOrderCode,
                qty = qty,
                operator = operator
            )
            val response = api.issueToLine(request)
            if (response.isSuccessful) {
                val data = response.body()?.data
                if (data != null) {
                    Result.success(data)
                } else {
                    Result.failure(Exception("Issue failed: no response data"))
                }
            } else {
                Result.failure(Exception(parseErrorMessage(response)))
            }
        } catch (e: Exception) {
            Result.failure(Exception("Network error: ${e.message}"))
        }
    }

    suspend fun confirmFeederLoad(
        workOrderCode: String,
        lineCode: String?,
        slotNo: String,
        lotNo: String,
        materialCode: String?,
        qty: Int?,
        operator: String
    ): Result<FeederLoadResponse> {
        return try {
            val request = FeederLoadRequest(
                workOrderCode = workOrderCode,
                lineCode = lineCode,
                slotNo = slotNo,
                lotNo = lotNo,
                materialCode = materialCode,
                qty = qty,
                operator = operator
            )
            val response = api.confirmFeederLoad(request)
            if (response.isSuccessful) {
                val data = response.body()?.data
                if (data != null) {
                    Result.success(data)
                } else {
                    Result.failure(Exception("Feeder load confirm failed: no response data"))
                }
            } else {
                Result.failure(Exception(parseErrorMessage(response)))
            }
        } catch (e: Exception) {
            Result.failure(Exception("Network error: ${e.message}"))
        }
    }

    suspend fun lockWorkOrder(code: String, operator: String): Result<Unit> {
        return try {
            val response = api.lockWorkOrder(code, mapOf("operator" to operator))
            if (response.isSuccessful) {
                Result.success(Unit)
            } else {
                val errorMsg = parseErrorMessage(response)
                Result.failure(Exception(errorMsg))
            }
        } catch (e: Exception) {
            Result.failure(Exception("Network error: ${e.message}"))
        }
    }

    suspend fun unlockWorkOrder(code: String, operator: String): Result<Unit> {
        return try {
            val response = api.unlockWorkOrder(code, mapOf("operator" to operator))
            if (response.isSuccessful) {
                Result.success(Unit)
            } else {
                val errorMsg = parseErrorMessage(response)
                Result.failure(Exception(errorMsg))
            }
        } catch (e: Exception) {
            Result.failure(Exception("Network error: ${e.message}"))
        }
    }

    suspend fun completeWorkOrder(code: String, operator: String): Result<Unit> {
        return try {
            val response = api.completeWorkOrder(code, mapOf("operator" to operator))
            if (response.isSuccessful) {
                Result.success(Unit)
            } else {
                val errorMsg = parseErrorMessage(response)
                Result.failure(Exception(errorMsg))
            }
        } catch (e: Exception) {
            Result.failure(Exception("Network error: ${e.message}"))
        }
    }

    suspend fun workStart(
        workOrderCode: String,
        operator: String,
        lineCode: String? = null,
        machineCode: String? = null
    ): Result<WorkStartResponse> {
        return try {
            val request = WorkStartRequest(
                workOrderCode = workOrderCode,
                operator = operator,
                lineCode = lineCode,
                machineCode = machineCode
            )
            val response = api.workStart(request)
            if (response.isSuccessful) {
                val data = response.body()?.data
                if (data != null) Result.success(data)
                else Result.failure(Exception("WorkStart failed: no response data"))
            } else {
                Result.failure(Exception(parseErrorMessage(response)))
            }
        } catch (e: Exception) {
            Result.failure(Exception("Network error: ${e.message}"))
        }
    }

    suspend fun placeWoToRack(workOrderCode: String, operator: String): Result<PlaceWoResponse> {
        return try {
            val request = PlaceWoRequest(woCode = workOrderCode, operator = operator)
            val response = api.placeWo(request)
            if (response.isSuccessful) {
                val data = response.body()?.data
                if (data != null) Result.success(data)
                else Result.failure(Exception("PlaceWo failed: no response data"))
            } else {
                Result.failure(Exception(parseErrorMessage(response)))
            }
        } catch (e: Exception) {
            Result.failure(Exception("Network error: ${e.message}"))
        }
    }

    suspend fun validateFeeder(
        workOrderCode: String,
        lineCode: String?,
        feederCode: String,
        slotNo: String,
        machineCode: String?,
        channelCode: String?,
        materialCode: String?,
        operator: String
    ): Result<FeederValidateResponse> {
        return try {
            val request = FeederValidateRequest(
                workOrderCode = workOrderCode,
                lineCode = lineCode,
                feederCode = feederCode,
                slotNo = slotNo,
                machineCode = machineCode,
                channelCode = channelCode,
                materialCode = materialCode,
                operator = operator
            )
            val response = api.validateFeeder(request)
            if (response.isSuccessful) {
                val data = response.body()?.data
                if (data != null) Result.success(data)
                else Result.failure(Exception("FeederValidate failed: no response data"))
            } else {
                Result.failure(Exception(parseErrorMessage(response)))
            }
        } catch (e: Exception) {
            Result.failure(Exception("Network error: ${e.message}"))
        }
    }

    suspend fun returnFeederLoad(
        id: String,
        reasonCode: String,
        reasonNote: String?,
        qualityVerdict: String
    ): Result<FeederUnloadResponse> {
        return try {
            val request = FeederUnloadRequest(
                reasonCode = reasonCode,
                reasonNote = reasonNote,
                qualityVerdict = qualityVerdict
            )
            val response = api.returnFeederLoad(id, request)
            if (response.isSuccessful) {
                val data = response.body()?.data
                if (data != null) Result.success(data)
                else Result.failure(Exception("Return feeder load failed: no response data"))
            } else {
                Result.failure(Exception(parseErrorMessage(response)))
            }
        } catch (e: Exception) {
            Result.failure(Exception("Network error: ${e.message}"))
        }
    }

    suspend fun getReturnReasonCodes(): Result<List<ReturnReasonDto>> {
        return try {
            val response = api.getReturnReasonCodes()
            if (response.isSuccessful) {
                val items = response.body()?.data?.items ?: emptyList()
                Result.success(items)
            } else {
                Result.failure(Exception(parseErrorMessage(response)))
            }
        } catch (e: Exception) {
            Result.failure(Exception("Network error: ${e.message}"))
        }
    }

    // ── Feeder Binding (4-way anti-error) ─────────────────────────────────

    /** Full 4-way validation: machine + channel + feeder + reel material */
    suspend fun feederBindingValidate(
        workOrderCode: String,
        lineCode: String?,
        machineCode: String,
        channelCode: String?,
        slotNo: String,
        feederCode: String?,
        lotNo: String,
        materialCode: String?,
        qty: Int?,
        operator: String
    ): Result<FeederBindingValidateResponse> {
        return try {
            val request = FeederBindingValidateRequest(
                workOrderCode = workOrderCode,
                lineCode = lineCode,
                machineCode = machineCode,
                channelCode = channelCode,
                slotNo = slotNo,
                feederCode = feederCode,
                lotNo = lotNo,
                materialCode = materialCode,
                qty = qty,
                operator = operator
            )
            val response = api.feederBindingValidate(request)
            if (response.isSuccessful) {
                val data = response.body()?.data
                if (data != null) Result.success(data)
                else Result.failure(Exception("feederBindingValidate: no response data"))
            } else {
                Result.failure(Exception(parseErrorMessage(response)))
            }
        } catch (e: Exception) {
            Result.failure(Exception("Network error: ${e.message}"))
        }
    }

    /** Confirm binding after validation passes */
    suspend fun feederBindingConfirm(
        workOrderCode: String,
        lineCode: String?,
        machineCode: String,
        channelCode: String?,
        slotNo: String,
        feederCode: String?,
        lotNo: String,
        materialCode: String?,
        qty: Int?,
        operator: String,
        signatureHash: String? = null,
        signedBy: String? = null,
        evidenceQr: String? = null
    ): Result<FeederBindingConfirmResponse> {
        return try {
            val request = FeederBindingConfirmRequest(
                workOrderCode = workOrderCode,
                lineCode = lineCode,
                machineCode = machineCode,
                channelCode = channelCode,
                slotNo = slotNo,
                feederCode = feederCode,
                lotNo = lotNo,
                materialCode = materialCode,
                qty = qty,
                operator = operator,
                signatureHash = signatureHash,
                signedBy = signedBy,
                evidenceQr = evidenceQr
            )
            val response = api.feederBindingConfirm(request)
            if (response.isSuccessful) {
                val data = response.body()?.data
                if (data != null) Result.success(data)
                else Result.failure(Exception("feederBindingConfirm: no response data"))
            } else {
                Result.failure(Exception(parseErrorMessage(response)))
            }
        } catch (e: Exception) {
            Result.failure(Exception("Network error: ${e.message}"))
        }
    }

    /** Unbind / return material from slot */
    suspend fun feederBindingUnbind(
        id: String,
        reasonCode: String,
        reasonNote: String?,
        qualityVerdict: String,
        operator: String?
    ): Result<FeederBindingUnbindResponse> {
        return try {
            val request = FeederBindingUnbindRequest(
                reasonCode = reasonCode,
                reasonNote = reasonNote,
                qualityVerdict = qualityVerdict,
                operator = operator
            )
            val response = api.feederBindingUnbind(id, request)
            if (response.isSuccessful) {
                val data = response.body()?.data
                if (data != null) Result.success(data)
                else Result.failure(Exception("feederBindingUnbind: no response data"))
            } else {
                Result.failure(Exception(parseErrorMessage(response)))
            }
        } catch (e: Exception) {
            Result.failure(Exception("Network error: ${e.message}"))
        }
    }

    /** Get all active bindings for a work order */
    suspend fun feederBindingList(workOrderCode: String): Result<List<FeederBindingConfirmResponse>> {
        return try {
            val response = api.feederBindingList(workOrderCode)
            if (response.isSuccessful) {
                val data = response.body()?.data ?: emptyList()
                Result.success(data)
            } else {
                Result.failure(Exception(parseErrorMessage(response)))
            }
        } catch (e: Exception) {
            Result.failure(Exception("Network error: ${e.message}"))
        }
    }

    private fun parseError(response: retrofit2.Response<*>): Exception {
        return try {
            val body = response.errorBody()?.string()
            if (body != null) {
                val error = com.google.gson.Gson().fromJson(body, ApiEnvelope::class.java)
                Exception(error.error?.message ?: "Error ${response.code()}")
            } else {
                Exception("Error ${response.code()}")
            }
        } catch (e: Exception) {
            Exception("Error ${response.code()}")
        }
    }

    private fun parseErrorMessage(response: retrofit2.Response<*>): String {
        return try {
            val body = response.errorBody()?.string()
            if (body != null) {
                val error = com.google.gson.Gson().fromJson(body, ApiEnvelope::class.java)
                error.error?.message ?: "Error ${response.code()}"
            } else {
                "Error ${response.code()}"
            }
        } catch (e: Exception) {
            "Error ${response.code()}"
        }
    }
}
