package com.smt.materialloader

import android.annotation.SuppressLint
import android.app.Activity
import android.Manifest
import android.content.pm.PackageManager
import android.content.Intent
import android.os.Bundle
import android.view.ViewGroup
import android.webkit.WebChromeClient
import android.webkit.PermissionRequest
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.JavascriptInterface
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

/** Unified PDA web shell. The dashboard web app is the sole SMT loading UI. */
class TempSmtLoadingActivity : Activity() {
    private lateinit var webView: WebView
    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        title = "Unified Management Application"
        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.CAMERA), 1001)
        }

        webView = WebView(this).apply {
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            // Always fetch the current unified PDA bundle while the factory
            // dashboard is being iterated; this prevents an older cached
            // management-system page from reappearing after navigation.
            settings.cacheMode = WebSettings.LOAD_NO_CACHE
            settings.loadWithOverviewMode = true
            settings.useWideViewPort = true
            addJavascriptInterface(CameraBridge(), "AndroidCamera")
            webChromeClient = object : WebChromeClient() {
                override fun onPermissionRequest(request: PermissionRequest) {
                    runOnUiThread {
                        val cameraRequested = request.resources.contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE)
                        if (cameraRequested && checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                            request.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE))
                        } else {
                            request.deny()
                        }
                    }
                }
            }
            webViewClient = object : WebViewClient() {
                override fun onReceivedError(
                    view: WebView,
                    request: WebResourceRequest,
                    error: WebResourceError
                ) {
                    if (request.isForMainFrame) showUnavailable(view)
                }
            }
        }
        setContentView(wrapWithBackoutBar(webView))
        val requestedUrl = intent.getStringExtra(EXTRA_PAGE_URL).orEmpty()
        webView.loadUrl(if (requestedUrl.startsWith(ALLOWED_MES_ORIGIN)) requestedUrl else PAGE_URL + "?app=unified-pda")
    }

    /**
     * The loaded page is a full-screen web dashboard with no native chrome of
     * its own — wrap it with a slim top bar so there is always a way out
     * (back to the PDA login screen) no matter which web page is showing.
     */
    private fun wrapWithBackoutBar(content: WebView): LinearLayout {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        }
        val bar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setBackgroundColor(0xFF0B1822.toInt())
            setPadding(24, 16, 24, 16)
        }
        val title = TextView(this).apply {
            text = "统一 PDA"
            setTextColor(0xFFFFFFFF.toInt())
            textSize = 15f
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        }
        val logout = Button(this).apply {
            text = "退出"
            setOnClickListener {
                try {
                    MaterialLoaderApp.instance.authRepository.logout()
                } catch (_: Exception) {
                }
                val intent = Intent(this@TempSmtLoadingActivity, MainActivity::class.java)
                intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_NEW_TASK)
                startActivity(intent)
                finish()
            }
        }
        bar.addView(title)
        bar.addView(logout)
        root.addView(bar)
        root.addView(content, LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f
        ))
        return root
    }

    inner class CameraBridge {
        @JavascriptInterface
        fun startScanner() {
            runOnUiThread {
                startActivityForResult(Intent(this@TempSmtLoadingActivity, NativeQrScannerActivity::class.java), SCAN_REQUEST)
            }
        }
    }

    @Deprecated("Legacy activity result is sufficient for the temporary PDA wrapper")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == SCAN_REQUEST && resultCode == RESULT_OK) {
            val value = data?.getStringExtra(NativeQrScannerActivity.EXTRA_SCAN_VALUE).orEmpty()
            val quoted = org.json.JSONObject.quote(value)
            webView.evaluateJavascript("window.receiveNativeScan && window.receiveNativeScan($quoted)", null)
        }
    }

    private fun showUnavailable(webView: WebView) {
        val message = TextView(this).apply {
            text = "统一 PDA 网页暂时无法连接\\n\\n请确认设备与 MES 网页服务器在同一网络，且 Dashboard 正在运行。"
            textSize = 18f
            setPadding(40, 80, 40, 40)
        }
        setContentView(message)
    }

    companion object {
        private const val SCAN_REQUEST = 2001
        const val EXTRA_PAGE_URL = "extra_page_url"
        private const val ALLOWED_MES_ORIGIN = "http://192.168.6.155:5178/"
        // Use the factory computer address so both physical phones and MuMu
        // can reach the PDA dashboard on the local network.
        private const val PAGE_URL = "http://192.168.6.155:5180/"
    }
}
