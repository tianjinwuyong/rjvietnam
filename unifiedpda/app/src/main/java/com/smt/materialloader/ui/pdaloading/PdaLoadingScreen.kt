package com.smt.materialloader.ui.pdaloading

import androidx.activity.compose.BackHandler
import android.speech.tts.TextToSpeech
import androidx.compose.foundation.background
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.smt.materialloader.BuildConfig
import com.smt.materialloader.MaterialLoaderApp
import com.smt.materialloader.ui.components.BarcodeScanner
import com.smt.materialloader.ui.components.MaterialLabelOcrResult
import com.smt.materialloader.ui.components.MaterialLabelOcrScanner
import kotlinx.coroutines.delay
import java.time.Duration
import java.time.Instant
import java.util.Locale

private val Navy = Color(0xFF12324A)
private val Green = Color(0xFF087F5B)
private val Red = Color(0xFFB42318)

@Composable
fun PdaLoadingScreen(onBack: (() -> Unit)? = null, onOpenHistory: (() -> Unit)? = null, onOpenForecast: (() -> Unit)? = null, vm: PdaLoadingViewModel = viewModel()) {
    BackHandler(enabled = onBack != null) { onBack?.invoke() }
    val state by vm.state.collectAsState()
    val roleKey = MaterialLoaderApp.instance.prefs.getUser()?.roleKey?.uppercase().orEmpty()
    val loadingDomain = when (roleKey) {
        "MANUAL_LINE_LOADER" -> "MANUAL LINE LOADING"
        "AUTO_LINE_LOADER" -> "AUTO LINE LOADING"
        "SMT_LOADER" -> "SMT 上料模块"
        else -> "物料上料模块"
    }
    fun t(key: String) = PdaLoadingStrings.get(state.language, key)
    var scannerText by remember { mutableStateOf("") }
    var leader by remember { mutableStateOf("") }
    var showTestBypass by remember { mutableStateOf(false) }
    var cameraOpen by remember { mutableStateOf(false) }
    var ocrOpen by remember { mutableStateOf(false) }
    var ocrResult by remember { mutableStateOf<MaterialLabelOcrResult?>(null) }
    var cameraError by remember { mutableStateOf<String?>(null) }
    var testReason by remember { mutableStateOf("") }
    var testLeader by remember { mutableStateOf("") }
    var languageMenuOpen by remember { mutableStateOf(false) }
    var detailsOpen by remember { mutableStateOf(false) }
    val focus = remember { FocusRequester() }
    val context = androidx.compose.ui.platform.LocalContext.current
    var ttsReady by remember { mutableStateOf(false) }
    val tts = remember {
        TextToSpeech(context.applicationContext) { status ->
            ttsReady = status == TextToSpeech.SUCCESS
        }
    }

    DisposableEffect(tts) {
        onDispose {
            tts.stop()
            tts.shutdown()
        }
    }
    LaunchedEffect(ttsReady, state.language) {
        if (ttsReady) {
            tts.language = when (state.language) {
                "en" -> Locale.US
                "vi" -> Locale("vi", "VN")
                else -> Locale.SIMPLIFIED_CHINESE
            }
        }
    }
    LaunchedEffect(ttsReady, state.bindingSuccess) {
        val success = state.bindingSuccess
        if (ttsReady && success != null) {
            val voice = if (success.allMaterialsBound) {
                t("bindingSuccessAll")
            } else {
                t("bindingSuccessNext")
            }
            tts.speak(voice, TextToSpeech.QUEUE_FLUSH, null, "pda-binding-success")
        }
    }
    LaunchedEffect(ttsReady, state.completedWorkOrderCode) {
        if (ttsReady && state.completedWorkOrderCode != null) {
            tts.speak(t("woCompletedMessage"), TextToSpeech.QUEUE_FLUSH, null, "pda-wo-completed")
        }
    }
    LaunchedEffect(ttsReady, state.message) {
        if (ttsReady && state.message.startsWith("绑定成功：")) {
            val reminder = when (state.language) {
                "en" -> "Material bound successfully. Start the next material from machine scan."
                "vi" -> "Đã gán vật liệu thành công. Bắt đầu vật liệu tiếp theo từ quét máy."
                else -> "物料绑定成功。请开始下一个物料，从机器扫码开始。"
            }
            tts.speak(reminder, TextToSpeech.QUEUE_FLUSH, null, "pda-next-material")
        }
    }

    LaunchedEffect(state.step, state.alarm) {
        if (state.step != LoadingStep.SETUP) {
            delay(100)
            focus.requestFocus()
        }
    }
    LaunchedEffect(Unit) {
        while (true) {
            delay(10_000)
            vm.refreshWorkOrders(false)
            vm.checkActiveLoading()
        }
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(Color(0xFFEDF2F6))
            .pointerInput(onBack, onOpenHistory) {
                var distance = 0f
                detectHorizontalDragGestures(
                    onDragStart = { distance = 0f },
                    onHorizontalDrag = { _, dragAmount -> distance += dragAmount },
                    onDragEnd = {
                        when {
                            distance > 140f -> onBack?.invoke()
                            distance < -140f -> onOpenHistory?.invoke()
                        }
                    }
                )
            }
    ) {
        Row(
            Modifier.fillMaxWidth().background(Navy).padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            if (onBack != null) {
                TextButton(onClick = onBack, colors = ButtonDefaults.textButtonColors(contentColor = Color.White)) {
                    Text("管理")
                }
            }
            Column(Modifier.weight(1f)) {
                Text(
                    when (state.language) {
                        "en" -> "Unified PDA"
                        "vi" -> "PDA hợp nhất"
                        else -> "统一 PDA"
                    },
                    color = Color.White, fontSize = 22.sp, fontWeight = FontWeight.Bold
                )
                Text(loadingDomain, color = Color(0xFFFFD166), fontSize = 13.sp, fontWeight = FontWeight.Bold)
                val assignedLine = MaterialLoaderApp.instance.prefs.getUser()?.lineCode?.trim()?.uppercase().orEmpty().ifBlank { "MES" }
                Text("${if (assignedLine == "L004") "MANUAL LINE" else "SMT"} $assignedLine · ${if (state.online) "MES ONLINE" else "MES OFFLINE"}",
                    color = if (state.online) Color(0xFF8CF1D2) else Color(0xFFFFB4AB))
            }
            if (onOpenForecast != null) {
                TextButton(onClick = onOpenForecast, colors = ButtonDefaults.textButtonColors(contentColor = Color.White)) {
                    Text("早班生产准备", fontWeight = FontWeight.Bold)
                }
            }
            Box {
                OutlinedButton(
                    onClick = { languageMenuOpen = true },
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = Color.White),
                    border = BorderStroke(1.dp, Color(0xFF8FA9BA))
                ) {
                    Text(
                        when (state.language) {
                            "en" -> "EN"
                            "vi" -> "VI"
                            else -> "中文"
                        },
                        fontWeight = FontWeight.Bold
                    )
                }
                DropdownMenu(
                    expanded = languageMenuOpen,
                    onDismissRequest = { languageMenuOpen = false }
                ) {
                    listOf("中文" to "zh", "English" to "en", "Tiếng Việt" to "vi")
                        .forEach { (label, code) ->
                            DropdownMenuItem(
                                text = { Text(label) },
                                onClick = {
                                    vm.language(code)
                                    languageMenuOpen = false
                                }
                            )
                        }
                }
            }
        }

        Column(
            (if (state.step == LoadingStep.SETUP) Modifier.verticalScroll(rememberScrollState()) else Modifier)
                .fillMaxSize()
                .padding(14.dp)
        ) {
            if (state.step == LoadingStep.SETUP) {
                Card(
                    modifier = Modifier.fillMaxWidth().padding(bottom = 10.dp),
                    colors = CardDefaults.cardColors(containerColor = Color(0xFFE7F6F0)),
                    border = BorderStroke(1.dp, Green)
                ) {
                    Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(
                            when (state.language) {
                                "en" -> "QUICK LOADING"
                                "vi" -> "CẤP LIỆU NHANH"
                                else -> "快速上料"
                            },
                            color = Navy,
                            fontWeight = FontWeight.Bold,
                            fontSize = 18.sp
                        )
                        Text(
                            when (state.language) {
                                "en" -> "1. Select the ACTIVE MES work order  2. Scan NPM machine QR  3. Scan channel/position QR  4. Scan feeder QR  5. Scan material roll QR"
                                "vi" -> "1. Chọn lệnh MES  2. Nhấn Bắt đầu  3. Quét từng vật liệu"
                                else -> "1. 选择 MES 工单  2. 点击开始  3. 每次扫码一项物料"
                            },
                            color = Color(0xFF415A6B),
                            fontSize = 13.sp
                        )
                        state.workOrders.firstOrNull { it.code == state.workOrder }?.let { selected ->
                            Text(
                                "${if (selected.lineCode == "L004") "MANUAL LINE" else selected.lineCode.ifBlank { "LINE" }} · WO ${selected.code}",
                                color = Green,
                                fontWeight = FontWeight.Bold,
                                fontSize = 13.sp
                            )
                        }
                    }
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(t("workOrders"), color = Navy, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                    TextButton(onClick = { vm.refreshWorkOrders(true) }) { Text(t("refresh")) }
                }
                if (state.loadingWorkOrders) {
                    LinearProgressIndicator(Modifier.fillMaxWidth())
                } else if (state.workOrders.isEmpty()) {
                    Card(Modifier.fillMaxWidth()) {
                        Text(t("waitingWo"),
                            modifier = Modifier.padding(18.dp))
                    }
                } else {
                    val displayedWorkOrders = state.workOrders.sortedByDescending { it.activeForLoading }
                    Text(
                        "一次只处理一个 MES 工单；每次只扫描一种物料",
                        color = Color(0xFF6B4F00),
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.padding(vertical = 4.dp)
                    )
                    LazyColumn(Modifier.heightIn(max = 300.dp).fillMaxWidth()) {
                        items(displayedWorkOrders) { wo ->
                            Card(
                                onClick = { vm.selectWorkOrder(wo.code) },
                                enabled = wo.activeForLoading,
                                colors = CardDefaults.cardColors(
                                    containerColor = if (state.workOrder == wo.code) Color(0xFFC7F0E2) else Color.White,
                                    contentColor = Navy
                                ),
                                border = BorderStroke(
                                    if (state.workOrder == wo.code) 2.dp else 1.dp,
                                    if (state.workOrder == wo.code) Green else Color(0xFFB8C5CF)
                                ),
                                modifier = Modifier.fillMaxWidth().padding(vertical = 3.dp)
                            ) {
                                Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                                    RadioButton(selected = state.workOrder == wo.code,
                                        onClick = { if (wo.activeForLoading) vm.selectWorkOrder(wo.code) },
                                        enabled = wo.activeForLoading)
                                    Column {
                                        Text(wo.code, color = Color(0xFF102A3C), fontWeight = FontWeight.Bold, fontSize = 18.sp)
                                        Text(
                                            "${t("bindingProgress")}: ${wo.boundMaterialCount} / ${wo.materialCount}",
                                            color = if (wo.materialCount > 0 && wo.boundMaterialCount >= wo.materialCount) Green else Navy,
                                            fontWeight = FontWeight.Bold
                                        )
                                        LinearProgressIndicator(
                                            progress = {
                                                if (wo.materialCount == 0) 0f
                                                else (wo.boundMaterialCount.toFloat() / wo.materialCount).coerceIn(0f, 1f)
                                            },
                                            modifier = Modifier.fillMaxWidth().padding(top = 4.dp)
                                        )
                                        val pdaStatus = if (wo.activeForLoading) "ACTIVE - LOAD ALLOWED" else "QUEUED - LOAD BLOCKED"
                                        Text("${wo.productCode}  ${wo.productName}  ·  $pdaStatus  ·  ${wo.plannedQty}")
                                    }
                                }
                            }
                        }
                    }
                }
                TextButton(
                    onClick = { detailsOpen = !detailsOpen },
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(
                        if (detailsOpen) {
                            when (state.language) { "en" -> "Hide details"; "vi" -> "Ẩn chi tiết"; else -> "收起详细信息" }
                        } else {
                            when (state.language) { "en" -> "Show BOM and schedule details"; "vi" -> "Xem BOM và lịch"; else -> "查看 BOM 与排程详情" }
                        },
                        color = Navy,
                        fontWeight = FontWeight.Bold
                    )
                }
                if (detailsOpen) state.workOrders.firstOrNull { it.code == state.workOrder }?.let { wo ->
                    Spacer(Modifier.height(8.dp))
                    Card(
                        colors = CardDefaults.cardColors(containerColor = Color.White),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Column(Modifier.padding(10.dp)) {
                            Text(
                                "${t("materialList")} (${wo.materialCount}) · ${t("bindingProgress")} ${wo.boundMaterialCount}/${wo.materialCount}",
                                color = Navy, fontWeight = FontWeight.Bold
                            )
                            LazyColumn(Modifier.heightIn(max = 105.dp).fillMaxWidth()) {
                                itemsIndexed(wo.materials) { index, material ->
                                    Row(
                                        Modifier.fillMaxWidth().padding(vertical = 3.dp),
                                        verticalAlignment = Alignment.CenterVertically
                                    ) {
                                        Text("${index + 1}.", modifier = Modifier.width(34.dp), color = Color.Gray)
                                        Column(Modifier.weight(1f)) {
                                            Text(material.code, fontWeight = FontWeight.Bold, color = Navy)
                                            Text("顺序 ${material.loadingSequence} · ${material.name}", fontSize = 12.sp)
                                            Text(
                                                "每卷数量: ${material.rollQty} ${material.uom}  ·  消耗速度: ${material.consumptionRatePerMinute} ${material.uom}/分钟\n" +
                                                    "实际消耗: ${material.actualConsumedQty} ${material.uom}  ·  实际速度: ${material.actualConsumptionRatePerMinute} ${material.uom}/分钟\n" +
                                                    "${t("qtyPer")}: ${material.qtyPer} ${material.uom}  ·  " +
                                                    "${t("requiredQty")}: ${material.requiredQty} ${material.uom}\n" +
                                                    "${t("availableQty")}: ${material.availableQty} ${material.uom} · " +
                                                    t(if (material.supplySafe) "supplySafe" else "supplyShortage") +
                                                    "\n预计耗尽: ${material.estimatedDepletionAt ?: "MES暂无估算"}",
                                                fontSize = 12.sp, color = Color(0xFF415A6B)
                                            )
                                        }
                                        Text(
                                            when {
                                                material.bound -> t("bound")
                                                state.dispatchReady && state.assignedMaterialCodes.contains(material.code.uppercase()) -> "本PDA / THIS PDA"
                                                state.dispatchReady -> "其他PDA/未分配 / OTHER PDA"
                                                else -> t("waiting")
                                            },
                                            color = when {
                                                material.bound -> Green
                                                state.dispatchReady && state.assignedMaterialCodes.contains(material.code.uppercase()) -> Green
                                                else -> Color(0xFFB26A00)
                                            },
                                            fontWeight = FontWeight.Bold
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
                if (detailsOpen) state.workOrders.firstOrNull { it.code == state.workOrder }?.let { wo ->
                    LoadingScheduleCard(wo, state)
                }
                Spacer(Modifier.height(12.dp))
                if (state.workOrder in setOf("26072019999", "26072019998", "26072019997")) {
                    Button(
                        onClick = { vm.enableTestBypass() },
                        modifier = Modifier.fillMaxWidth(),
                        colors = ButtonDefaults.buttonColors(Red)
                    ) { Text("⚠ TEST ONLY · Simulate loading time") }
                    if (BuildConfig.TEST_ACTION_BYPASS_ENABLED && state.testBypassAllChecks) {
                        Spacer(Modifier.height(6.dp))
                        Button(
                            onClick = vm::enableMaterialCheckBypass,
                            enabled = !state.busy && !state.testBypassedActions.contains("WMS_ROLL_VALIDATION"),
                            modifier = Modifier.fillMaxWidth(),
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFB45309))
                        ) {
                            Text("TEST ONLY · BYPASS WMS ROLL VALIDATION", fontWeight = FontWeight.Bold)
                        }
                    }
                    Spacer(Modifier.height(8.dp))
                }
                Button(
                    onClick = { vm.recalculateLoadingStart("PAUSED_OR_FEEDER_REPLACED") },
                    enabled = state.workOrder.isNotBlank() && state.online && !state.busy,
                    modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF1D4ED8))
                ) {
                    Text(
                        when (state.language) {
                            "en" -> "RECALCULATE START · STOP / FEEDER CHANGE"
                            "vi" -> "TÍNH LẠI BẮT ĐẦU · DỪNG / ĐỔI FEEDER"
                            else -> "重新计算开始时间 · 停机/更换飞达"
                        },
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Bold
                    )
                }
                Spacer(Modifier.height(8.dp))
                Button(
                    onClick = vm::begin,
                    enabled = state.workOrder.isNotBlank() &&
                        !state.loadingWorkOrders &&
                        state.workOrders.firstOrNull { it.code == state.workOrder }
                            ?.let { it.materialLoadingStatus == "OPEN" && it.activeForLoading } == true &&
                        !(state.dispatchReady && state.assignedMaterialCodes.isEmpty()) &&
                        state.workOrders.firstOrNull { it.code == state.workOrder }
                            ?.let { it.materialCount == 0 || it.boundMaterialCount < it.materialCount } != false,
                    modifier = Modifier.fillMaxWidth(), colors = ButtonDefaults.buttonColors(Green)
                ) {
                    Text(
                        when (state.language) {
                            "en" -> "CONFIRM AND ENTER LOADING"
                            "vi" -> "XÁC NHẬN VÀ VÀO NẠP VẬT LIỆU"
                            else -> "确定并进入上料"
                        },
                        fontSize = 18.sp,
                        fontWeight = FontWeight.Bold
                    )
                }
            } else {
                StatusCard(state) { key -> t(key) }
                if (state.step == LoadingStep.MACHINE) {
                    val activeWo = state.workOrders.firstOrNull { it.code == state.workOrder }
                    val mesAllowsNext = state.online && activeWo?.activeForLoading == true &&
                        activeWo.materialLoadingStatus == "OPEN" &&
                        !(state.dispatchReady && state.assignedMaterialCodes.isEmpty())
                    Card(
                        modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                        colors = CardDefaults.cardColors(containerColor = Color(0xFFE7F6F0)),
                        border = BorderStroke(1.dp, Green)
                    ) {
                        Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(
                                when (state.language) {
                                    "en" -> "One-material loading"
                                    "vi" -> "Cấp liệu từng vật liệu"
                                    else -> "单物料上料模式"
                                },
                                color = Navy,
                                fontWeight = FontWeight.Bold
                            )
                            Text(
                                when (state.language) {
                                    "en" -> "MES selects the next material. Scan one material at a time."
                                    "vi" -> "MES chọn vật liệu tiếp theo. Chỉ quét một vật liệu mỗi lần."
                                    else -> "MES 指定下一种物料；每次只扫描并上料一种物料。"
                                },
                                color = Color(0xFF415A6B),
                                fontSize = 12.sp
                            )
                            Button(
                                onClick = {
                                    cameraError = null
                                    cameraOpen = true
                                    focus.requestFocus()
                                },
                                enabled = !state.busy && mesAllowsNext,
                                modifier = Modifier.fillMaxWidth(),
                                colors = ButtonDefaults.buttonColors(Green)
                            ) {
                                Text(
                                    if (state.boundSlots.isEmpty()) {
                                        when (state.language) {
                                            "en" -> "START LOADING · SCAN MACHINE"
                                            "vi" -> "BẮT ĐẦU CẤP LIỆU · QUÉT MÁY"
                                            else -> "开始上料 · 扫描机器"
                                        }
                                    } else {
                                        when (state.language) {
                                            "en" -> "LOAD NEXT MATERIAL · ONE AT A TIME"
                                            "vi" -> "CẤP VẬT LIỆU TIẾP THEO · TỪNG MÓN"
                                            else -> "开始下一项物料 · 逐项上料"
                                        }
                                    },
                                    fontWeight = FontWeight.Bold
                                )
                            }
                        }
                    }
                }
                val scanFields = listOf(
                    Triple(LoadingStep.MATERIAL, t("materialSn"), state.materialSn),
                    Triple(LoadingStep.MACHINE, t("machine"), state.machine),
                    Triple(LoadingStep.SLOT, t("slot"), state.slot),
                    Triple(LoadingStep.FEEDER, t("feeder"), state.feeder),
                    Triple(LoadingStep.REEL, t("materialSn"), state.materialSn)
                )
                Row(
                    Modifier.fillMaxWidth().padding(top = 6.dp),
                    horizontalArrangement = Arrangement.spacedBy(5.dp)
                ) {
                    scanFields.forEach { (fieldStep, label, value) ->
                        val current = state.step == fieldStep ||
                            (fieldStep == LoadingStep.REEL && state.step == LoadingStep.CONFIRM)
                        val completed = value.isNotBlank() && !current
                        Card(
                            modifier = Modifier.weight(1f),
                            colors = CardDefaults.cardColors(
                                containerColor = when {
                                    current -> Color(0xFFFFD54F)
                                    completed -> Color(0xFFC7F0E2)
                                    else -> Color(0xFFE2E8F0)
                                }
                            ),
                            border = BorderStroke(
                                if (current) 3.dp else 1.dp,
                                if (current) Red else if (completed) Green else Color(0xFF94A3B8)
                            )
                        ) {
                            Column(Modifier.padding(8.dp)) {
                                Text(
                                    label,
                                    color = if (current) Red else Navy,
                                    fontWeight = FontWeight.Bold,
                                    fontSize = 12.sp
                                )
                                Text(
                                    value.ifBlank { if (current) "等待扫码" else "—" },
                                    color = Navy,
                                    fontWeight = if (current) FontWeight.Bold else FontWeight.Normal,
                                    fontSize = 11.sp,
                                    maxLines = 2
                                )
                            }
                        }
                    }
                }
                val activeWo = state.workOrders.firstOrNull { it.code == state.workOrder }
                val slotNumber = Regex("""(\d+)$""").find(state.slot)?.groupValues?.getOrNull(1)?.toIntOrNull()
                val currentMaterial = slotNumber?.let { activeWo?.materials?.getOrNull(it - 1) }
                    ?: activeWo?.materials?.firstOrNull { !it.bound }
                currentMaterial?.let { material ->
                    Card(
                        modifier = Modifier.fillMaxWidth().padding(top = 6.dp),
                        colors = CardDefaults.cardColors(containerColor = Color(0xFFFFF3CD)),
                        border = BorderStroke(2.dp, Color(0xFFF59E0B))
                    ) {
                        Column(Modifier.padding(10.dp)) {
                            Text(material.code, color = Navy, fontSize = 18.sp, fontWeight = FontWeight.Bold)
                            Text("物料 SN：${state.materialSn.ifBlank { "等待扫描" }}", color = Navy, fontWeight = FontWeight.Bold)
                            Text("本次上料数量：${material.requiredQty} ${material.uom} · 单台用量：${material.qtyPer} ${material.uom}", color = Color(0xFF334155))
                            Text("当前可用：${material.availableQty} ${material.uom} · 预计剩余：${material.projectedQty} ${material.uom}", color = Color(0xFF334155))
                            Text("顺序 ${material.loadingSequence} · ${material.name}", color = Color(0xFF334155), fontSize = 12.sp)
                            Text(
                                when (state.language) {
                                    "en" -> "Load this material now, then scan the next one selected by MES."
                                    "vi" -> "Nạp vật liệu này, sau đó quét vật liệu tiếp theo do MES chọn."
                                    else -> "请上料此物料，完成后再扫描 MES 指定的下一种物料。"
                                },
                                color = Red, fontSize = 14.sp, fontWeight = FontWeight.Bold
                            )
                        }
                    }
                }
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    TextButton(
                        onClick = vm::backStep,
                        enabled = !state.busy && state.step != LoadingStep.RELEASED
                    ) {
                        Text(t("back"), color = Navy, fontWeight = FontWeight.Bold)
                    }
                    Spacer(Modifier.weight(1f))
                    OutlinedButton(
                        onClick = vm::returnLoadingHome,
                        enabled = !state.busy
                    ) {
                        Text(t("loadingHome"), color = Red, fontWeight = FontWeight.Bold)
                    }
                }
                if (state.qualityChecks.isNotEmpty()) {
                    Card(
                        colors = CardDefaults.cardColors(containerColor = Color(0xFFE7F6F0)),
                        modifier = Modifier.fillMaxWidth().padding(top = 6.dp)
                    ) {
                        Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                            Text(t("qualityGates"), color = Navy, fontWeight = FontWeight.Bold)
                            state.qualityChecks.chunked(2).forEach { rowChecks ->
                                Row(Modifier.fillMaxWidth()) {
                                    rowChecks.forEach { check ->
                                        Text(
                                            "${if (check.pass) "✓" else "✕"} ${check.label}",
                                            color = if (check.pass) Green else Red,
                                            fontSize = 12.sp,
                                            fontWeight = FontWeight.SemiBold,
                                            modifier = Modifier.weight(1f)
                                        )
                                    }
                                    if (rowChecks.size == 1) Spacer(Modifier.weight(1f))
                                }
                            }
                            OutlinedButton(
                                onClick = { vm.recalculateLoadingStart("PAUSED_OR_FEEDER_REPLACED") },
                                enabled = state.online && !state.busy && state.workOrder.isNotBlank(),
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Text(
                                    when (state.language) {
                                        "en" -> "RECALCULATE NEXT FEEDING TIME"
                                        "vi" -> "TÍNH LẠI THỜI GIAN CẤP LIỆU TIẾP"
                                        else -> "重新计算下一次上料时间"
                                    },
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.Bold
                                )
                            }
                        }
                    }
                }
                Spacer(Modifier.height(8.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    OutlinedButton(
                        onClick = {
                            cameraError = null
                            cameraOpen = !cameraOpen
                        },
                        enabled = !state.busy,
                        modifier = Modifier.weight(1f)
                    ) {
                        Text(
                            if (cameraOpen) {
                                when (state.language) {
                                    "en" -> "Close camera"
                                    "vi" -> "Đóng camera"
                                    else -> "关闭相机"
                                }
                            } else {
                                when (state.language) {
                                    "en" -> "Scan with camera"
                                    "vi" -> "Quét bằng camera"
                                    else -> "相机扫码"
                                }
                            }
                        )
                    }
                    Text(
                        text = when (state.language) {
                            "en" -> "Or use scanner/input"
                            "vi" -> "Hoặc dùng máy quét/nhập mã"
                            else -> "或使用扫码枪/输入"
                        },
                        color = Color(0xFF52606D),
                        fontSize = 12.sp,
                        modifier = Modifier.weight(1f)
                    )
                }
                OutlinedButton(
                    onClick = { ocrOpen = !ocrOpen; cameraOpen = false; cameraError = null },
                    enabled = !state.busy,
                    modifier = Modifier.fillMaxWidth().padding(top = 6.dp)
                ) {
                    Text(if (ocrOpen) "Close label OCR" else "OCR fallback: receiving label")
                }
                if (cameraOpen) {
                    Card(
                        modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                        colors = CardDefaults.cardColors(containerColor = Color.Black)
                    ) {
                        BarcodeScanner(
                            onBarcodeDetected = { barcode ->
                                cameraOpen = false
                                cameraError = null
                                scannerText = ""
                                vm.scan(barcode)
                            },
                            onError = { error -> cameraError = error },
                            modifier = Modifier.fillMaxWidth()
                        )
                    }
                }
                if (ocrOpen) {
                    Card(
                        modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                        colors = CardDefaults.cardColors(containerColor = Color.Black)
                    ) {
                        MaterialLabelOcrScanner(
                            onResult = { parsed ->
                                ocrResult = parsed
                                ocrOpen = false
                                cameraError = null
                                scannerText = parsed.scanValue
                            },
                            onError = { cameraError = it },
                            modifier = Modifier.fillMaxWidth()
                        )
                    }
                }
                ocrResult?.let { parsed ->
                    Card(modifier = Modifier.fillMaxWidth().padding(top = 6.dp)) {
                        Column(Modifier.padding(10.dp)) {
                            Text("OCR parsed label", fontWeight = FontWeight.Bold)
                            Text("Material: " + parsed.materialCode.orEmpty() + "   Lot: " + parsed.lot.orEmpty())
                            Text("MFG: " + parsed.manufactureDate.orEmpty() + "   EXP: " + parsed.expiryDate.orEmpty() + "   Qty: " + (parsed.quantity?.toString() ?: "-"))
                            Button(
                                onClick = { vm.scan(parsed.scanValue); ocrResult = null },
                                enabled = parsed.scanValue.isNotBlank() && !state.busy,
                                modifier = Modifier.fillMaxWidth().padding(top = 4.dp)
                            ) { Text("Use OCR result") }
                        }
                    }
                }
                cameraError?.let { error ->
                    Text(
                        text = when (state.language) {
                            "en" -> "Camera error: $error"
                            "vi" -> "Lỗi camera: $error"
                            else -> "相机错误：$error"
                        },
                        color = Red,
                        fontSize = 12.sp,
                        modifier = Modifier.padding(top = 4.dp)
                    )
                }
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = scannerText,
                    onValueChange = { scannerText = it },
                    label = { Text(t("scanner")) },
                    singleLine = true,
                    textStyle = LocalTextStyle.current.copy(
                        color = Color(0xFFFF4D4F),
                        fontSize = 22.sp,
                        fontWeight = FontWeight.Bold
                    ),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedTextColor = Color(0xFFFF4D4F),
                        unfocusedTextColor = Color(0xFFFF4D4F),
                        focusedContainerColor = Color.Black,
                        unfocusedContainerColor = Color.Black,
                        focusedLabelColor = Color.White,
                        unfocusedLabelColor = Color(0xFFE2E8F0),
                        cursorColor = Color(0xFFFF4D4F),
                        focusedBorderColor = Color(0xFFFF4D4F),
                        unfocusedBorderColor = Color(0xFF94A3B8)
                    ),
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                    keyboardActions = KeyboardActions(onDone = {
                        vm.scan(scannerText); scannerText = ""
                    }),
                    modifier = Modifier.fillMaxWidth().focusRequester(focus)
                )
                Spacer(Modifier.height(8.dp))
                Button(
                    onClick = { vm.scan(scannerText); scannerText = "" },
                    enabled = scannerText.isNotBlank() && !state.busy,
                    modifier = Modifier.fillMaxWidth()
                ) { Text(t("submitScan")) }
                if (BuildConfig.TEST_ACTION_BYPASS_ENABLED && state.testBypassAllChecks) {
                    Spacer(Modifier.height(8.dp))
                    Button(
                        onClick = vm::simulateCurrentScan,
                        enabled = !state.busy && state.step in listOf(
                            LoadingStep.MATERIAL, LoadingStep.MACHINE, LoadingStep.SLOT,
                            LoadingStep.FEEDER, LoadingStep.REEL
                        ),
                        modifier = Modifier.fillMaxWidth(),
                        colors = ButtonDefaults.buttonColors(Red)
                    ) {
                        Text(t("simulateCurrentScan"), fontWeight = FontWeight.Bold)
                    }
                }

                Text(t("boundSlots"), fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 12.dp))
                LazyColumn(Modifier.weight(1f).fillMaxWidth()) {
                    itemsIndexed(state.boundSlots.asReversed()) { index, item ->
                        val current = index == 0
                        Card(
                            modifier = Modifier.fillMaxWidth().padding(vertical = 3.dp),
                            colors = CardDefaults.cardColors(
                                containerColor = if (current) Color(0xFFFFE082) else Color.White
                            ),
                            border = BorderStroke(
                                if (current) 3.dp else 1.dp,
                                if (current) Red else Color(0xFFCBD5E1)
                            )
                        ) {
                            Column(Modifier.padding(10.dp)) {
                                val bindingTextColor = if (current) Green else Navy
                                if (current) {
                                    Text("当前绑定 / CURRENT", color = Green, fontWeight = FontWeight.Bold)
                                }
                                Text("机器: ${item.machine}", color = bindingTextColor, fontWeight = FontWeight.Bold)
                                Text("槽位: ${item.slot}    Feeder: ${item.feeder}", color = bindingTextColor)
                                Text(
                                    "物料: ${item.material}    数量: ${item.qty}",
                                    color = bindingTextColor,
                                    fontWeight = FontWeight.Bold
                                )
                                Text("SN: ${item.materialSn}", color = bindingTextColor)
                                Text(
                                    "Lot: ${item.lot}",
                                    fontSize = 12.sp,
                                    color = if (current) Green else Color.Gray
                                )
                            }
                        }
                    }
                }

                if (state.boundSlots.isNotEmpty() && state.step != LoadingStep.RELEASED) {
                    if (
                        BuildConfig.TEST_ACTION_BYPASS_ENABLED &&
                        state.testBypassAllChecks &&
                        activeWo != null &&
                        activeWo.materialCount > 0 &&
                        activeWo.boundMaterialCount >= activeWo.materialCount
                    ) {
                        Button(
                            onClick = vm::bypassRelease,
                            enabled = !state.busy,
                            modifier = Modifier.fillMaxWidth(),
                            colors = ButtonDefaults.buttonColors(Red)
                        ) {
                            Text("测试放行工单 / Test release", fontWeight = FontWeight.Bold)
                        }
                        Spacer(Modifier.height(6.dp))
                    }
                    OutlinedTextField(
                        value = leader, onValueChange = { leader = it },
                        label = { Text(t("leaderBadge")) },
                        modifier = Modifier.fillMaxWidth(), singleLine = true
                    )
                    Button(
                        onClick = { vm.release(leader) }, enabled = leader.isNotBlank() && !state.busy,
                        modifier = Modifier.fillMaxWidth(), colors = ButtonDefaults.buttonColors(Color(0xFFB45309))
                    ) { Text(t("release")) }
                }
            }
        }
    }

    if (showTestBypass) {
        AlertDialog(
            onDismissRequest = { showTestBypass = false },
            title = { Text(t("testTitle"), color = Red) },
            text = {
                Column {
                    Text(t("testHelp"))
                    OutlinedTextField(testReason, { testReason = it }, label = { Text(t("testReason")) })
                    OutlinedTextField(testLeader, { testLeader = it }, label = { Text(t("authorizer")) })
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        vm.enableTestBypass(testReason, testLeader)
                        showTestBypass = false
                    },
                    enabled = testReason.isNotBlank() && testLeader.isNotBlank(),
                    colors = ButtonDefaults.buttonColors(Red)
                ) { Text(t("confirmTest")) }
            },
            dismissButton = { TextButton(onClick = { showTestBypass = false }) { Text(t("cancel")) } }
        )
    }

    state.bindingSuccess?.let { success ->
        AlertDialog(
            onDismissRequest = {},
            title = { Text(t("bindingSuccessTitle"), color = Green) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        if (success.allMaterialsBound) {
                            t("bindingSuccessAll")
                        } else {
                            t("bindingSuccessNext")
                        }
                    )
                    Text(
                        "${success.materialCode}\nSN: ${success.materialSn}",
                        color = Navy,
                        fontWeight = FontWeight.Bold
                    )
                    Text(
                        "${t("bindingProgress")}: ${success.boundCount}/${success.requiredCount}",
                        color = Green,
                        fontWeight = FontWeight.Bold
                    )
                }
            },
            confirmButton = {
                Button(
                    onClick = vm::acknowledgeBindingSuccess,
                    colors = ButtonDefaults.buttonColors(Green)
                ) {
                    Text(t(if (success.allMaterialsBound) "continueToRelease" else "nextMaterial"))
                }
            }
        )
    }

    state.completedWorkOrderCode?.let { code ->
        AlertDialog(
            onDismissRequest = {},
            title = { Text(t("woCompletedTitle"), color = Green) },
            text = { Text("$code\n\n${t("woCompletedMessage")}") },
            confirmButton = {
                Button(
                    onClick = vm::acknowledgeWorkOrderComplete,
                    colors = ButtonDefaults.buttonColors(Green)
                ) {
                    Text(t("startNextWo"))
                }
            }
        )
    }

    state.alarm?.let { message ->
        AlertDialog(
            onDismissRequest = {},
            title = { Text(t("alarm"), color = Red) },
            text = { Text(PdaLoadingStrings.message(state.language, message)) },
            confirmButton = { Button(onClick = vm::resetAlarm, colors = ButtonDefaults.buttonColors(Red)) { Text(t("clearAlarm")) } }
        )
    }
}

@Composable
private fun StatusCard(state: PdaLoadingState, t: (String) -> String) {
    Card(colors = CardDefaults.cardColors(containerColor = Navy), modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp)) {
            Text(PdaLoadingStrings.step(state.language, state.step), color = Color(0xFF8CF1D2), fontSize = 19.sp, fontWeight = FontWeight.Bold)
            Text("${t("workOrder")} ${state.workOrder}   ${t("machine")} ${state.machine.ifBlank { t("pendingScan") }}", color = Color.White)
            if (!state.online || state.offlinePending > 0) {
                Text(
                    "${t("offlinePending")} ${state.offlinePending} ${t("records30")}",
                    color = Color(0xFFFFD166),
                    fontWeight = FontWeight.Bold
                )
            }
            state.offlineExpiresAt?.let {
                Text("${t("offlineUntil")}：$it", color = Color(0xFFD8EAF4), fontSize = 12.sp)
            }
            Text(PdaLoadingStrings.message(state.language, state.message), color = Color(0xFFD8EAF4))
        }
    }
}

@Composable
private fun LoadingScheduleCard(workOrder: MesWorkOrder, state: PdaLoadingState) {
    val language = state.language
    val simulated = state.testBypassAllChecks
    val displayStartAt = if (simulated) state.testLoadingStartAt else workOrder.plannedStartAt
    val displayCloseAt = if (simulated) state.testLoadingCloseAt else workOrder.plannedFinishAt
    val start = displayStartAt?.let { runCatching { Instant.parse(it) }.getOrNull() }
    val now = Instant.now()
    val preNotice = start?.minusSeconds(20 * 60L)
    val inNotice = start != null && preNotice != null && now >= preNotice && now < start
    val close = displayCloseAt?.let { runCatching { Instant.parse(it) }.getOrNull() }
    val closed = close != null && now >= close
    val early = !simulated && workOrder.loadingTimeStatus == "EARLY"
    val title = when {
        early && inNotice -> if (language == "en") "PRE-INFORM: loading starts soon" else if (language == "vi") "THÔNG BÁO TRƯỚC: sắp bắt đầu cấp liệu" else "预通知：即将开始上料"
        early -> if (language == "en") "Waiting for MES loading window" else if (language == "vi") "Đang chờ khung thời gian MES" else "等待 MES 上料时间窗"
        else -> if (language == "en") "MES loading window" else if (language == "vi") "Khung thời gian cấp liệu MES" else "MES 上料时间窗"
    }
    val detail = if (start != null && early) {
        val minutes = Duration.between(now, start).toMinutes().coerceAtLeast(0)
        if (language == "en") "Starts in ${minutes} min · required PDA ${workOrder.requiredPdaCount} · online ${workOrder.activePdaCount}"
        else if (language == "vi") "Bắt đầu sau ${minutes} phút · cần PDA ${workOrder.requiredPdaCount} · online ${workOrder.activePdaCount}"
        else "距开始 ${minutes} 分钟 · 需要 PDA ${workOrder.requiredPdaCount} 台 · 已上线 ${workOrder.activePdaCount} 台"
    } else {
        if (language == "en") "Required PDA ${workOrder.requiredPdaCount} · online ${workOrder.activePdaCount}"
        else if (language == "vi") "Cần PDA ${workOrder.requiredPdaCount} · online ${workOrder.activePdaCount}"
        else "需要 PDA ${workOrder.requiredPdaCount} 台 · 已上线 ${workOrder.activePdaCount} 台"
    }
    Card(
        colors = CardDefaults.cardColors(containerColor = if (early) Color(0xFFFFF4D6) else Color(0xFFE5F7F0)),
        modifier = Modifier.fillMaxWidth().padding(top = 8.dp)
    ) {
        Column(Modifier.padding(12.dp)) {
            Text(title, color = if (early) Color(0xFF8A5A00) else Green, fontWeight = FontWeight.Bold)
            Text("上料时间: ${displayStartAt ?: "MES未排程"}", color = Navy, fontWeight = FontWeight.Medium)
            if (simulated) Text("⚠ TEST ONLY · 模拟关闭时间: ${displayCloseAt ?: "-"}", color = Red, fontWeight = FontWeight.Bold)
            Text("物料种类: ${workOrder.materialCount} 种", color = Navy)
            Text("数量: ${workOrder.plannedQty}", color = Navy)
            Text("产线: ${workOrder.lineCode.ifBlank { "MES未分配" }}", color = Navy)
            Text("实时上料: ${if (state.online) "MES ONLINE" else "MES OFFLINE"}", color = if (state.online) Green else Red, fontWeight = FontWeight.Bold)
            Text("物料开放: ${workOrder.materialLoadingStatus} · 开放时间: ${workOrder.loadingOpenAt ?: "MES未发布"}", color = if (workOrder.materialLoadingStatus == "OPEN") Green else Color(0xFF8A5A00), fontWeight = FontWeight.Bold)
            Text("已完成: ${workOrder.boundMaterialCount} 种", color = Green)
            Text("未完成: ${(workOrder.materialCount - workOrder.boundMaterialCount).coerceAtLeast(0)} 种", color = if (workOrder.materialCount > workOrder.boundMaterialCount) Color(0xFF8A5A00) else Green)
            Text("预计生产速度: ${"%.2f".format(workOrder.estimatedProductionRatePerHour)} PCS/小时", color = Navy, fontSize = 12.sp)
            Text("生产速度: ${"%.4f".format(workOrder.estimatedProductionRatePerMinute)} 产品/分钟", color = Navy, fontSize = 12.sp)
            Text("计算公式: 产品/分钟 = 生产数量 ÷ 生产分钟数；物料/分钟 = 产品/分钟 × BOM单台用量", color = Color(0xFF415A6B), fontSize = 11.sp)
            Text("速度来源: ${if (workOrder.rateSource == "MANUAL_PLAN_SIMULATION") "手动线计划模拟" else "MES实际产出"}", color = Navy, fontSize = 12.sp)
            Text("预计生产完成: ${workOrder.estimatedProductionFinishAt ?: "MES暂无估算"}", color = Navy, fontSize = 12.sp)
            if (state.alarm != null) {
                Text("错料/错槽/错飞达报警：MES 已拒绝本次操作", color = Red, fontWeight = FontWeight.Bold)
            }
            Text(detail, color = Color(0xFF415A6B), fontSize = 12.sp)
            displayCloseAt?.let { Text("关闭时间: $it${if (closed) " · CLOSED" else ""}", color = if (closed) Red else Color(0xFF415A6B), fontSize = 12.sp) }
        }
    }
}

@Composable
private fun BindingReview(state: PdaLoadingState, t: (String) -> String) {
    Card(Modifier.fillMaxWidth().padding(bottom = 8.dp)) {
        Column(Modifier.padding(12.dp)) {
            Text("${t("machine")}：${state.machine}")
            Text("${t("slot")}：${state.slot}")
            Text("${t("feeder")}：${state.feeder}")
            Text(
                "${t("materialSn")}：${state.materialSn}",
                color = Red,
                fontSize = 20.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.fillMaxWidth().background(Color.Black).padding(8.dp)
            )
            Text("${t("material")}：${state.material}")
            Text("${t("lot")}：${state.lot}")
        }
    }
}
