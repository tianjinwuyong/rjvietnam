package com.smt.materialloader.ui.receiving

import android.graphics.BitmapFactory
import android.graphics.Bitmap
import android.speech.tts.TextToSpeech
import android.util.Log
import android.widget.Toast
import java.util.Locale
import android.util.Base64
import android.content.Intent
import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.horizontalScroll
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.input.pointer.pointerInput
import kotlin.math.abs
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.Print
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.foundation.clickable
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.ui.Alignment
import androidx.compose.ui.window.Dialog
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.wrapContentSize
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.background
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import com.smt.materialloader.printing.BluetoothTsplPrinter
import kotlinx.coroutines.launch
import androidx.lifecycle.viewmodel.compose.viewModel
import com.smt.materialloader.ui.components.BarcodeScanner
import com.smt.materialloader.MaterialLoaderApp
import com.smt.materialloader.MainActivity
import com.smt.materialloader.BuildConfig
import kotlinx.coroutines.delay

@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
fun MaterialReceivingScreen(
    onBack: () -> Unit,
    onHome: () -> Unit,
    onLogout: () -> Unit,
    vm: MaterialReceivingViewModel = viewModel()
) {
    val state by vm.state.collectAsState()
    val ctx = androidx.compose.ui.platform.LocalContext.current
    var cancel by remember { mutableStateOf(false) }
    var scannerTarget by remember { mutableStateOf<String?>(null) }
    // Bumped after every binding so the SAME open scanner re-arms for the next
    // box (continuous scanning until the operator picks another position).
    var scanCycle by remember { mutableStateOf(0) }
    val scanPrefs = remember { ctx.getSharedPreferences("receiving_scan", Context.MODE_PRIVATE) }
    var scanTool by remember { mutableStateOf(scanPrefs.getString("tool", "CAMERA") ?: "CAMERA") }
    var deviceName by remember { mutableStateOf("PDA-RECV-01") }
    val deviceConfirmed = true
    val taskRequester = remember { BringIntoViewRequester() }
    val context = LocalContext.current
    LaunchedEffect(state.ocrParseFailed) {
        if (state.ocrParseFailed) Toast.makeText(context, "无法解析，请重新拍摄", Toast.LENGTH_LONG).show()
    }
    val printScope = rememberCoroutineScope()
    var selectedPrinterAddress by remember { mutableStateOf(context.getSharedPreferences("receiving_printer", Context.MODE_PRIVATE).getString("address", "").orEmpty()) }
    var selectedPrinterName by remember { mutableStateOf(context.getSharedPreferences("receiving_printer", Context.MODE_PRIVATE).getString("name", "").orEmpty()) }
    var showPrinterPicker by remember { mutableStateOf(false) }
    var printStatus by remember { mutableStateOf("请选择手持蓝牙打印机") }
    val bluetoothPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) showPrinterPicker = true else printStatus = "未获得蓝牙打印权限"
    }
    val camera = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val path = result.data?.getStringExtra("imagePath")
        if (result.resultCode == android.app.Activity.RESULT_OK && path != null) {
            Log.i("WmsReceivingOcr", "camera returned path=$path")
            decodeLabelBitmap(path)?.let {
                Log.i("WmsReceivingOcr", "decoded ${it.width}x${it.height}; starting upload")
                vm.captureLabelImage(it)
            } ?: run {
                Log.e("WmsReceivingOcr", "failed to decode camera image: $path")
                vm.markLabelParseFailed()
            }
        }
    }
    val certificateCamera = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val path = result.data?.getStringExtra("imagePath")
        if (result.resultCode == android.app.Activity.RESULT_OK && path != null) BitmapFactory.decodeFile(path)?.let(vm::uploadSupplierCertificate)
    }
    val damageCamera = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val path = result.data?.getStringExtra("imagePath")
        if (result.resultCode == android.app.Activity.RESULT_OK && path != null) BitmapFactory.decodeFile(path)?.let(vm::uploadDamagePhoto)
    }
    BackHandler { if (state.step == ReceivingStep.MATERIAL) cancel = true else vm.previous() }
    LaunchedEffect(Unit) {
        var assignedDeviceName = deviceName
        runCatching {
            val installationKey = Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID).orEmpty().ifBlank { deviceName }
            val registration = MaterialLoaderApp.instance.apiService.postPdaEvent(mapOf(
                "from" to deviceName,
                "to" to "wms_receiving",
                "type" to "WMS_RECEIVING_REGISTER",
                "stationCode" to "wms_receiving",
                "payload" to mapOf("installationKey" to installationKey, "deviceId" to deviceName, "operatorName" to "收料员", "role" to "MATERIAL_RECEIVING", "at" to System.currentTimeMillis())
            ))
            val body = registration.body()
            val assigned = body?.get("deviceId")?.asString
                ?: body?.getAsJsonObject("data")?.get("deviceId")?.asString
            if (!assigned.isNullOrBlank()) { assignedDeviceName = assigned; deviceName = assigned }
        }
        while (true) {
            runCatching {
                MaterialLoaderApp.instance.apiService.postPdaEvent(mapOf(
                    "from" to assignedDeviceName,
                    "to" to "wms_receiving",
                    "type" to "WMS_RECEIVING_PDA_ACTIVITY",
                    "stationCode" to "wms_receiving",
                    "payload" to mapOf(
                        "phase" to "HEARTBEAT",
                        "deviceId" to assignedDeviceName,
                        "operatorName" to "收料员",
                        "role" to "MATERIAL_RECEIVING",
                        "status" to if (state.submitted) "COMPLETED" else "READY",
                        "at" to System.currentTimeMillis()
                    )
                ))
            }
            delay(5000)
        }
    }
    LaunchedEffect(state.step) {
        delay(100)
        taskRequester.bringIntoView()
    }
    LaunchedEffect(state.submitted) {
        if (state.submitted) {
            delay(1500)
            vm.clearDraft()
        }
    }
    LaunchedEffect(state.locationMap) {
        if (state.locationMap.isNotEmpty()) { vm.showLocationDialog() }
    }
    LaunchedEffect(state.nextScanRequested) {
        if (state.nextScanRequested) {
            vm.consumeNextScan()
            // Re-arm the scanner for the next box instead of closing it:
            // the dialog stays open and just gets a fresh latch.
            scanCycle++
        }
    }
    if (cancel) AlertDialog(
        onDismissRequest = { cancel = false }, title = { Text("取消收料") },
        text = { Text("清除当前收料记录吗？") },
        confirmButton = { TextButton({ vm.clearDraft(); onBack() }) { Text("清除") } },
        dismissButton = { TextButton({ cancel = false }) { Text("继续") } }
    )
    if (state.showLocationDialog && state.locationMap.isNotEmpty()) {
        val area = state.locationMap.keys.firstOrNull() ?: ""
        val locations = state.locationMap[area] ?: emptyList()
        LocationMapDialog(
            area = area,
            locations = locations,
            positionBoxCounts = state.positionBoxCounts,
            activePosition = state.activePosition,
            onSelect = { loc ->
                vm.selectLocationFromMap(loc)
                scannerTarget = "code"
            },
            onDismiss = { vm.hideLocationDialog() }
        )
    }
    if (state.showAreaDialog) {
        AreaPickerDialog(
            areas = state.warehouseAreas,
            error = state.areaLoadError,
            onPick = { area ->
                vm.hideAreaDialog()
                vm.loadAreaLocations(area.area)
            },
            onDismiss = { vm.hideAreaDialog() }
        )
    }
    Scaffold(topBar = {
        TopAppBar(
            title = { Text("物料仓位绑定", fontWeight = FontWeight.Bold) },
            navigationIcon = { IconButton({ if (state.step == ReceivingStep.MATERIAL) cancel = true else vm.previous() }) { Icon(Icons.Default.ArrowBack, "返回") } },
            actions = {
                TextButton({ vm.language(if (state.language == "zh") "vi" else "zh") }) {
                    Text(if (state.language == "zh") "VI" else "中文")
                }
                TextButton(onClick = onLogout) { Text("退出") }
            }
        )
    }, bottomBar = {
        if (!BuildConfig.APPLICATION_ID.endsWith(".receiving")) BottomAppBar {
            TextButton(
                onClick = { if (canContinue(state) && state.step != ReceivingStep.REVIEW) vm.next() },
                enabled = state.step != ReceivingStep.REVIEW && canContinue(state),
                modifier = Modifier.weight(1f)
            ) { Text("← 前进") }
            if (!BuildConfig.APPLICATION_ID.endsWith(".receiving")) {
                TextButton(onClick = onHome, modifier = Modifier.weight(1f)) { Text("首页") }
            }
            TextButton(
                onClick = { if (state.step == ReceivingStep.MATERIAL) cancel = true else vm.previous() },
                modifier = Modifier.weight(1f)
            ) { Text("后退 →") }
            TextButton(onClick = onLogout, modifier = Modifier.weight(1f)) { Text("退出") }
        }
    }) { padding ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(16.dp)
                .verticalScroll(rememberScrollState())
                .pointerInput(state.step) {
                    var distance = 0f
                    detectHorizontalDragGestures(
                        onHorizontalDrag = { change, amount ->
                            change.consume()
                            distance += amount
                        },
                        onDragEnd = {
                            if (abs(distance) > 120f) {
                                if (distance < 0 && state.step != ReceivingStep.REVIEW && canContinue(state)) vm.next()
                                if (distance > 0) {
                                    if (state.step == ReceivingStep.MATERIAL) cancel = true else vm.previous()
                                }
                            }
                            distance = 0f
                        },
                        onDragCancel = { distance = 0f }
                    )
                },
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Column(Modifier.bringIntoViewRequester(taskRequester), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (state.bindingResult.isNotBlank()) {
                val ok = state.bindingResult.startsWith("物料已收货")
                Surface(
                    color = if (ok) Color(0xFFE8F5E9) else Color(0xFFFFEBEE),
                    shape = RoundedCornerShape(8.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(
                        state.bindingResult,
                        color = if (ok) Color(0xFF2E7D32) else Color(0xFFC62828),
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.padding(12.dp)
                    )
                }
            }
            when (state.step) {
                ReceivingStep.MATERIAL -> {
                    SingleScreenReceivingPanel(
                        state = state,
                        vm = vm,
                        camera = camera,
                        onSelectArea = { vm.loadWarehouseAreas() },
                        onScanBox = { scannerTarget = "code" },
                        onCancelBinding = { vm.revokeLastBinding() }
                    )
                }
                ReceivingStep.CONTAINERS -> {
                    Title("Supplier pre-receiving & box reconciliation", "Select the ASN/PO manifest, then scan every outer/sub-box. WMS remains the source of truth.")
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Field("ASN", state.asn, { vm.updateMaterialField("asn", it) }, modifier = Modifier.weight(1f))
                        Field("Manifest ID", state.preReceivingManifestId, { vm.updateMaterialField("manifestId", it) }, modifier = Modifier.weight(1f))
                    }
                    Button(onClick = { scannerTarget = "box" }, modifier = Modifier.fillMaxWidth().height(58.dp)) { Text("Scan supplier outer/sub-box QR") }
                    Text("Outer boxes: ${state.outerBoxSns.size} · Sub-boxes: ${state.subBoxSns.size} · Duplicates: ${state.duplicateSns.size}", color = if (state.duplicateSns.isEmpty()) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error)
                    if (state.duplicateSns.isNotEmpty()) Text("Duplicate SN: ${state.duplicateSns.joinToString()}", color = MaterialTheme.colorScheme.error)
                    MaterialSnCollection(state, onScan = { scannerTarget = "materialSn" })
                    Title("2. 补齐 QR 生成信息", "补齐物料、批次、数量、总箱数和当前箱号；隐藏托板由 WMS 自动管理。")
                    Text("QR 生成前必须确认：物料编码、批次、总箱数和当前箱号。", color = MaterialTheme.colorScheme.primary)
                    MissingReceivingInfoAlarm(state)
                    Field("当前箱 QR / Box SN", state.boxCode, { vm.updateMaterialField("box", it) }, scan = { scannerTarget = "box" })
                    Text("箱 QR 已由 WMS 自动归入隐藏收料组", color = MaterialTheme.colorScheme.primary)
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Field("总箱数（本批次）", state.boxCount, { vm.updateMaterialField("boxCount", it) }, modifier = Modifier.weight(1f))
                        Field("当前箱号", state.boxNumber, { vm.updateMaterialField("boxNumber", it) }, modifier = Modifier.weight(1f))
                    }
                    Field("本次收料总数量", state.palletQuantity, { vm.updateMaterialField("palletQuantity", it) })
                    Text("数量用于本次物料仓位绑定。", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text("当前收料箱：${state.boxNumber.ifBlank { "—" }} / 总箱数：${state.boxCount.ifBlank { "—" }}", color = MaterialTheme.colorScheme.primary)
                    Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                        Checkbox(checked = state.partialBox, onCheckedChange = { vm.updateMaterialField("partialBox", it.toString()) })
                        Text("尾数箱/部分箱")
                    }
                    Title("IQC / quantity reconciliation", "Record passed, NG, missing and unexpected SNs. Separate defects from quantity differences.")
                    Field("PASS SNs (comma separated)", state.passedSns.joinToString(), { vm.updateSnReconciliation("passed", it) })
                    Field("NG SNs (comma separated)", state.ngSns.joinToString(), { vm.updateSnReconciliation("ng", it) })
                    Field("Missing SNs", state.missingSns.joinToString(), { vm.updateSnReconciliation("missing", it) })
                    Field("Unexpected SNs", state.unexpectedSns.joinToString(), { vm.updateSnReconciliation("unexpected", it) })
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Field("PASS qty", state.passedQuantity, { vm.updateMaterialField("passedQuantity", it) }, modifier = Modifier.weight(1f))
                        Field("NG qty", state.ngQuantity, { vm.updateMaterialField("ngQuantity", it) }, modifier = Modifier.weight(1f))
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Field("Shortage qty", state.shortageQuantity, { vm.updateMaterialField("shortageQuantity", it) }, modifier = Modifier.weight(1f))
                        Field("Excess qty", state.excessQuantity, { vm.updateMaterialField("excessQuantity", it) }, modifier = Modifier.weight(1f))
                    }
                    Button(onClick = { damageCamera.launch(Intent(context, com.smt.materialloader.AutoLabelCameraActivity::class.java)) }, modifier = Modifier.fillMaxWidth()) { Text("Photograph damaged product") }
                    Text("Damage evidence images: ${state.damageImageDataUrls.size}", color = MaterialTheme.colorScheme.primary)
                }
                ReceivingStep.PRINT_LABELS -> {
                    Title("3. 打印生成的全部 QR", "根据第二步补齐的信息，打印该批次的全部箱 QR 标签。")
                    OutlinedButton(onClick = {
                        if (Build.VERSION.SDK_INT < 31 || ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED) showPrinterPicker = true
                        else bluetoothPermission.launch(Manifest.permission.BLUETOOTH_CONNECT)
                    }, modifier = Modifier.fillMaxWidth()) { Text("手持打印机：${selectedPrinterName.ifBlank { "选择已配对设备" }}") }
                    Button(onClick = {
                        if (selectedPrinterAddress.isBlank()) {
                            showPrinterPicker = true
                        } else {
                            val labels = vm.boxQrValues()
                            printStatus = "正在发送 ${labels.size} 张箱标签…"
                            printScope.launch {
                                BluetoothTsplPrinter.printBoxLabels(context, selectedPrinterAddress, labels)
                                    .onSuccess { printStatus = "已打印 $it 张箱标签"; vm.markLabelsPrinted() }
                                    .onFailure { printStatus = "打印失败：${it.message}" }
                            }
                        }
                    }, enabled = !state.labelsPrinted, modifier = Modifier.fillMaxWidth().height(58.dp)) {
                        Icon(Icons.Default.Print, contentDescription = null)
                        Spacer(Modifier.width(8.dp))
                        Text(if (state.labelsPrinted) "已发送全部箱 QR 打印任务" else "打印全部箱 QR")
                    }
                    OutlinedButton(onClick = vm::printCurrentBoxLabel, enabled = state.boxCode.isNotBlank(), modifier = Modifier.fillMaxWidth()) {
                        Text("补打当前箱 QR：${state.boxCode.ifBlank { "未选择箱" }}")
                    }
                    Text("打印完成后进入下一步，将标签分别贴到所有箱体。", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(printStatus, color = MaterialTheme.colorScheme.primary)
                }
                ReceivingStep.APPLY_LABELS -> {
                    Title("4. 贴标确认", "把生成的箱 QR 标签分别贴到所有箱体。")
                    Text("箱标签：${state.boxCount.ifBlank { "待确定" }} 张", color = MaterialTheme.colorScheme.primary)
                    Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                        Checkbox(checked = state.labelsApplied, onCheckedChange = { vm.markLabelsApplied(it) }, enabled = state.labelsPrinted)
                        Text("确认箱体标签已全部贴好")
                    }
                }
                ReceivingStep.GENERATE_PALLET -> {
                    Title("5. 生成托板 QR 并绑定箱体", "确认箱体标签后生成托板 QR，并建立每个箱 QR → 托板 QR 的绑定。")
                    Button(onClick = vm::generatePalletQr, enabled = state.labelsApplied && state.palletCode.isBlank(), modifier = Modifier.fillMaxWidth()) { Text("生成托板 QR") }
                    Text("托板 QR：${state.palletCode.ifBlank { "待生成" }}", color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold)
                    Text("箱 QR → 托板 QR：${if (state.boxCode.isNotBlank() && state.palletCode.isNotBlank()) "已绑定" else "待绑定"}", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                ReceivingStep.QUANTITY -> {
                    Title("5. 绑定仓库库位", "扫描实际仓库库位 QR，将本次收料的全部箱体绑定到该库位。")
                    Field("仓库库位 QR", state.location, { vm.updateMaterialField("location", it) }, scan = { scannerTarget = "location" })
                    Text(if (state.location.isNotBlank()) "仓库库位已确认，可以完成收料" else "请扫描仓库库位 QR", color = MaterialTheme.colorScheme.primary)
                }
                ReceivingStep.LOCATION -> {
                    Title("7. 托板收料资料确认", "确认托板、箱体、证书和库位信息后进入完成收料。")
                    Review("托板 / 库位", "${state.palletCode} / ${state.location}")
                }
                ReceivingStep.CERTIFICATE -> {
                    Title("5. 收料资料确认", "供应商质量证书已在对应收料箱信息后记录。")
                    Text("当前收料箱已记录证书/照片：${state.certificatePhotoCount} 项", color = MaterialTheme.colorScheme.primary)
                }
                ReceivingStep.REVIEW -> {
                    Title("确认绑定", "确认后将物料与唯一仓位 QR 的绑定同步到 WMS。")
                    Review("越南物料编码", state.materialCode)
                    Review("瑞晶物料编码", state.internalMaterialCode)
                    Review("批次 / MSD", "${state.lotNo} / ${state.msLevel}")
                    Review("本次收料数量", "${state.palletQuantity} ${state.unit}")
                    Review("箱号 / 总箱数", "${state.boxNumber}/${state.boxCount}")
                    Review("当前箱 QR", state.boxCode)
                    Review("绑定仓位", state.location)
                    Review("ASN / Manifest", "${state.asn} / ${state.preReceivingManifestId}")
                    Review("Outer / Sub / Duplicate", "${state.outerBoxSns.size} / ${state.subBoxSns.size} / ${state.duplicateSns.size}")
                    Review("PASS / NG quantity", "${state.passedQuantity} / ${state.ngQuantity}")
                    Review("Shortage / Excess", "${state.shortageQuantity} / ${state.excessQuantity}")
                    Review("Damage images / Sync", "${state.damageImageDataUrls.size} / ${state.receivingSyncStatus}")
                    if (state.receivingSyncStatus == "PENDING_RETRY") Button(onClick = vm::retryReceivingSync, modifier = Modifier.fillMaxWidth()) { Text("Retry WMS synchronization") }
                    if (state.receivingSyncStatus == "DUPLICATE_REJECTED") {
                        Text(
                            "重复警告：该箱/库位 QR 已被绑定，本次注册已拒绝。请更换未被绑定的二维码。",
                            color = MaterialTheme.colorScheme.error,
                            fontWeight = FontWeight.Bold,
                            style = MaterialTheme.typography.bodyMedium
                        )
                    }
                    ReceivingLabelWorkflow(state, vm, onScan = { scannerTarget = "receivingLabel" })
                }
            }
            }
        }
    }
    // Hardware scanner remains the primary input; the existing camera fallback is also available from scan buttons.
    if (showPrinterPicker) {
        val printers = runCatching { BluetoothTsplPrinter.paired(context) }.getOrDefault(emptyList())
        AlertDialog(
            onDismissRequest = { showPrinterPicker = false },
            title = { Text("选择手持蓝牙打印机") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    if (printers.isEmpty()) Text("没有已配对设备，请先在 PDA 蓝牙设置中配对打印机。")
                    printers.forEach { printer ->
                        TextButton(onClick = {
                            selectedPrinterAddress = printer.address
                            selectedPrinterName = printer.name
                            context.getSharedPreferences("receiving_printer", Context.MODE_PRIVATE).edit().putString("address", printer.address).putString("name", printer.name).apply()
                            printStatus = "已选择 ${printer.name}"
                            showPrinterPicker = false
                        }, modifier = Modifier.fillMaxWidth()) { Text("${printer.name}\n${printer.address}") }
                    }
                }
            },
            confirmButton = { TextButton(onClick = { showPrinterPicker = false }) { Text("关闭") } }
        )
    }
    scannerTarget?.let { target ->
        if (scanTool == "SCANNER") {
            // Embedded scanner (KEY_EVENT mode): arm the Activity callback and
            // wait for the gun to type the code — no camera dialog.
            LaunchedEffect(target) {
                MainActivity.scannerResultCallback = { value ->
                    val accepted = when (target) {
                        "receivingLabel" -> { vm.recordLabelScan(value); true }
                        "materialSn" -> { vm.recordMaterialSn(value); true }
                        else -> if (vm.applyMaterialRollQr(value)) { vm.markQrInput(); true } else { vm.updateMaterialField(target, value); true }
                    }
                    if (accepted) scannerTarget = null
                    accepted
                }
            }
            DisposableEffect(target) {
                onDispose { MainActivity.scannerResultCallback = null }
            }
            Text("请用扫描枪扫描：$target", color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold)
            TextButton(onClick = {
                scanTool = "CAMERA"
                try { scanPrefs.edit().putString("tool", "CAMERA").apply() } catch (_: Exception) { }
            }) { Text("无枪？改用相机扫码") }
        } else {
        // Continuous box scanning: for the "code" target the dialog STAYS OPEN.
        // Each binding bumps scanCycle (via nextScanRequested) which resets the
        // accept latch and the camera's scan latch, so the next box scans
        // immediately. Other targets close after one scan as before.
        // NOTE: keep ONE accept-latch state instance — the camera analyzer
        // captured the first callback, so recreating the state would leave it
        // reading a stale "true" forever (bound once, then camera dead).
        val scanAcceptedState = remember { mutableStateOf(false) }
        LaunchedEffect(scanCycle) { scanAcceptedState.value = false }
        AlertDialog(
            onDismissRequest = { scannerTarget = null },
            title = { Text(if (target == "code") "扫描箱码（连续绑定）" else "扫码：$target") },
            text = {
                Column {
                    BarcodeScanner(
                        onBarcodeDetected = { value ->
                            if (scanAcceptedState.value) return@BarcodeScanner
                            scanAcceptedState.value = true
                            if (target == "receivingLabel") { vm.recordLabelScan(value); scannerTarget = null }
                            else if (target == "materialSn") { vm.recordMaterialSn(value); scannerTarget = null }
                            else if (target == "code") {
                                // Keep the dialog open; the binding flow re-arms scanCycle.
                                if (vm.applyMaterialRollQr(value)) vm.markQrInput()
                                else {
                                    vm.updateMaterialField(target, value)
                                    // Unrecognized code: re-arm after a beat so the
                                    // operator can retry — never lock the camera.
                                    printScope.launch { delay(1500); scanCycle++ }
                                }
                            } else {
                                scannerTarget = null
                                if (vm.applyMaterialRollQr(value)) vm.markQrInput()
                                else vm.updateMaterialField(target, value)
                            }
                        },
                        onError = { scannerTarget = null },
                        resetKey = scanCycle
                    )
                    if (target == "code" && state.bindingResult.isNotBlank()) {
                        Spacer(Modifier.height(8.dp))
                        Text(
                            state.bindingResult,
                            color = if (state.bindingResult.startsWith("物料已收货")) Color(0xFF2E7D32) else Color(0xFFC62828),
                            fontWeight = FontWeight.Bold
                        )
                    }
                    if (target == "code" && state.bindingResult.startsWith("重复")) {
                        // Dup warning: show a big, bright green button to skip
                        // the 3s wait and continue with the next box immediately.
                        Spacer(Modifier.height(12.dp))
                        Button(
                            onClick = { vm.continueScanning() },
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF16A34A), contentColor = Color.White),
                            modifier = Modifier.fillMaxWidth().height(84.dp)
                        ) { Text("▶ 立即继续扫描下一箱", fontWeight = FontWeight.ExtraBold, fontSize = 24.sp) }
                        Spacer(Modifier.height(6.dp))
                        Text("3 秒后自动继续扫描", color = Color(0xFF6B7280), fontSize = 14.sp)
                    }
                }
            },
            confirmButton = { TextButton({ scannerTarget = null }) { Text(if (target == "code") "完成" else "取消") } }
        )
        }
    }
}

private fun decodeLabelBitmap(path: String): Bitmap? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(path, bounds)
    var sample = 1
    while (bounds.outWidth / sample > 2400 || bounds.outHeight / sample > 2400) sample *= 2
    return BitmapFactory.decodeFile(path, BitmapFactory.Options().apply {
        inSampleSize = sample
        inPreferredConfig = Bitmap.Config.ARGB_8888
    })
}

private data class ReceivingPoLine(
    val materialCode: String,
    val name: String,
    val orderedQty: String,
    val receivedQty: String,
    val remainingQty: String,
    val unit: String
)

private data class ReceivingPo(
    val po: String,
    val supplierCode: String,
    val supplierName: String,
    val createdDate: String,
    val promisedDate: String,
    val status: String,
    val lines: List<ReceivingPoLine>
)

@Composable
private fun MissingReceivingInfoAlarm(state: MaterialReceivingState) {
    val missing = listOfNotNull(
        if (state.materialCode.isBlank()) "物料编码" else null,
        if (state.lotNo.isBlank()) "批次" else null,
        if (state.quantityPerBox.toDoubleOrNull()?.let { it > 0 } != true) "数量" else null,
        if (state.boxCount.toIntOrNull()?.let { it > 0 } != true) "总箱数" else null,
        if (state.boxNumber.isBlank()) "当前箱号" else null
    )
    if (missing.isEmpty()) {
        Text("✓ QR 生成信息已填写完整", color = Color(0xFF15803D), fontWeight = FontWeight.Bold)
        return
    }
    val transition = rememberInfiniteTransition(label = "missing-info-alarm")
    val pulse by transition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(650), RepeatMode.Reverse),
        label = "alarm-pulse"
    )
    val borderColor = if (pulse < 0.5f) Color(0xFFDC2626) else Color(0xFFFFB4B4)
    Surface(modifier = Modifier.fillMaxWidth().border(width = 3.dp, color = borderColor, shape = RoundedCornerShape(10.dp)), color = Color(0xFFFFF1F2), shape = RoundedCornerShape(10.dp)) {
        Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text("⚠ 请补齐后再继续", color = Color(0xFFB91C1C), fontWeight = FontWeight.Bold)
            Text("缺少：${missing.joinToString("、")}", color = Color(0xFF991B1B))
        }
    }
}

@Composable
private fun ReceivingEmployeeExpectation(state: MaterialReceivingState) {
    val instruction = when (state.step) {
        ReceivingStep.MATERIAL -> Triple("扫描供应商箱标签 / PO", "PDA 已提交物料、批次、供应商和实收数量", "虚拟员工自动校验 PO、物料、数量和重复码")
        ReceivingStep.CONTAINERS -> Triple("扫描全部外箱与子箱 SN", "已扫描箱数等于实际到货箱数，且无重复 SN", "虚拟员工核对箱清单并生成每箱 QR 计划")
        ReceivingStep.PRINT_LABELS -> Triple("连接手持打印机并打印所有箱 QR", "打印张数等于收料箱数", "虚拟员工核对打印结果并允许贴标")
        ReceivingStep.APPLY_LABELS -> Triple("把 QR 贴到对应箱体并逐箱复扫", "每个箱 QR 均已复扫确认", "虚拟员工验证箱码唯一性并准备仓位绑定")
        ReceivingStep.GENERATE_PALLET -> Triple("无需操作，WMS 正在建立隐藏收料组", "后台隐藏关系建立完成", "虚拟员工继续核对本批次总数量")
        ReceivingStep.QUANTITY -> Triple("确认本批次总箱数和总数量", "箱数、每箱数量和实收总数一致", "虚拟员工锁定数量并要求扫描仓位")
        ReceivingStep.LOCATION -> Triple("扫描实际仓库仓位 QR", "全部箱 QR 已绑定有效仓位", "虚拟员工更新库存位置并交接 IQC")
        ReceivingStep.CERTIFICATE -> Triple("拍摄并上传供应商证书或异常照片", "要求的证据已关联当前批次", "虚拟员工保存证据并准备最终确认")
        ReceivingStep.REVIEW -> Triple("核对资料并确认完成收料", "必填资料、箱 QR 和仓位绑定全部完成", "虚拟员工关闭收料任务并送入 IQC HOLD")
    }
    Surface(
        modifier = Modifier.fillMaxWidth().border(3.dp, Color(0xFFDC2626), RoundedCornerShape(12.dp)),
        color = Color(0xFFFFF1F2), shape = RoundedCornerShape(12.dp)
    ) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
            Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                Text("●", color = Color(0xFFDC2626), style = MaterialTheme.typography.headlineSmall)
                Spacer(Modifier.width(8.dp))
                Text("当前 PDA 必须完成", color = Color(0xFF991B1B), fontWeight = FontWeight.ExtraBold)
            }
            Text(instruction.first, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleLarge)
            Text("完成条件：${instruction.second}", color = Color(0xFF7F1D1D))
            Surface(color = Color(0xFFDCFCE7), shape = RoundedCornerShape(8.dp)) {
                Text("完成后：${instruction.third}", Modifier.padding(9.dp), color = Color(0xFF166534), fontWeight = FontWeight.Bold)
            }
        }
    }
}

@Composable
private fun DetailedReceivingDiagram(state: MaterialReceivingState, onNodeClick: (Int) -> Unit) {
    val totalBoxes = state.boxCount.toIntOrNull()?.coerceAtLeast(1) ?: 0
    val totalLabels = if (totalBoxes > 0) totalBoxes + 1 else 0
    val nodes = listOf(
        Triple("1. 扫描唯一库位 QR", state.location.isNotBlank(), "当前收料库位：${state.location.ifBlank { "待扫" }}"),
        Triple("2. OCR 识别并补齐", state.materialCode.isNotBlank() && state.lotNo.isNotBlank(), "批次：${state.lotNo.ifBlank { "待补齐" }} · 供应商：${state.supplier.ifBlank { "待补齐" }} · 数量：${state.receivedQty.ifBlank { "待补齐" }}"),
        Triple("3. 确认总箱数", totalBoxes > 0, "当前箱：${state.boxNumber.ifBlank { "—" }} / 总箱数：${if (totalBoxes > 0) totalBoxes else "待输入"}"),
        Triple("4. 打印并贴标", state.labelsPrinted && state.labelsApplied, "托板标签 1 张 · 箱标签 ${if (totalBoxes > 0) totalBoxes else "待确定"} 张"),
        Triple("5. 逐个复扫标签", totalLabels > 0 && state.scannedLabelCodes.size >= totalLabels, "已扫描 ${state.scannedLabelCodes.size} / ${if (totalLabels > 0) totalLabels else "—"} 张"),
        Triple("6. 箱 QR → 托板 QR", state.boxCode.isNotBlank() && state.palletCode.isNotBlank(), "箱体归属托板：${state.palletCode.ifBlank { "待生成" }}"),
        Triple("7. 托板 QR → 库位", state.palletCode.isNotBlank() && state.location.isNotBlank(), "目标库位：${state.location.ifBlank { "待选择" }}"),
        Triple("绑定完成", state.submitted, "WMS 状态：${if (state.submitted) "物料与仓位已绑定" else "待绑定"}")
    )
    val activeIndex = when (state.step) {
        ReceivingStep.MATERIAL -> if (state.materialCode.isNotBlank() && state.lotNo.isNotBlank()) 1 else 0
        ReceivingStep.CONTAINERS -> 2
        ReceivingStep.PRINT_LABELS -> 3
        ReceivingStep.APPLY_LABELS -> 4
        ReceivingStep.GENERATE_PALLET -> 5
        ReceivingStep.QUANTITY -> 6
        ReceivingStep.LOCATION, ReceivingStep.CERTIFICATE, ReceivingStep.REVIEW -> 7
    }
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("物料仓位绑定流程（PDA ↔ WMS）", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            Text("节点状态随当前物料实时更新；IQC 与 OA 审批不在收料流程内。", color = MaterialTheme.colorScheme.onSurfaceVariant)
            nodes.forEachIndexed { index, (title, done, detail) ->
                Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                    val active = index == activeIndex && !state.submitted
                    Surface(color = if (active) MaterialTheme.colorScheme.primary.copy(alpha = 0.18f) else if (done) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant, shape = MaterialTheme.shapes.small, modifier = Modifier.weight(1f).border(if (active) 2.dp else 1.dp, if (active) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline, MaterialTheme.shapes.small).clickable { onNodeClick(index) }) {
                        Column(Modifier.padding(10.dp)) {
                            Text(if (active) "● 当前 → $title" else if (done) "✓ $title" else "○ $title", fontWeight = FontWeight.Bold, color = if (active) Color(0xFFDC2626) else if (done) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface)
                            Text(detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
                if (index < nodes.lastIndex) Text("↓", modifier = Modifier.padding(start = 18.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun SingleScreenReceivingPanel(
    state: MaterialReceivingState,
    vm: MaterialReceivingViewModel,
    camera: ActivityResultLauncher<Intent>,
    onSelectArea: () -> Unit,
    onScanBox: () -> Unit,
    onCancelBinding: () -> Unit
) {
    val colors = MaterialTheme.colorScheme
    val context = LocalContext.current
    var ttsReady by remember { mutableStateOf(false) }
    val tts = remember {
        TextToSpeech(context.applicationContext) { status ->
            ttsReady = status == TextToSpeech.SUCCESS
        }
    }
    DisposableEffect(tts) {
        onDispose { tts.stop(); tts.shutdown() }
    }
    LaunchedEffect(ttsReady, state.language) {
        if (ttsReady) {
            tts.language = if (state.language == "en") Locale.US else if (state.language == "vi") Locale("vi", "VN") else Locale.SIMPLIFIED_CHINESE
        }
    }
    LaunchedEffect(ttsReady, state.voicePrompt) {
        if (ttsReady && state.voicePrompt.isNotBlank()) {
            tts.speak(state.voicePrompt, TextToSpeech.QUEUE_FLUSH, null, "receiving-voice")
        }
    }
    fun positionCodeOf(locationQr: String): String {
        val v = locationQr.trim()
        if (v.isEmpty()) return ""
        val last = v.substringAfterLast(":").substringAfterLast(" ").trim()
        if (last.matches(Regex("^P\\d+-\\d+$"))) return last
        return last.uppercase()
    }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        // Scan tool switch: camera vs hardware scanner. Stored in SharedPreferences.
        val scanPrefs = remember { context.getSharedPreferences("receiving_scan", Context.MODE_PRIVATE) }
        var scanTool by remember { mutableStateOf(scanPrefs.getString("tool", "CAMERA") ?: "CAMERA") }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(
                onClick = { scanTool = "CAMERA"; scanPrefs.edit().putString("tool", "CAMERA").apply() },
                modifier = Modifier.weight(1f).height(40.dp),
                colors = if (scanTool == "CAMERA") ButtonDefaults.outlinedButtonColors(containerColor = MaterialTheme.colorScheme.primaryContainer) else ButtonDefaults.outlinedButtonColors()
            ) { Text("相机扫码", fontWeight = FontWeight.Bold) }
            OutlinedButton(
                onClick = { scanTool = "SCANNER"; scanPrefs.edit().putString("tool", "SCANNER").apply() },
                modifier = Modifier.weight(1f).height(40.dp),
                colors = if (scanTool == "SCANNER") ButtonDefaults.outlinedButtonColors(containerColor = MaterialTheme.colorScheme.primaryContainer) else ButtonDefaults.outlinedButtonColors()
            ) { Text("扫描枪", fontWeight = FontWeight.Bold) }
        }
        // Primary action — one "选库位" button (Image 1 style). After picking a
        // position the scan tool opens automatically (onSelect → scannerTarget = "code").
        OutlinedButton(onClick = onSelectArea, modifier = Modifier.fillMaxWidth().height(52.dp)) { Text("选库位", fontWeight = FontWeight.Bold) }
        // Flashing "请扫箱码" prompt after a position is picked.
        if (state.voicePrompt == "请扫箱码") {
            val pulse = rememberInfiniteTransition(label = "scan-prompt")
            val alpha by pulse.animateFloat(1f, 0.35f, infiniteRepeatable(animation = tween(500), repeatMode = RepeatMode.Reverse), label = "scan-prompt-alpha")
            Surface(color = Color(0xFFFFF3E0), shape = RoundedCornerShape(8.dp), modifier = Modifier.fillMaxWidth().alpha(alpha)) {
                Text("请扫箱码", fontWeight = FontWeight.Bold, color = Color(0xFFE65100), modifier = Modifier.padding(14.dp))
            }
        }
        // Area / working position status.
        if (state.lockedArea.isNotBlank()) {
            Surface(color = colors.secondaryContainer, shape = RoundedCornerShape(8.dp), modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("已锁定区域：${state.lockedArea}", fontWeight = FontWeight.Bold, color = colors.primary)
                    if (state.activePosition.isNotBlank()) Text("当前工作库位：${state.activePosition}", color = colors.primary)
                    if (state.location.isNotBlank()) {
                        val boundCount = state.positionBoxCounts[positionCodeOf(state.location)] ?: 0
                        Text("已绑箱数：$boundCount", color = colors.onSurfaceVariant)
                    }
                    OutlinedButton(onClick = { vm.unlockArea() }, modifier = Modifier.fillMaxWidth()) { Text("解锁区域") }
                }
            }
        }
        // Binding result — explicit SUCCESS / REJECTED state with a clear label.
        if (state.bindingResult.isNotBlank()) {
            val ok = state.bindingResult.startsWith("物料已收货")
            val label = if (ok) "绑定成功" else "重复 / 已拒绝"
            Surface(
                color = if (ok) Color(0xFFE8F5E9) else Color(0xFFFFEBEE),
                shape = RoundedCornerShape(10.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(label, fontWeight = FontWeight.Bold, color = if (ok) Color(0xFF2E7D32) else Color(0xFFC62828))
                    Text(state.bindingResult, color = if (ok) Color(0xFF166534) else Color(0xFFB71C1C))
                    // No manual rescan button: success and dup both auto-continue
                    // with the next box (see bindCurrentBox + autoNext below).
                }
            }
        }
        // Parsed box content — shown right after a scan so the operator can see
        // what was read (material code, lot, supplier, qty).
        if (state.materialCode.isNotBlank() || state.lotNo.isNotBlank()) {
            Surface(color = Color(0xFFDCFCE7), shape = RoundedCornerShape(10.dp), modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("✓ 箱 QR 解析结果", fontWeight = FontWeight.Bold, color = Color(0xFF15803D))
                    if (state.supplier.isNotBlank()) Text("供应商：${state.supplier}", color = Color(0xFF166534))
                    if (state.materialCode.isNotBlank()) Text("物料编码：${state.materialCode}", color = Color(0xFF166534))
                    if (state.manufactureDate.isNotBlank()) Text("生产日期：${state.manufactureDate}", color = Color(0xFF166534))
                    if (state.quantityPerBox.isNotBlank()) Text("数量：${state.quantityPerBox} ${state.unit}", color = Color(0xFF166534))
                    if (state.lotNo.isNotBlank()) Text("批次：${state.lotNo}", color = Color(0xFF166534))
                    if (state.referenceSn.isNotBlank()) Text("流水号：${state.referenceSn}", color = Color(0xFF166534))
                    if (state.boxCode.isNotBlank()) Text("箱 QR：${state.boxCode}", color = Color(0xFF166534))
                }
            }
        }
        // Manual input section — collapsible, shown on demand.
        var showManual by remember { mutableStateOf(false) }
        OutlinedButton(onClick = { showManual = !showManual }, modifier = Modifier.fillMaxWidth()) {
            Text(if (showManual) "收起手动输入 ▲" else "手动输入 ▼")
        }
        if (showManual) {
            CaptureAndConfirm(state, vm, camera, scan = onScanBox)
        }
        // Bottom actions: 取消最后绑定.
        OutlinedButton(onClick = onCancelBinding, modifier = Modifier.fillMaxWidth().height(52.dp)) { Text("取消最后绑定") }
    }
}

@Composable
private fun ReceivingStartSection(state: MaterialReceivingState, vm: MaterialReceivingViewModel, onScan: (String) -> Unit) {
    Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.tertiaryContainer)) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("收料第一步：选择仓库区域", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            Text("先选择仓库区域，再从地图中点击具体库位。", color = MaterialTheme.colorScheme.primary)
            OutlinedButton(
                onClick = { vm.loadWarehouseAreas() },
                modifier = Modifier.fillMaxWidth()
            ) { Text("选择仓库区域") }
            if (state.lockedArea.isNotBlank()) {
                Text("已锁定区域：${state.lockedArea}", color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold)
                OutlinedButton(
                    onClick = { vm.unlockArea() },
                    modifier = Modifier.fillMaxWidth()
                ) { Text("解锁") }
            }
            if (state.location.isNotBlank()) {
                Text("已选库位：${state.location}", color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold)
            }
        }
    }
}

@Composable
private fun InitialQrCollection(state: MaterialReceivingState, vm: MaterialReceivingViewModel, onScan: (String) -> Unit) {
    return
    // The receiving station must identify the exact warehouse slot before any box is bound.
    Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.tertiaryContainer)) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("库位 QR（例如 B1-18）", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
            Field("扫描库位 QR", state.location, { vm.updateMaterialField("location", it) }, scan = { onScan("location") })
            Text(if (state.location.isBlank()) "必须先确认托板放入的实际库位" else "当前库位：${state.location} · 已同步 WMS", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
    Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer)) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("收料信息采集：先扫全部 QR / 标签", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            Field("第一项：唯一库位 QR", state.location, { vm.updateMaterialField("location", it) }, scan = { onScan("location") })
            Text("WMS 根据唯一库位自动解析区域；再扫描物料和箱 QR，没有的信息由 WMS OCR 补齐。", color = MaterialTheme.colorScheme.onSurfaceVariant)
            Field("托板 QR", state.palletCode, { vm.updateMaterialField("pallet", it) }, scan = { onScan("pallet") })
            Field("箱 QR / Box SN", state.boxCode, { vm.updateMaterialField("box", it) }, scan = { onScan("box") })
            Text(
                if (state.palletCode.isNotBlank() && state.boxCode.isNotBlank()) "QR 采集完成：箱 QR → 托板 QR" else "待补齐：${listOfNotNull(if (state.palletCode.isBlank()) "托板 QR" else null, if (state.boxCode.isBlank()) "箱 QR" else null).joinToString("、")}",
                color = MaterialTheme.colorScheme.primary
            )
        }
    }
}

@Composable
private fun MaterialSnCollection(state: MaterialReceivingState, onScan: () -> Unit) {
    val required = state.boxCount.toIntOrNull()?.coerceAtLeast(1) ?: 0
    Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer)) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("打印前：扫描全部物料 / 箱体 SN", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            Text("现场逐个扫描每个箱体 SN；重复 SN 会被忽略。扫描完成后才允许打印标签。", color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text("已扫描 ${state.materialSnCodes.size} / ${if (required > 0) required else "待填写箱数"}", color = if (required > 0 && state.materialSnCodes.size >= required) Color(0xFF15803D) else MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold)
            OutlinedButton(onClick = onScan, modifier = Modifier.fillMaxWidth()) { Text("使用 PDA 内置扫描器 / 相机扫描下一个 SN") }
            if (state.materialSnCodes.isNotEmpty()) Text(state.materialSnCodes.joinToString("、"), style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
private fun SupplierCertificateSection(photoCount: Int, onCapture: () -> Unit) {
    Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("供应商质量证书（可选）", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
            Text("如有证书/COA，可上传并关联当前批次；未上传不影响物料与仓位绑定。", color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text("已记录：$photoCount 项")
            Button(onClick = onCapture, modifier = Modifier.fillMaxWidth()) { Text("拍摄并上传供应商质量证书到 WMS") }
        }
    }
}

@Composable
private fun ReceivingLabelWorkflow(state: MaterialReceivingState, vm: MaterialReceivingViewModel, onScan: () -> Unit) {
    val requiredBoxes = state.boxCount.toIntOrNull()?.coerceAtLeast(1) ?: 1
    val required = requiredBoxes
    val scanned = state.scannedLabelCodes.size
    Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.tertiaryContainer)) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("箱体二维码打印与逐个扫描", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            Text("打印所有箱体 QR 并分别贴到每个箱体；内部收料组由 WMS 隐藏管理。", color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text("箱标签：$requiredBoxes 张 · 已扫描：$scanned 张")
            Button(onClick = vm::markLabelsPrinted, enabled = !state.labelsPrinted, modifier = Modifier.fillMaxWidth()) {
                Text(if (state.labelsPrinted) "已发送该托板全部二维码打印任务" else "开始打印该托板上的所有二维码")
            }
            Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                Checkbox(checked = state.labelsApplied, onCheckedChange = vm::markLabelsApplied, enabled = state.labelsPrinted)
                Text("确认所有标签已贴到对应托板/箱/物料")
            }
            OutlinedButton(onClick = onScan, enabled = state.labelsPrinted && state.labelsApplied && scanned < required, modifier = Modifier.fillMaxWidth()) {
                Text(if (scanned >= required) "全部标签扫描完成" else "扫描下一张标签 ($scanned/$required)")
            }
            if (state.scannedLabelCodes.isNotEmpty()) Text("已扫描：${state.scannedLabelCodes.joinToString("、")}", style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
private fun FinalPalletBinding(state: MaterialReceivingState, vm: MaterialReceivingViewModel, onScanLocation: () -> Unit) {
    Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.secondaryContainer)) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("最终绑定并完成收料", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            Text("标签全部扫描完成后，生成托板 QR；箱 QR 绑定托板 QR，再将托板 QR 绑定库位。", color = MaterialTheme.colorScheme.onSurfaceVariant)
            Button(onClick = vm::generatePalletQr, enabled = state.palletCode.isBlank() && state.labelsPrinted && state.labelsApplied, modifier = Modifier.fillMaxWidth()) {
                Text(if (state.palletCode.isBlank()) "生成托板 QR 并绑定当前箱体" else "托板 QR 已生成")
            }
            Text("箱 QR → 托板 QR：${if (state.boxCode.isNotBlank() && state.palletCode.isNotBlank()) "已绑定" else "待绑定"}", color = MaterialTheme.colorScheme.primary)
            Field("托板目标库位", state.location, { vm.updateMaterialField("location", it) }, scan = onScanLocation)
            Text("托板 QR → 库位：${if (state.palletCode.isNotBlank() && state.location.isNotBlank()) "已绑定" else "待绑定"}", color = MaterialTheme.colorScheme.primary)
        }
    }
}

@Composable
private fun PalletTypeDropdown(value: String, onChange: (String) -> Unit, modifier: Modifier = Modifier) {
    var expanded by remember { mutableStateOf(false) }
    Box(modifier) {
        OutlinedButton(onClick = { expanded = true }, modifier = Modifier.fillMaxWidth()) {
            Text(value.ifBlank { "单一产品" }, modifier = Modifier.weight(1f))
            Text("▼")
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            listOf("单一产品", "混料托板").forEach { option ->
                DropdownMenuItem(text = { Text(option) }, onClick = { onChange(option); expanded = false })
            }
        }
    }
}

@Composable
private fun PalletInfo(
    type: String,
    size: String,
    material: String,
    onTypeChange: (String) -> Unit,
    onSizeChange: (String) -> Unit,
    onMaterialChange: (String) -> Unit
) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("托板信息（收料时填写）", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                PalletTypeDropdown(type, onTypeChange, Modifier.weight(1f))
                Field("托板尺寸", size, onSizeChange, modifier = Modifier.weight(1f))
                Field("托板材质", material, onMaterialChange, modifier = Modifier.weight(1f))
            }
        }
    }
}

@Composable
private fun ReceivingPdaAssignment(
    deviceName: String,
    deviceConfirmed: Boolean
) {
    Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer)) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("WMS 收料 PDA 调度", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            Text("设备进入本页面后自动注册到 WMS，无需收料员确认。", color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text("本机：$deviceName    角色：物料仓位绑定    状态：${if (deviceConfirmed) "自动接入 WMS" else "注册中"}", color = MaterialTheme.colorScheme.primary)
        }
    }
}

@Composable
private fun ReceivingQueue(purchaseOrders: List<ReceivingPo>, statusText: String, enabled: Boolean, onSelect: (ReceivingPo, ReceivingPoLine) -> Unit) {
    var selectedPo by remember { mutableStateOf<ReceivingPo?>(null) }
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("待收采购订单", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            Text(statusText, color = MaterialTheme.colorScheme.onSurfaceVariant)
            purchaseOrders.forEach { po ->
                OutlinedButton(onClick = { selectedPo = po }, enabled = enabled, modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.fillMaxWidth(), horizontalAlignment = androidx.compose.ui.Alignment.Start) {
                        Text(po.po, fontWeight = FontWeight.Bold)
                        Text("${po.supplierCode} · ${po.supplierName}")
                        Text("创建：${po.createdDate.ifBlank { "—" }}  要求到货：${po.promisedDate.ifBlank { "—" }}")
                        Text("${po.status} · WMS 管理测试任务", color = MaterialTheme.colorScheme.primary)
                    }
                }
            }
            selectedPo?.let { po ->
                Text("已选择 ${po.po}。该任务不是采购订单，确认后创建本次收料明细。")
                Button(onClick = {
                    onSelect(po, po.lines.firstOrNull() ?: ReceivingPoLine("", "", "", "0", "", "PCS"))
                    selectedPo = null
                }, enabled = enabled, modifier = Modifier.fillMaxWidth().height(56.dp)) {
                    Text("确认并创建收料明细")
                }
            }
        }
    }
}

@Composable private fun CaptureAndConfirm(state: MaterialReceivingState, vm: MaterialReceivingViewModel, camera: ActivityResultLauncher<Intent>, scan: () -> Unit) {
    val context = LocalContext.current
    Text("本批次 OCR 尝试次数：${state.ocrAttemptCount}；当前仅保留最后一次图片和解析结果", color = MaterialTheme.colorScheme.primary)
    Title("1. 先读取标准二维码", "二维码是第一数据源，扫描成功后直接填入WMS；二维码缺少的数据再用OCR补充。")
    Button(scan, Modifier.fillMaxWidth().height(76.dp)) { Text("读取标准二维码并填入WMS", style = MaterialTheme.typography.titleMedium) }
    Title("1. 拍摄标签并自动上传 WMS", "拍照完成后自动上传并由 WMS OCR，不需要收料员确认。")
    Button({ camera.launch(Intent(context, com.smt.materialloader.AutoLabelCameraActivity::class.java)) }, Modifier.fillMaxWidth().height(76.dp)) { Text("📷 手动拍摄标签图片", style = MaterialTheme.typography.titleMedium) }
    OutlinedButton(scan, Modifier.fillMaxWidth()) { Text("扫码读取标签") }
    val inputMethod = state.inputMethod
    if (inputMethod == "SUPPLIER_LABEL_QR" || inputMethod == "STANDARD_QR" || inputMethod == "OCR_SUPPLEMENT" || inputMethod.isNotBlank()) {
        val methodLabel = when (inputMethod) {
            "SUPPLIER_LABEL_QR" -> "供应商标签二维码"
            "STANDARD_QR" -> "标准二维码"
            "OCR_SUPPLEMENT" -> "OCR 补充"
            "MLKIT_OCR" -> "本地 OCR"
            else -> inputMethod
        }
        Surface(
            modifier = Modifier.fillMaxWidth().border(2.dp, Color(0xFF16A34A), RoundedCornerShape(10.dp)),
            color = Color(0xFFDCFCE7), shape = RoundedCornerShape(10.dp)
        ) {
            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("✓ QR 解析结果", fontWeight = FontWeight.Bold, color = Color(0xFF15803D))
                Text("解析方式：$methodLabel", color = Color(0xFF166534))
                if (state.materialCode.isNotBlank()) Text("物料编码：${state.materialCode}", color = Color(0xFF166534))
                if (state.internalMaterialCode.isNotBlank()) Text("瑞晶编码：${state.internalMaterialCode}", color = Color(0xFF166534))
                if (state.lotNo.isNotBlank()) Text("批次：${state.lotNo}", color = Color(0xFF166534))
                if (state.supplier.isNotBlank()) Text("供应商：${state.supplier}", color = Color(0xFF166534))
                if (state.manufactureDate.isNotBlank()) Text("生产日期：${state.manufactureDate}", color = Color(0xFF166534))
                if (state.quantityPerBox.isNotBlank()) Text("数量：${state.quantityPerBox} ${state.unit}", color = Color(0xFF166534))
                if (state.referenceSn.isNotBlank()) Text("流水号：${state.referenceSn}", color = Color(0xFF166534))
                if (state.supplierBarcode.isNotBlank()) Text("供应商代码：${state.supplierBarcode}", color = Color(0xFF166534))
            }
        }
    }
    if (state.labelImageDataUrl.isNotBlank()) {
        val image = remember(state.labelImageDataUrl) {
            runCatching { val bytes = Base64.decode(state.labelImageDataUrl.substringAfter(","), Base64.DEFAULT); BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap() }.getOrNull()
        }
        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text("已保存标签图片 #${state.labelImageCount}", fontWeight = FontWeight.Bold)
                    IconButton(onClick = vm::deleteLastLabelImage) { Icon(Icons.Default.Clear, "删除图片") }
                }
                if (image != null) Image(image, "标签图片", Modifier.fillMaxWidth().heightIn(max = 220.dp), contentScale = ContentScale.Fit)
                OutlinedButton(onClick = vm::deleteLastLabelImage, modifier = Modifier.fillMaxWidth()) { Text("删除本张图片，重新拍摄") }
            }
        }
    }
    if (state.aiStatus.isNotBlank()) Text(state.aiStatus, color = if (state.aiStatus == "无法解析") MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary)
    Title("WMS OCR 结果", "WMS 自动识别、回填并同步；识别异常由 WMS 复核。")
    Field("越南物料编码", state.materialCode, { vm.updateMaterialField("code", it) })
    Field("瑞晶物料编码", state.internalMaterialCode, { vm.updateMaterialField("internalCode", it) })
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Field("批次", state.lotNo, { vm.updateMaterialField("lot", it) }, modifier = Modifier.weight(1f))
        MsdDropdown(state.msLevel, { vm.updateMaterialField("msLevel", it) }, Modifier.weight(1f))
    }
    Field("供应商", state.supplier, { vm.updateMaterialField("supplier", it) })
    Field("采购订单", state.purchaseOrder, { vm.updateMaterialField("po", it) })
    Field("规格型号", state.specification, { vm.updateMaterialField("specification", it) })
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Field("生产日期", state.manufactureDate, { vm.updateMaterialField("manufactureDate", it) }, modifier = Modifier.weight(1f))
        Field("有效期至", state.expiryDate, { vm.updateMaterialField("expiryDate", it) }, modifier = Modifier.weight(1f))
    }
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
    }
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Field("每箱数量", state.quantityPerBox, { vm.updateMaterialField("quantityPerBox", it) }, modifier = Modifier.weight(1f))
        Field("流水号", state.referenceSn, { vm.updateMaterialField("refSn", it) }, modifier = Modifier.weight(1f))
    }
    Field("箱/件数量（现场核验）", state.boxCount, { vm.updateMaterialField("boxCount", it) })
    Button(
        onClick = { vm.bindCurrentBox() },
        enabled = state.location.isNotBlank() && state.boxCode.isNotBlank(),
        modifier = Modifier.fillMaxWidth().height(52.dp)
    ) { Text("确认绑定", fontWeight = FontWeight.Bold) }
}

// Area picker dialog - full-screen list of all warehouse areas
@Composable
private fun AreaPickerDialog(
    areas: List<com.smt.materialloader.ui.receiving.WarehouseArea>,
    error: String?,
    onPick: (com.smt.materialloader.ui.receiving.WarehouseArea) -> Unit,
    onDismiss: () -> Unit
) {
    val colors = MaterialTheme.colorScheme
    Dialog(onDismissRequest = onDismiss) {
        Surface(
            modifier = Modifier
                .fillMaxWidth(0.96f)
                .fillMaxHeight(0.9f),
            shape = RoundedCornerShape(12.dp),
            color = colors.surface
        ) {
            Column(Modifier.padding(16.dp).fillMaxSize(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    if (areas.isEmpty()) "选择仓库区域" else "选择仓库区域 (${areas.size})",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold
                )
                Text("点击区域查看所有库位 · 上下滑查看全部", style = MaterialTheme.typography.bodyMedium, color = colors.onSurfaceVariant)
                if (!error.isNullOrBlank()) {
                    Text("加载失败: $error", style = MaterialTheme.typography.bodyMedium, color = Color(0xFFC62828))
                }
                if (areas.isEmpty() && error.isNullOrBlank()) {
                    Text("加载中...", style = MaterialTheme.typography.bodyMedium)
                } else {
                    LazyColumn(
                        Modifier
                            .fillMaxWidth()
                            .weight(1f)
                            .padding(vertical = 8.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        items(areas) { area ->
                            Text(
                                text = if (area.nameZh.isNotBlank() && area.nameZh != area.area) "${area.nameZh} · ${area.area} · ${area.totalCount}" else "${area.area} · ${area.totalCount}",
                                style = MaterialTheme.typography.titleSmall,
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .background(
                                        color = colors.primaryContainer,
                                        shape = RoundedCornerShape(10.dp)
                                    )
                                    .padding(horizontal = 16.dp, vertical = 18.dp)
                                    .wrapContentSize(Alignment.Center)
                                    .clickable { onPick(area) }
                            )
                        }
                    }
                }
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    TextButton(onClick = onDismiss) { Text("取消") }
                }
            }
        }
    }
}

// Location map dialog - visual grid layout of warehouse positions
@Composable
private fun LocationMapDialog(
    area: String,
    locations: List<String>,
    positionBoxCounts: Map<String, Int> = emptyMap(),
    activePosition: String = "",
    onSelect: (String) -> Unit,
    onDismiss: () -> Unit
) {
    val colors = MaterialTheme.colorScheme
    // Group positions by row (P01-01, P01-02, ... → row "P01")
    val rows = locations.groupBy { it.substringBefore("-") }.toSortedMap()
    val totalCols = rows.values.maxOfOrNull { it.size } ?: 0
    // Full-screen dialog: fills PDA screen like the web SVG view
    Dialog(onDismissRequest = onDismiss) {
        Surface(
            modifier = Modifier
                .fillMaxWidth(0.96f)
                .fillMaxHeight(0.9f),
            shape = RoundedCornerShape(12.dp),
            color = colors.surface
        ) {
            Column(
                Modifier.padding(16.dp).fillMaxSize(),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Text("选择库位 - $area", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                Text(
                    "$area 区域 · 共 ${rows.size} 行 × ${totalCols} 列 = ${locations.size} 个库位",
                    style = MaterialTheme.typography.bodySmall,
                    color = colors.onSurfaceVariant
                )
                // Orange area border like SVG layout — fills remaining space, scrolls both ways
                val vScroll = rememberScrollState()
                val hScroll = rememberScrollState()
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .weight(1f)
                        .border(2.dp, Color(0xFFEF6C00), RoundedCornerShape(8.dp))
                        .padding(12.dp)
                ) {
                    Column(
                        modifier = Modifier
                            .fillMaxSize()
                            .verticalScroll(vScroll)
                            .horizontalScroll(hScroll),
                        verticalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        rows.entries.forEach { (rowKey, cols) ->
                            Row(
                                horizontalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                cols.sorted().forEach { loc ->
                                    PositionBox(
                                        code = loc,
                                        boxCount = positionBoxCounts[loc] ?: 0,
                                        isWorking = loc == activePosition,
                                        modifier = Modifier.width(124.dp),
                                        onClick = { onSelect(loc) }
                                    )
                                }
                            }
                        }
                    }
                }
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text(
                        "点击任一库位框绑定该位置",
                        style = MaterialTheme.typography.bodySmall,
                        color = colors.onSurfaceVariant
                    )
                    TextButton(onClick = onDismiss) { Text("取消") }
                }
            }
        }
    }
}

@Composable
private fun PositionBox(code: String, boxCount: Int = 0, isWorking: Boolean = false, modifier: Modifier = Modifier, onClick: () -> Unit) {
    val colors = MaterialTheme.colorScheme
    val bound = boxCount > 0
    // Working position pulses to show which grid box is being filled right now.
    val pulse = rememberInfiniteTransition(label = "working-pos")
    val flashAlpha by pulse.animateFloat(
        initialValue = 1f,
        targetValue = 0.35f,
        animationSpec = infiniteRepeatable(animation = tween(500), repeatMode = RepeatMode.Reverse),
        label = "flash-alpha"
    )
    val bg = if (bound) Color(0xFFFFEBEE) else if (isWorking) Color(0xFFFFF3E0) else Color(0xFFE8F5E9)
    val border = if (bound) Color(0xFFE53935) else if (isWorking) Color(0xFFEF6C00) else Color(0xFF66BB6A)
    val fg = if (bound) Color(0xFFC62828) else if (isWorking) Color(0xFFE65100) else Color(0xFF2E7D32)
    val alpha = if (isWorking) flashAlpha else 1f
    Box(
        modifier = modifier
            .height(76.dp)
            .background(color = bg, shape = RoundedCornerShape(10.dp))
            .border(width = if (isWorking) 3.dp else 2.dp, color = border, shape = RoundedCornerShape(10.dp))
            .alpha(alpha)
            .clickable { onClick() },
        contentAlignment = Alignment.Center
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(
                text = code,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                color = fg
            )
            Text(
                text = if (bound) "$boxCount 箱" else "EMPTY",
                style = MaterialTheme.typography.bodySmall,
                fontWeight = if (bound) FontWeight.Bold else FontWeight.Normal,
                color = if (bound) Color(0xFFE53935) else if (isWorking) Color(0xFFEF6C00) else Color(0xFF66BB6A)
            )
        }
    }
}

@Composable private fun MsdDropdown(value: String, onChange: (String) -> Unit, modifier: Modifier = Modifier) {
    var expanded by remember { mutableStateOf(false) }
    val levels = listOf("MS-1", "MS-2", "MS-2a", "MS-3", "MS-4", "MS-5", "MS-5a", "MS-6")
    Box(modifier) {
        OutlinedButton(onClick = {}, enabled = false, modifier = Modifier.fillMaxWidth().height(64.dp)) {
            Text(if (value.isBlank()) "MSD等级（选择）" else value, modifier = Modifier.weight(1f))
            Text("▼")
        }
    }
}

@Composable private fun Title(title: String, desc: String) { Column { Text(title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold); Text(desc, color = MaterialTheme.colorScheme.onSurfaceVariant) } }
@Composable private fun Field(label: String, value: String, change: (String) -> Unit, scan: (() -> Unit)? = null, modifier: Modifier = Modifier) { OutlinedTextField(value, change, label = { Text(label) }, modifier = modifier.fillMaxWidth(), singleLine = true, trailingIcon = { Row { if (value.isNotEmpty()) IconButton({ change("") }) { Icon(Icons.Default.Clear, "清除") }; if (scan != null) TextButton(scan) { Text("扫码") } } }) }
@Composable private fun Review(label: String, value: String) { ListItem(headlineContent = { Text(label) }, supportingContent = { Text(value.ifBlank { "未填写" }) }) }
private fun canContinue(s: MaterialReceivingState) = when (s.step) { ReceivingStep.MATERIAL -> s.location.isNotBlank() && s.materialCode.isNotBlank() && s.lotNo.isNotBlank(); ReceivingStep.CONTAINERS -> s.boxCode.isNotBlank() && s.boxNumber.isNotBlank() && s.boxCount.toIntOrNull()?.let { it > 0 } == true && s.palletQuantity.toDoubleOrNull()?.let { it > 0 } == true && s.materialSnCodes.size >= (s.boxCount.toIntOrNull()?.coerceAtLeast(1) ?: Int.MAX_VALUE); ReceivingStep.PRINT_LABELS -> s.labelsPrinted; ReceivingStep.APPLY_LABELS -> s.labelsApplied; ReceivingStep.GENERATE_PALLET -> true; ReceivingStep.QUANTITY -> s.location.isNotBlank(); ReceivingStep.LOCATION -> true; ReceivingStep.CERTIFICATE -> true; ReceivingStep.REVIEW -> s.location.isNotBlank() && s.labelsPrinted && s.labelsApplied && s.scannedLabelCodes.size >= (s.boxCount.toIntOrNull()?.coerceAtLeast(1) ?: 1) }

private fun canBindMaterialToLocation(s: MaterialReceivingState) =
    s.materialCode.isNotBlank() &&
    s.internalMaterialCode.isNotBlank() &&
    s.lotNo.isNotBlank() &&
    s.supplier.isNotBlank() &&
    s.quantityPerBox.toDoubleOrNull()?.let { it > 0 } == true &&
    s.boxCode.isNotBlank() &&
    s.location.isNotBlank()
