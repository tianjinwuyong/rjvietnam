package com.smt.materialloader.ui.components

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.ExperimentalGetImage
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import com.google.mlkit.vision.text.chinese.ChineseTextRecognizerOptions
import java.util.concurrent.Executors
import android.util.Log
import kotlinx.coroutines.delay

/** Camera OCR fallback. Recognition is bundled in the APK and runs without connectivity. */
@Composable
fun MaterialLabelOcrScanner(
    onResult: (MaterialLabelOcrResult) -> Unit,
    onError: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    var granted by remember { mutableStateOf(ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) }
    var busy by remember { mutableStateOf(false) }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
        granted = it
        if (!it) onError("Camera permission denied")
    }
    LaunchedEffect(Unit) { if (!granted) permission.launch(Manifest.permission.CAMERA) }
    LaunchedEffect(granted) { if (granted) { delay(8000); onError("No readable label text found. Hold the label steady and tap Retry OCR.") } }
    Box(modifier.aspectRatio(4f / 3f)) {
        if (granted) AndroidView(factory = { ctx ->
            val view = PreviewView(ctx)
            val future = ProcessCameraProvider.getInstance(ctx)
            future.addListener({
                val provider = future.get()
                val preview = Preview.Builder().build().also { it.setSurfaceProvider(view.surfaceProvider) }
                val analysis = ImageAnalysis.Builder().setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST).build()
                val executor = Executors.newSingleThreadExecutor()
                val recognizer = TextRecognition.getClient(ChineseTextRecognizerOptions.Builder().build())
                @OptIn(ExperimentalGetImage::class)
                analysis.setAnalyzer(executor) { proxy ->
                    val image = proxy.image
                    if (image == null || busy) { proxy.close(); return@setAnalyzer }
                    busy = true
                    recognizer.process(InputImage.fromMediaImage(image, proxy.imageInfo.rotationDegrees))
                        .addOnSuccessListener { result ->
                            Log.d("UnifiedPdaOCR", "recognized=${result.text.replace('\n', '|')}")
                            val parsed = MaterialLabelOcrParser.parse(result.text)
                            if (parsed.scanValue.isNotBlank()) onResult(parsed) else busy = false
                        }.addOnFailureListener { busy = false; onError(it.message ?: "OCR failed") }
                        .addOnCompleteListener { proxy.close() }
                }
                try { provider.unbindAll(); provider.bindToLifecycle(lifecycleOwner, androidx.camera.core.CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis) }
                catch (e: Exception) { onError(e.message ?: "Camera unavailable") }
            }, ContextCompat.getMainExecutor(ctx))
            view
        }, modifier = Modifier.fillMaxSize())
    }
}
