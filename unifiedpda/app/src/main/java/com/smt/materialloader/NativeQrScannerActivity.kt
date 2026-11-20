package com.smt.materialloader

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import com.smt.materialloader.ui.components.BarcodeScanner

class NativeQrScannerActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            Box(Modifier.fillMaxSize().background(Color.Black)) {
                BarcodeScanner(
                    onBarcodeDetected = { value ->
                        setResult(Activity.RESULT_OK, Intent().putExtra(EXTRA_SCAN_VALUE, value))
                        finish()
                    },
                    onError = { }
                )
            }
        }
    }

    companion object {
        const val EXTRA_SCAN_VALUE = "scan_value"
    }
}
