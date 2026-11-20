package com.smt.materialloader.data.repository

import com.smt.materialloader.data.api.RetrofitClient
import com.smt.materialloader.data.api.dto.*
import com.google.gson.Gson

class ShelfRepository {
    private val api get() = RetrofitClient.getApiService()

    suspend fun getShelfList(): Result<ShelfListResponse> {
        return try {
            val response = api.getShelfList()
            if (response.isSuccessful) {
                val envelope = response.body()
                val data = envelope?.data
                if (data != null) {
                    Result.success(data)
                } else {
                    Result.failure(Exception(envelope?.error?.message ?: "Failed to load shelf list"))
                }
            } else {
                Result.failure(Exception(parseErrorMessage(response)))
            }
        } catch (e: Exception) {
            Result.failure(Exception("Network error: ${e.message}"))
        }
    }

    suspend fun getShelfDetail(shelfCode: String): Result<ShelfDetailResponse> {
        return try {
            val response = api.getShelfDetail(shelfCode)
            if (response.isSuccessful) {
                val envelope = response.body()
                val data = envelope?.data
                if (data != null) {
                    Result.success(data)
                } else {
                    Result.failure(Exception(envelope?.error?.message ?: "Failed to load shelf detail"))
                }
            } else {
                Result.failure(Exception(parseErrorMessage(response)))
            }
        } catch (e: Exception) {
            Result.failure(Exception("Network error: ${e.message}"))
        }
    }

    suspend fun shelfIn(req: ShelfInRequest): Result<ShelfActionResponse> {
        return try {
            val response = api.shelfIn(req)
            if (response.isSuccessful) {
                val envelope = response.body()
                val data = envelope?.data
                if (data != null) {
                    Result.success(data)
                } else {
                    Result.failure(Exception(envelope?.error?.message ?: "Shelf in failed"))
                }
            } else {
                Result.failure(Exception(parseErrorMessage(response)))
            }
        } catch (e: Exception) {
            Result.failure(Exception("Network error: ${e.message}"))
        }
    }

    suspend fun shelfOut(req: ShelfOutRequest): Result<ShelfActionResponse> {
        return try {
            val response = api.shelfOut(req)
            if (response.isSuccessful) {
                val envelope = response.body()
                val data = envelope?.data
                if (data != null) {
                    Result.success(data)
                } else {
                    Result.failure(Exception(envelope?.error?.message ?: "Shelf out failed"))
                }
            } else {
                Result.failure(Exception(parseErrorMessage(response)))
            }
        } catch (e: Exception) {
            Result.failure(Exception("Network error: ${e.message}"))
        }
    }

    suspend fun getTransactions(
        shelfCode: String? = null,
        action: String? = null,
        limit: Int? = null,
        offset: Int? = null
    ): Result<TransactionHistoryResponse> {
        return try {
            val response = api.getShelfTransactions(shelfCode, action, limit, offset)
            if (response.isSuccessful) {
                val envelope = response.body()
                val data = envelope?.data
                if (data != null) {
                    Result.success(data)
                } else {
                    Result.failure(Exception(envelope?.error?.message ?: "Failed to load transactions"))
                }
            } else {
                Result.failure(Exception(parseErrorMessage(response)))
            }
        } catch (e: Exception) {
            Result.failure(Exception("Network error: ${e.message}"))
        }
    }

    private fun parseErrorMessage(response: retrofit2.Response<*>): String {
        return try {
            val errorBody = response.errorBody()?.string()
            if (errorBody != null) {
                val error = Gson().fromJson(errorBody, ApiEnvelope::class.java)
                error.error?.message ?: "Unknown error"
            } else {
                "Error ${response.code()}"
            }
        } catch (e: Exception) {
            "Error ${response.code()}"
        }
    }
}