package com.smt.materialloader.ui.manager

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.google.gson.JsonObject
import com.smt.materialloader.MaterialLoaderApp
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class CommunicationChannel(val code: String, val name: String)
data class CommunicationMessage(val id: String, val subject: String, val body: String, val priority: String, val status: String, val sender: String, val createdAt: String, val acknowledged: Boolean)
data class CommunicationState(val online: Boolean = false, val channels: List<CommunicationChannel> = emptyList(), val messages: List<CommunicationMessage> = emptyList(), val error: String? = null, val result: String? = null)

class CommunicationCenterViewModel : ViewModel() {
    private val api = MaterialLoaderApp.instance.apiService
    private val _state = MutableStateFlow(CommunicationState())
    val state = _state.asStateFlow()
    fun refresh(channel: String) = viewModelScope.launch {
        try {
            val channelResponse = api.managerChannels(); val messageResponse = api.managerChannelMessages(channel)
            val channels = channelResponse.body()?.getAsJsonArray("data")?.map { o ->
                val x = o.asJsonObject; CommunicationChannel(x.s("channelCode"), x.s("nameZh").ifBlank { x.s("nameEn") })
            } ?: emptyList()
            _state.value = _state.value.copy(online = channelResponse.isSuccessful && messageResponse.isSuccessful, channels = channels, messages = messageResponse.body()?.getAsJsonArray("data")?.map { o ->
                val x = o.asJsonObject; CommunicationMessage(x.s("id"), x.s("subject"), x.s("body"), x.s("priority"), x.s("status"), x.s("senderName"), x.s("createdAt"), x.get("acknowledgedAt")?.isJsonNull == false)
            } ?: emptyList(), error = if (channelResponse.isSuccessful) null else "通信接口 HTTP ${channelResponse.code()}")
        } catch (e: Exception) { _state.value = _state.value.copy(online = false, error = "通信接口连接失败：${e.message}") }
    }
    fun send(channel: String, subject: String, body: String) = viewModelScope.launch {
        if (subject.isBlank() || body.isBlank()) { _state.value = _state.value.copy(result = "主题和内容不能为空"); return@launch }
        val r = api.managerSendChannelMessage(channel, mapOf("subject" to subject, "body" to body, "priority" to "IMPORTANT"))
        _state.value = _state.value.copy(result = if (r.isSuccessful) "消息已发送并分发给对应部门" else "MES 拒绝发送：HTTP ${r.code()}")
        if (r.isSuccessful) refresh(channel)
    }
    fun ack(channel: String, id: String, reply: String) = viewModelScope.launch { val r = api.managerAcknowledgeChannelMessage(id, mapOf("reply" to reply)); _state.value = _state.value.copy(result = if (r.isSuccessful) "已确认并回写 MES" else "确认失败：HTTP ${r.code()}"); if (r.isSuccessful) refresh(channel) }
    private fun JsonObject.s(name: String): String = get(name)?.takeUnless { it.isJsonNull }?.asString ?: "-"
}

@Composable
fun CommunicationCenterScreen(onBack: () -> Unit, viewModel: CommunicationCenterViewModel = viewModel()) {
    val state by viewModel.state.collectAsState(); var channel by remember { mutableStateOf("ALL_DEPARTMENTS") }; var subject by remember { mutableStateOf("") }; var body by remember { mutableStateOf("") }; var reply by remember { mutableStateOf("") }
    LaunchedEffect(channel) { viewModel.refresh(channel); while (true) { delay(10_000); viewModel.refresh(channel) } }
    Column(Modifier.fillMaxSize().background(Color(0xFFF1F5F9))) {
        Row(Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.SpaceBetween) { Column { Text("全厂通信中心", fontSize = 24.sp, fontWeight = FontWeight.Bold); Text(if (state.online) "MES 在线 · 10 秒刷新" else "MES 未连接", color = if (state.online) Color(0xFF166534) else Color(0xFF991B1B), fontSize = 12.sp) }; TextButton(onClick = onBack) { Text("返回") } }
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) { state.channels.forEach { c -> FilterChip(selected = channel == c.code, onClick = { channel = c.code }, label = { Text(c.name, fontSize = 11.sp) }) } }
        state.result?.let { Text(it, modifier = Modifier.padding(16.dp), color = Color(0xFF166534)) }
        LazyColumn(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(9.dp)) {
            item { OutlinedTextField(subject, { subject = it }, label = { Text("主题") }, modifier = Modifier.fillMaxWidth()) }
            item { OutlinedTextField(body, { body = it }, label = { Text("发送给当前频道") }, modifier = Modifier.fillMaxWidth(), minLines = 3) }
            item { Button(enabled = state.online, onClick = { viewModel.send(channel, subject, body); subject = ""; body = "" }, modifier = Modifier.fillMaxWidth()) { Text("发送消息") } }
            items(state.messages, key = { it.id }) { message -> Card(colors = CardDefaults.cardColors(containerColor = Color.White), modifier = Modifier.fillMaxWidth()) { Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) { Text("${message.priority} · ${message.subject}", fontWeight = FontWeight.Bold); Text(message.body); Text("${message.sender} · ${message.createdAt} · ${message.status}", color = Color(0xFF64748B), fontSize = 12.sp); if (!message.acknowledged) { OutlinedTextField(reply, { reply = it }, label = { Text("回复") }, modifier = Modifier.fillMaxWidth()); Button(onClick = { viewModel.ack(channel, message.id, reply); reply = "" }) { Text("确认并回复") } } } } }
        }
    }
}
