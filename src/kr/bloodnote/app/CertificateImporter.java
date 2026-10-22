package kr.bloodnote.app;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.Message;
import android.os.Messenger;
import android.os.ParcelFileDescriptor;
import java.io.File;
import java.io.IOException;
import org.json.JSONObject;

/** Local document picker and bounded, cancellable bridge to the isolated PDF worker. */
final class CertificateImporter {
    static final int PICK_PDF = 103;
    private static final int MAX_BYTES = 20_000_000;
    interface Listener { void event(String phase, String json); }
    private final Activity activity;
    private final Listener listener;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private volatile int generation;
    private boolean busy, bound;
    private ParcelFileDescriptor document;
    private ServiceConnection connection;
    private Runnable timeout;
    CertificateImporter(Activity activity, Listener listener) {
        this.activity = activity; this.listener = listener;
        File[] stale = activity.getCacheDir().listFiles((dir, name) -> name.startsWith("certificate-") && name.endsWith(".pdf"));
        if (stale != null) for (File file : stale) file.delete();
    }
    void choose() {
        if (busy) return;
        if (Build.VERSION.SDK_INT < 35) { error("이 가벼운 PDF 가져오기 기능은 Android 15 이상에서 사용할 수 있습니다. 기존 기록 입력·백업 기능은 그대로 사용할 수 있습니다."); return; }
        busy = true; generation++;
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/pdf");
        intent.putExtra(Intent.EXTRA_LOCAL_ONLY, true);
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, false);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        try { activity.startActivityForResult(intent, PICK_PDF); }
        catch (ActivityNotFoundException error) { error("PDF를 선택할 파일 앱을 찾을 수 없습니다."); }
    }
    void selected(Uri uri) {
        if (!busy) return;
        if (uri == null || !"content".equals(uri.getScheme())) { cancel(); listener.event("cancelled", "{}"); return; }
        int job = generation;
        listener.event("reading", "{}");
        timeout = () -> { if (job == generation && busy) error("PDF 읽기에 시간이 오래 걸려 중단했습니다. 기기에 저장한 원본 PDF를 다시 선택해 주세요."); };
        ui.postDelayed(timeout, 120000);
        new Thread(() -> openAndBind(uri, job), "certificate-open").start();
    }
    private void openAndBind(Uri uri, int job) {
        android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_BACKGROUND);
        ParcelFileDescriptor descriptor = null;
        try {
            descriptor = activity.getContentResolver().openFileDescriptor(uri, "r");
            if (descriptor == null) throw new IOException();
            // Read the original local file directly; never create a plaintext PDF cache.
            long size = android.system.Os.lseek(descriptor.getFileDescriptor(), 0, android.system.OsConstants.SEEK_END);
            if (size > MAX_BYTES) throw new IllegalArgumentException("20MB 이하의 헌혈증명서 PDF를 선택해 주세요.");
            if (size < 5) throw new IOException();
            android.system.Os.lseek(descriptor.getFileDescriptor(), 0, android.system.OsConstants.SEEK_SET);
            final ParcelFileDescriptor ready = descriptor;
            descriptor = null;
            ui.post(() -> { if (job != generation || !busy) close(ready); else bind(ready, job); });
        } catch (Exception failure) {
            close(descriptor);
            final String message = failure instanceof IllegalArgumentException ? failure.getMessage() : "기기의 PDF를 읽지 못했습니다. 다운로드 폴더에 저장한 파일을 선택해 주세요.";
            ui.post(() -> { if (job == generation && busy) error(message); });
        }
    }
    private static void close(ParcelFileDescriptor descriptor) {
        if (descriptor != null) try { descriptor.close(); } catch (IOException ignored) {}
    }
    private void bind(ParcelFileDescriptor descriptor, int job) {
        document = descriptor;
        Messenger replies = new Messenger(new Handler(Looper.getMainLooper(), message -> {
            if (!busy || message.arg1 != generation) return true;
            String payload = message.getData().getString("payload", "");
            if (message.what == CertificateService.PROGRESS) listener.event("progress", payload);
            else if (message.what == CertificateService.DONE) { cleanup(); listener.event("ready", payload); }
            else if (message.what == CertificateService.ERROR) error(payload);
            return true;
        }));
        connection = new ServiceConnection() {
            @Override public void onServiceConnected(ComponentName name, IBinder binder) {
                if (job != generation || !busy) return;
                try (ParcelFileDescriptor fd = ParcelFileDescriptor.dup(descriptor.getFileDescriptor())) {
                    Message request = Message.obtain(null, CertificateService.READ);
                    request.arg1 = job; request.replyTo = replies;
                    Bundle data = new Bundle(); data.putParcelable("pdf", fd); request.setData(data);
                    new Messenger(binder).send(request);
                    close(document); document = null;
                } catch (Exception failure) { error("PDF 읽기를 시작하지 못했습니다. 다시 선택해 주세요."); }
            }
            @Override public void onServiceDisconnected(ComponentName name) {
                if (job == generation && busy) error("PDF 읽기가 중단되었습니다. 기록은 변경되지 않았습니다.");
            }
            @Override public void onNullBinding(ComponentName name) { if (job == generation && busy) error("PDF 읽기를 시작하지 못했습니다."); }
            @Override public void onBindingDied(ComponentName name) { if (job == generation && busy) error("PDF 읽기가 중단되었습니다. 다시 선택해 주세요."); }
        };
        try {
            bound = activity.bindService(new Intent(activity, CertificateService.class), connection, Context.BIND_AUTO_CREATE);
            if (!bound) error("PDF 읽기를 시작하지 못했습니다.");
        } catch (RuntimeException failure) { error("PDF 읽기를 시작하지 못했습니다."); }
    }
    private void error(String message) { cleanup(); listener.event("error", "{\"message\":" + JSONObject.quote(message) + "}"); }
    void cancel() { generation++; cleanup(); }
    private void cleanup() {
        busy = false;
        if (timeout != null) ui.removeCallbacks(timeout);
        timeout = null;
        if (bound && connection != null) { try { activity.unbindService(connection); } catch (IllegalArgumentException ignored) {} }
        bound = false; connection = null;
        close(document); document = null;
    }
}
