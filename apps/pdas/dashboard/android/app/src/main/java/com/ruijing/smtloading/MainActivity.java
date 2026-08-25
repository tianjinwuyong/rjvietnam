package com.ruijing.smtloading;

import android.app.Activity;
import android.Manifest;
import android.content.pm.PackageManager;
import android.content.Intent;
import android.provider.MediaStore;
import android.webkit.JavascriptInterface;
import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebChromeClient;
import android.webkit.PermissionRequest;

public class MainActivity extends Activity {
    private WebView page;
    public class CameraBridge {
        @JavascriptInterface
        public void openCamera() {
            startScanner();
        }
        @JavascriptInterface
        public void startScanner() {
            MainActivity.this.startScanner();
        }
    }
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.CAMERA}, 1001);
        }
        WebView webView = new WebView(this);
        page = webView;
        webView.addJavascriptInterface(new CameraBridge(), "AndroidCamera");
        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> request.grant(request.getResources()));
            }
        });
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowFileAccessFromFileURLs(true);
        settings.setAllowUniversalAccessFromFileURLs(true);
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        webView.clearCache(true);
        webView.loadUrl("file:///android_asset/index.html?build=wo-selection-2");
        setContentView(webView);
    }
    public void startScanner() { startActivityForResult(new Intent(this, ScannerActivity.class), 2001); }
    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == 2001 && resultCode == RESULT_OK && data != null && page != null) {
            String value = data.getStringExtra("scan");
            page.evaluateJavascript("window.receiveNativeScan(" + org.json.JSONObject.quote(value == null ? "" : value) + ")", null);
        }
    }
}
