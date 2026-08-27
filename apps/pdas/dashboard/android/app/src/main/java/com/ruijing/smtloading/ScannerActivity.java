package com.ruijing.smtloading;

import android.os.Bundle;
import android.content.Intent;
import android.util.Size;
import android.view.ViewGroup;
import android.graphics.Color;
import android.widget.Button;
import android.widget.FrameLayout;
import androidx.camera.core.CameraSelector;
import androidx.camera.core.ImageAnalysis;
import androidx.camera.core.ImageProxy;
import androidx.camera.core.Preview;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.camera.view.PreviewView;
import androidx.activity.ComponentActivity;
import androidx.core.content.ContextCompat;
import com.google.common.util.concurrent.ListenableFuture;
import com.google.mlkit.vision.barcode.BarcodeScanning;
import com.google.mlkit.vision.common.InputImage;
import java.util.concurrent.Executors;

public class ScannerActivity extends ComponentActivity {
    private final java.util.concurrent.ExecutorService executor = Executors.newSingleThreadExecutor();
    private boolean found = false;
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        PreviewView preview = new PreviewView(this);
        preview.setLayoutParams(new FrameLayout.LayoutParams(-1, -1));
        FrameLayout screen = new FrameLayout(this);
        screen.addView(preview);
        Button cancel = new Button(this);
        cancel.setText("取消扫描  /  CANCEL");
        cancel.setTextColor(Color.WHITE);
        cancel.setBackgroundColor(Color.rgb(180, 40, 40));
        FrameLayout.LayoutParams cancelParams = new FrameLayout.LayoutParams(-1, 76);
        cancelParams.gravity = android.view.Gravity.BOTTOM;
        cancelParams.setMargins(24, 0, 24, 28);
        screen.addView(cancel, cancelParams);
        cancel.setOnClickListener(v -> { setResult(RESULT_CANCELED); finish(); });
        setContentView(screen);
        ListenableFuture<ProcessCameraProvider> future = ProcessCameraProvider.getInstance(this);
        future.addListener(() -> {
            try {
                ProcessCameraProvider provider = future.get();
                Preview cameraPreview = new Preview.Builder().build();
                cameraPreview.setSurfaceProvider(preview.getSurfaceProvider());
                ImageAnalysis analysis = new ImageAnalysis.Builder().setTargetResolution(new Size(1280, 720)).setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST).build();
                analysis.setAnalyzer(executor, this::analyze);
                provider.unbindAll();
                provider.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA, cameraPreview, analysis);
            } catch (Exception ignored) { finish(); }
        }, ContextCompat.getMainExecutor(this));
    }
    private void analyze(ImageProxy proxy) {
        if (found || proxy.getImage() == null) { proxy.close(); return; }
        InputImage image = InputImage.fromMediaImage(proxy.getImage(), proxy.getImageInfo().getRotationDegrees());
        BarcodeScanning.getClient().process(image).addOnSuccessListener(codes -> {
            if (!codes.isEmpty() && codes.get(0).getRawValue() != null && !found) {
                found = true;
                Intent result = new Intent(); result.putExtra("scan", codes.get(0).getRawValue()); setResult(RESULT_OK, result); finish();
            }
        }).addOnCompleteListener(task -> proxy.close());
    }
    @Override protected void onDestroy() { executor.shutdown(); super.onDestroy(); }
}
