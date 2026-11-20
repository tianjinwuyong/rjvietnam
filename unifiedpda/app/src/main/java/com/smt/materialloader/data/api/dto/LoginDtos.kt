package com.smt.materialloader.data.api.dto

import com.google.gson.annotations.SerializedName

data class LoginRequest(
    @SerializedName("username") val username: String,
    @SerializedName("password") val password: String
)

data class LoginResponse(
    @SerializedName("token") val token: String,
    @SerializedName("user") val user: UserInfo,
    @SerializedName("expiresAt") val expiresAt: String,
    @SerializedName("roleDefinition") val roleDefinition: PdaRoleDefinition? = null
)

data class PdaRoleDefinition(
    @SerializedName("roleKey") val roleKey: String = "",
    @SerializedName("responsibilities") val responsibilities: List<String> = emptyList(),
    @SerializedName("domains") val domains: Map<String, List<String>> = emptyMap(),
    @SerializedName("pages") val pages: List<String> = emptyList(),
    @SerializedName("actions") val actions: List<String> = emptyList(),
    @SerializedName("closedLoop") val closedLoop: List<String> = emptyList()
)

data class UserInfo(
    @SerializedName("id") val id: String,
    @SerializedName("username") val username: String,
    @SerializedName("displayName") val displayName: String,
    @SerializedName("locale") val locale: String,
    @SerializedName("roleKey") val roleKey: String,
    @SerializedName("permissions") val permissions: List<String> = emptyList()
    ,@SerializedName("lineCode") val lineCode: String? = null,
    @SerializedName("roleDefinition") val roleDefinition: PdaRoleDefinition? = null,
    /** Stable authority tier; never infer this from displayName. */
    @SerializedName("seniority") val seniority: String? = null
)

data class SessionResponse(
    @SerializedName("session") val session: SessionInfo,
    @SerializedName("permissions") val permissions: List<String>,
    @SerializedName("roleDefinition") val roleDefinition: PdaRoleDefinition? = null
)

data class SessionInfo(
    @SerializedName("userId") val userId: String,
    @SerializedName("username") val username: String,
    @SerializedName("displayName") val displayName: String,
    @SerializedName("locale") val locale: String,
    @SerializedName("roleKey") val roleKey: String,
    @SerializedName("issuedAt") val issuedAt: String,
    @SerializedName("expiresAt") val expiresAt: String,
    @SerializedName("roleDefinition") val roleDefinition: PdaRoleDefinition? = null
)
