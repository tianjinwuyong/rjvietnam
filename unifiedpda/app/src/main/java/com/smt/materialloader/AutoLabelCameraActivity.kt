package com.smt.materialloader

import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.util.TypedValue
import android.view.Gravity
import android.widget.Button
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import java.io.File

class AutoLabelCameraActivity : ComponentActivity() {
    private var capture: ImageCapture? = null
    private var done = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = FrameLayout(this)
        val preview = PreviewView(this)
        root.addView(preview, FrameLayout.LayoutParams(-1, -1))
        val shutter = Button(this).apply {
            text = "拍照并发送"
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 22f)
            background = GradientDrawable().apply {
                cornerRadius = dp(22).toFloat()
                setColor(Color.rgb(0, 121, 107))
            }
            isEnabled = false
            setOnClickListener { take() }
        }
        root.addView(shutter, FrameLayout.LayoutParams(-1, dp(72)).apply {
            gravity = Gravity.BOTTOM
            setMargins(dp(24), 0, dp(24), dp(28))
        })
        setContentView(root)
        start(preview) { shutter.isEnabled = true }
    }

    private fun start(view: PreviewView, onReady: () -> Unit) {
        val future = ProcessCameraProvider.getInstance(this)
        future.addListener({
            val provider = future.get()
            val preview = Preview.Builder().build().also { it.setSurfaceProvider(view.surfaceProvider) }
            capture = ImageCapture.Builder()
                .setCaptureMode(ImageCapture.CAPTURE_MODE_MAXIMIZE_QUALITY)
                .setJpegQuality(95)
                .build()
            provider.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA, preview, capture!!)
            onReady()
        }, ContextCompat.getMainExecutor(this))
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    private fun take() {
        if (done) return
        val file = File(cacheDir, "receiving-label-${System.currentTimeMillis()}.jpg")
        val options = ImageCapture.OutputFileOptions.Builder(file).build()
        capture?.takePicture(options, ContextCompat.getMainExecutor(this), object : ImageCapture.OnImageSavedCallback {
            override fun onImageSaved(result: ImageCapture.OutputFileResults) {
                done = true
                setResult(RESULT_OK, Intent().putExtra("imagePath", file.absolutePath))
                finish()
            }

            override fun onError(exception: ImageCaptureException) {
                setResult(RESULT_CANCELED)
                finish()
            }
        })
    }
}
