package com.smt.materialloader.ui.signification

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.google.gson.JsonObject
import com.smt.materialloader.BuildConfig
import com.smt.materialloader.MaterialLoaderApp
import com.smt.materialloader.R
import kotlinx.coroutines.launch

private data class ApprovalNode(
    val stepNo: Int, val name: String, val role: String, val status: String,
    val dueAt: String?, val slaHours: Int
)

private data class SignItem(
    val id: Long, val number: String, val title: String, val category: String,
    val version: String, val checksum: String, val currentStep: Int,
    val totalSteps: Int, val nodes: List<ApprovalNode>
)

private fun String.safeDate(): String = replace("T", " ").take(16)

private fun parseItems(body: JsonObject?): List<SignItem> {
    val data = body?.getAsJsonObject("data") ?: return emptyList()
    val items = data.getAsJsonArray("items") ?: return emptyList()
    return items.mapNotNull { element ->
        runCatching {
            val item = element.asJsonObject
            val nodes = item.getAsJsonArray("steps")?.map { raw ->
                val node = raw.asJsonObject
                ApprovalNode(
                    node.get("stepNo")?.asInt ?: 0,
                    node.get("stepName")?.asString.orEmpty(),
                    node.get("approverRole")?.asString.orEmpty(),
                    node.get("status")?.asString.orEmpty(),
                    node.get("dueAt")?.takeUnless { it.isJsonNull }?.asString,
                    node.get("slaHours")?.asInt ?: 0
                )
            }.orEmpty()
            SignItem(
                item.get("id").asLong,
                item.get("documentNo")?.asString.orEmpty(),
                item.get("title")?.asString.orEmpty(),
                item.get("category")?.asString.orEmpty(),
                item.get("versionNo")?.asString.orEmpty(),
                item.get("checksumSha256")?.asString.orEmpty(),
                item.get("currentStep")?.asInt ?: 0,
                item.get("totalSteps")?.asInt ?: 0,
                nodes
            )
        }.getOrNull()
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SignificationScreen(onBack: () -> Unit) {
    val app = MaterialLoaderApp.instance
    val user = app.prefs.getUser()
    val scope = rememberCoroutineScope()
    var items by remember { mutableStateOf<List<SignItem>>(emptyList()) }
    var selected by remember { mutableStateOf<SignItem?>(null) }
    var feedback by remember { mutableStateOf("") }
    var message by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(true) }
    val testIdentity = BuildConfig.TEST_ACTION_BYPASS_ENABLED && user?.id?.startsWith("test-") == true

    fun refresh() {
        scope.launch {
            loading = true
            message = null
            val response = runCatching { app.apiService.oaSignificationDocuments() }.getOrNull()
            items = if (response?.isSuccessful == true) parseItems(response.body()) else emptyList()
            if (response?.isSuccessful != true) message = response?.errorBody()?.string() ?: app.getString(R.string.signification_load_failed)
            selected = selected?.let { old -> items.firstOrNull { it.id == old.id } }
            loading = false
        }
    }

    fun decide(decision: String) {
        val document = selected ?: return
        if (decision == "REJECT" && feedback.isBlank()) {
            message = app.getString(R.string.signification_rejection_required)
            return
        }
        scope.launch {
            loading = true
            val response = runCatching {
                app.apiService.oaSignificationDecision(document.id, mapOf(
                    "decision" to decision,
                    "note" to feedback.trim(),
                    "deviceId" to android.provider.Settings.Secure.getString(app.contentResolver, android.provider.Settings.Secure.ANDROID_ID),
                    "signedInOperator" to user?.username,
                    "signatureMethod" to "PDA_LOGGED_IN_USER"
                ))
            }.getOrNull()
            if (response?.isSuccessful == true) {
                message = app.getString(R.string.signification_feedback_sent)
                feedback = ""
                selected = null
                refresh()
            } else {
                message = response?.errorBody()?.string() ?: app.getString(R.string.signification_decision_failed)
                loading = false
            }
        }
    }

    LaunchedEffect(Unit) { refresh() }

    Scaffold(topBar = {
        TopAppBar(
            title = { Column { Text(stringResource(R.string.signification_title), fontWeight = FontWeight.Bold); Text(user?.displayName.orEmpty(), fontSize = 12.sp) } },
            navigationIcon = { TextButton(onClick = { if (selected != null) selected = null else onBack() }) { Text(stringResource(R.string.common_back)) } },
            actions = { TextButton(enabled = !loading, onClick = { refresh() }) { Text(stringResource(R.string.signification_refresh)) } }
        )
    }) { padding ->
        LazyColumn(
            Modifier.fillMaxSize().padding(padding).background(Color(0xFFF1F5F9)).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            item {
                Card(colors = CardDefaults.cardColors(containerColor = Color(0xFFE0F2FE))) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(stringResource(R.string.signification_logged_user, user?.displayName ?: user?.username.orEmpty()), fontWeight = FontWeight.Bold)
                        Text(stringResource(R.string.signification_identity_notice), color = Color(0xFF334155), fontSize = 12.sp)
                        if (testIdentity) Text(stringResource(R.string.signification_test_read_only), color = Color(0xFFB91C1C), fontWeight = FontWeight.Bold, fontSize = 12.sp)
                        Text(stringResource(R.string.signification_pending_count, items.size), color = Color(0xFF0369A1))
                    }
                }
            }
            message?.let { notice -> item { Card(colors = CardDefaults.cardColors(containerColor = Color(0xFFDCFCE7))) { Text(notice, Modifier.padding(12.dp), color = Color(0xFF166534)) } } }
            if (loading) item { LinearProgressIndicator(Modifier.fillMaxWidth()) }
            if (!loading && items.isEmpty()) item { Text(stringResource(R.string.signification_empty), color = Color(0xFF64748B), modifier = Modifier.padding(vertical = 24.dp)) }
            if (selected == null) {
                items(items, key = { it.id }) { item ->
                    val node = item.nodes.firstOrNull { it.stepNo == item.currentStep }
                    Card(Modifier.fillMaxWidth().clickable { selected = item; message = null }) {
                        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                Text("${item.number} · v${item.version}", fontWeight = FontWeight.Bold)
                                Text(node?.status.orEmpty(), color = if (node?.status == "OVERDUE") Color(0xFFB91C1C) else Color(0xFFB45309))
                            }
                            Text(item.title, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
                            Text("${node?.name} · ${node?.role}", color = Color(0xFF475569))
                            Text(stringResource(R.string.signification_due, node?.dueAt?.safeDate() ?: "—"), fontSize = 12.sp)
                            Text(stringResource(R.string.signification_open), color = Color(0xFF0369A1), fontWeight = FontWeight.Bold)
                        }
                    }
                }
            } else {
                item {
                    val item = selected!!
                    val node = item.nodes.firstOrNull { it.stepNo == item.currentStep }
                    Card(Modifier.fillMaxWidth()) {
                        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text("${item.number} · v${item.version}", color = Color(0xFF0369A1), fontWeight = FontWeight.Bold)
                            Text(item.title, style = MaterialTheme.typography.headlineSmall)
                            Text("${item.category} · SHA-256 ${item.checksum.take(16)}…", fontSize = 12.sp, color = Color(0xFF64748B))
                            HorizontalDivider()
                            Text(stringResource(R.string.signification_route, item.currentStep, item.totalSteps), fontWeight = FontWeight.Bold)
                            item.nodes.forEach { routeNode ->
                                Text("${routeNode.stepNo}. ${routeNode.name} · ${routeNode.role} · ${routeNode.status}${if (routeNode.dueAt != null) " · ${routeNode.dueAt.safeDate()}" else ""}", color = if (routeNode.stepNo == item.currentStep) Color(0xFF0F172A) else Color(0xFF64748B))
                            }
                            Text(stringResource(R.string.signification_current_node, node?.name.orEmpty(), node?.slaHours ?: 0), fontWeight = FontWeight.Bold)
                            OutlinedTextField(feedback, { feedback = it }, Modifier.fillMaxWidth(), label = { Text(stringResource(R.string.signification_feedback)) }, minLines = 3)
                            Button(enabled = !loading && !testIdentity, onClick = { decide("APPROVE") }, modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.signification_approve)) }
                            Button(enabled = !loading && !testIdentity && feedback.isNotBlank(), onClick = { decide("REJECT") }, colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFB91C1C)), modifier = Modifier.fillMaxWidth()) { Text(stringResource(R.string.signification_reject)) }
                        }
                    }
                }
            }
        }
    }
}
