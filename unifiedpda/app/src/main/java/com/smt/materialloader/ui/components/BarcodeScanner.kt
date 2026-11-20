package com.smt.materialloader.ui.components

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.*
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.FlashOff
import androidx.compose.material.icons.filled.FlashOn
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import java.util.concurrent.Executors

@Composable
fun BarcodeScanner(
    onBarcodeDetected: (String) -> Unit,
    onError: (String) -> Unit,
    modifier: Modifier = Modifier,
    resetKey: Any? = Unit
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    var hasCameraPermission by remember { mutableStateOf(false) }
    var isFlashOn by remember { mutableStateOf(false) }
    // Latch per scan cycle. IMPORTANT: keep ONE State instance — the camera
    // analyzer callback captured at first composition reads this same instance;
    // recreating it would leave the analyzer reading a stale "false" forever
    // (bound once, then camera dead). resetKey flips it back to true.
    val isScanningState = remember { mutableStateOf(true) }
    var isScanning by isScanningState
    LaunchedEffect(resetKey) { isScanningState.value = true }
    // Last time each code was SEEN by the analyzer. A code that keeps being
    // re-detected (the box is still in view after a successful bind) stays
    // suppressed until it leaves the view; only codes that were already
    // scanned are tracked, so a new box presented while a bind is in flight
    // is never poisoned and fires as soon as the scanner re-arms.
    val recentScanTimes = remember { mutableMapOf<String, Long>() }
    // Last time each code actually FIRED a scan. A code that has never fired
    // fires as soon as the latch opens (even if it was sitting in view while a
    // previous bind was in flight); a code that already fired fires again only
    // after leaving the view for a gap — that re-presentation is what the dup
    // warning path is for.
    val firedScanTimes = remember { mutableMapOf<String, Long>() }
    val rePresentGapMs = 1500L

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        hasCameraPermission = granted
        if (!granted) onError("Camera permission denied")
    }

    LaunchedEffect(Unit) {
        if (ContextCompat.checkSelfPermission(
                context, Manifest.permission.CAMERA
            ) == PackageManager.PERMISSION_GRANTED
        ) {
            hasCameraPermission = true
        } else {
            permissionLauncher.launch(Manifest.permission.CAMERA)
        }
    }

    Box(
        modifier = modifier
            .fillMaxWidth()
            .aspectRatio(4f / 3f)
            .clip(RoundedCornerShape(12.dp)),
        contentAlignment = Alignment.Center
    ) {
        if (hasCameraPermission) {
            CameraPreview(
                lifecycleOwner = lifecycleOwner,
                isFlashOn = isFlashOn,
                onBarcodeDetected = { barcode ->
                    val now = System.currentTimeMillis()
                    val lastSeen = recentScanTimes[barcode]
                    recentScanTimes[barcode] = now
                    val alreadyFired = firedScanTimes.containsKey(barcode)
                    // Never-fired code (a NEW box presented while a bind was in
                    // flight) fires the moment the latch opens. A code that
                    // already fired only fires again after it left the view for
                    // a gap — that deliberate re-presentation is the dup path.
                    val rePresented = lastSeen == null || now - lastSeen > rePresentGapMs
                    if (isScanning && (!alreadyFired || rePresented)) {
                        firedScanTimes[barcode] = now
                        isScanning = false
                        vibrate(context)
                        onBarcodeDetected(barcode)
                    }
                },
                modifier = Modifier.fillMaxSize()
            )

            // Viewfinder overlay
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(Color.Black.copy(alpha = 0.3f)),
                contentAlignment = Alignment.Center
            ) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth(0.8f)
                        .fillMaxHeight(0.4f)
                        .border(3.dp, Color.White, RoundedCornerShape(8.dp))
                )
            }

            // Flash toggle
            IconButton(
                onClick = { isFlashOn = !isFlashOn },
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(8.dp)
                    .size(40.dp),
            ) {
                Icon(
                    if (isFlashOn) Icons.Default.FlashOn else Icons.Default.FlashOff,
                    contentDescription = "Toggle flash",
                    tint = Color.White
                )
            }

            // Scanning indicator
            if (!isScanning) {
                Surface(
                    color = Color(0xCC4CAF50),
                    shape = RoundedCornerShape(8.dp),
                    modifier = Modifier.align(Alignment.Center)
                ) {
                    Text(
                        text = "Barcode detected!",
                        color = Color.White,
                        fontWeight = FontWeight.Bold,
                        fontSize = 16.sp,
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)
                    )
                }
            }
        } else {
            // Permission request or denied state
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
                modifier = Modifier.fillMaxSize().background(Color.Black)
            ) {
                Text(
                    text = "Camera access required for barcode scanning",
                    color = Color.White,
                    fontSize = 14.sp
                )
                Spacer(modifier = Modifier.height(8.dp))
                Button(onClick = { permissionLauncher.launch(Manifest.permission.CAMERA) }) {
                    Text("Grant Camera Permission")
                }
            }
        }
    }
}

@Composable
private fun CameraPreview(
    lifecycleOwner: LifecycleOwner,
    isFlashOn: Boolean,
    onBarcodeDetected: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    val qrScanner = remember {
        BarcodeScanning.getClient(
            BarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build()
        )
    }
    DisposableEffect(Unit) { onDispose { qrScanner.close() } }

    AndroidView(
        factory = { ctx ->
            val previewView = PreviewView(ctx)
            val cameraProviderFuture = ProcessCameraProvider.getInstance(ctx)

            cameraProviderFuture.addListener({
                val cameraProvider = cameraProviderFuture.get()

                val preview = Preview.Builder().build().also {
                    it.setSurfaceProvider(previewView.surfaceProvider)
                }

                val imageAnalysis = ImageAnalysis.Builder()
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .setTargetResolution(android.util.Size(1280, 720))
                    .build()

                @OptIn(ExperimentalGetImage::class)
                imageAnalysis.setAnalyzer(Executors.newSingleThreadExecutor()) { imageProxy ->
                    val mediaImage = imageProxy.image
                    if (mediaImage != null) {
                        val inputImage = InputImage.fromMediaImage(mediaImage, imageProxy.imageInfo.rotationDegrees)
                        qrScanner.process(inputImage)
                            .addOnSuccessListener { barcodes ->
                                for (barcode in barcodes) {
                                    barcode.rawValue?.let { value ->
                                        onBarcodeDetected(value)
                                    }
                                }
                            }
                            .addOnCompleteListener {
                                imageProxy.close()
                            }
                    } else {
                        imageProxy.close()
                    }
                }

                val cameraSelector = CameraSelector.Builder()
                    .requireLensFacing(CameraSelector.LENS_FACING_BACK)
                    .build()

                try {
                    cameraProvider.unbindAll()
                    val camera = cameraProvider.bindToLifecycle(
                        lifecycleOwner, cameraSelector, preview, imageAnalysis
                    )
                    val focusPoint = previewView.meteringPointFactory.createPoint(
                        previewView.width / 2f,
                        previewView.height / 2f
                    )
                    camera.cameraControl.startFocusAndMetering(
                        FocusMeteringAction.Builder(focusPoint).build()
                    )
                    // Flash control
                    camera.cameraControl?.enableTorch(isFlashOn)
                } catch (e: Exception) {
                    // Camera in use
                }
            }, ContextCompat.getMainExecutor(ctx))

            previewView
        },
        modifier = modifier
    )
}

private fun vibrate(context: android.content.Context) {
    val vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        val vm = context.getSystemService(android.content.Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager
        vm.defaultVibrator
    } else {
        @Suppress("DEPRECATION")
        context.getSystemService(android.content.Context.VIBRATOR_SERVICE) as Vibrator
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        vibrator.vibrate(VibrationEffect.createOneShot(200, VibrationEffect.DEFAULT_AMPLITUDE))
    } else {
        @Suppress("DEPRECATION")
        vibrator.vibrate(200)
    }
}
