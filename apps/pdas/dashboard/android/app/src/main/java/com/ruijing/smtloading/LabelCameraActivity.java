package com.ruijing.smtloading;

import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.FrameLayout;
import androidx.camera.core.CameraSelector;
import androidx.camera.core.ImageAnalysis;
import androidx.camera.core.ImageCapture;
import androidx.camera.core.ImageCaptureException;
import androidx.camera.core.ImageProxy;
import androidx.camera.core.Preview;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.camera.view.PreviewView;
import androidx.activity.ComponentActivity;
import androidx.core.content.ContextCompat;
import com.google.common.util.concurrent.ListenableFuture;
import java.io.File;
import java.util.concurrent.Executors;

/** Auto-capture label camera: waits for a bright, stable, detailed frame. */
public class LabelCameraActivity extends ComponentActivity {
    private final java.util.concurrent.ExecutorService executor = Executors.newSingleThreadExecutor();
    private ImageCapture imageCapture;
    private volatile boolean captured = false;
    private double previousLuma = -1;
    private int stableFrames = 0;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        PreviewView preview = new PreviewView(this);
        FrameLayout screen = new FrameLayout(this);
        screen.addView(preview, new FrameLayout.LayoutParams(-1, -1));
        Button manual = new Button(this);
        manual.setText("CAPTURE NOW / 立即拍照");
        manual.setTextSize(18);
        manual.setTextColor(Color.WHITE);
        manual.setBackgroundColor(Color.rgb(20, 120, 170));
        FrameLayout.LayoutParams manualParams = new FrameLayout.LayoutParams(-1, 82);
        manualParams.gravity = Gravity.BOTTOM;
        manualParams.setMargins(24, 0, 24, 112);
        screen.addView(manual, manualParams);
        Button cancel = new Button(this);
        cancel.setText("CANCEL / 取消");
        FrameLayout.LayoutParams cancelParams = new FrameLayout.LayoutParams(-1, 76);
        cancelParams.gravity = Gravity.BOTTOM;
        cancelParams.setMargins(24, 0, 24, 24);
        screen.addView(cancel, cancelParams);
        manual.setOnClickListener(v -> takePicture());
        cancel.setOnClickListener(v -> { setResult(RESULT_CANCELED); finish(); });
        setContentView(screen);

        ListenableFuture<ProcessCameraProvider> future = ProcessCameraProvider.getInstance(this);
        future.addListener(() -> {
            try {
                ProcessCameraProvider provider = future.get();
                Preview cameraPreview = new Preview.Builder().build();
                cameraPreview.setSurfaceProvider(preview.getSurfaceProvider());
                imageCapture = new ImageCapture.Builder().setCaptureMode(ImageCapture.CAPTURE_MODE_MAXIMIZE_QUALITY).build();
                ImageAnalysis analysis = new ImageAnalysis.Builder().setTargetResolution(new android.util.Size(1280, 720)).setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST).build();
                analysis.setAnalyzer(executor, this::analyzeFrame);
                provider.unbindAll();
                provider.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA, cameraPreview, imageCapture, analysis);
            } catch (Exception ignored) { setResult(RESULT_CANCELED); finish(); }
        }, ContextCompat.getMainExecutor(this));
    }

    private void analyzeFrame(ImageProxy proxy) {
        if (captured || proxy.getPlanes().length == 0) { proxy.close(); return; }
        java.nio.ByteBuffer buffer = proxy.getPlanes()[0].getBuffer();
        int sampleCount = 0; long sum = 0; long sumSq = 0;
        while (buffer.hasRemaining() && sampleCount < 12000) { int y = buffer.get() & 0xff; sum += y; sumSq += (long)y * y; sampleCount++; }
        double luma = sampleCount == 0 ? 0 : (double)sum / sampleCount;
        double variance = sampleCount == 0 ? 0 : (double)sumSq / sampleCount - luma * luma;
        boolean stable = previousLuma >= 0 && Math.abs(luma - previousLuma) < 4.5;
        stableFrames = stable ? stableFrames + 1 : 0;
        previousLuma = luma;
        proxy.close();
        // Reject dark, blown-out, or nearly blank frames; capture after ~0.5s steady.
        if (!captured && stableFrames >= 8 && luma >= 45 && luma <= 220 && variance >= 180) runOnUiThread(this::takePicture);
    }

    private void takePicture() {
        if (captured || imageCapture == null) return;
        captured = true;
        File file = new File(getCacheDir(), "wms-label-" + System.currentTimeMillis() + ".jpg");
        ImageCapture.OutputFileOptions options = new ImageCapture.OutputFileOptions.Builder(file).build();
        imageCapture.takePicture(options, ContextCompat.getMainExecutor(this), new ImageCapture.OnImageSavedCallback() {
            @Override public void onImageSaved(ImageCapture.OutputFileResults result) { Intent data = new Intent(); data.putExtra("imagePath", file.getAbsolutePath()); setResult(RESULT_OK, data); finish(); }
            @Override public void onError(ImageCaptureException error) { captured = false; Intent failed = new Intent(); failed.putExtra("cameraError", error.getMessage() == null ? "capture failed" : error.getMessage()); setResult(RESULT_CANCELED, failed); finish(); }
        });
    }

    @Override protected void onDestroy() { executor.shutdown(); super.onDestroy(); }
}
