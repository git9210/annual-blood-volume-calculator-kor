package kr.bloodnote.app;

import android.app.Activity;
import android.app.AlertDialog;
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
import android.text.InputFilter;
import android.text.InputType;
import android.text.TextUtils;
import android.view.View;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.widget.EditText;
import android.widget.LinearLayout;
import java.io.File;
import java.io.IOException;
import java.util.Arrays;
import org.json.JSONObject;

/** Local picker and cancellable isolated PDF worker. Passwords never enter the WebView. */
final class CertificateImporter {
    static final int PICK_PDF = 103;
    private static final int MAX_BYTES = 20_000_000;
    private static final class TooLarge extends IOException {}
    interface Listener { void event(String phase, String json); }
    private final Activity activity;
    private final Listener listener;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private volatile int generation;
    private int attempt;
    private boolean busy, bound, picking, foreground, passwordPending, retryPassword;
    private ParcelFileDescriptor document;
    private ServiceConnection connection;
    private Messenger worker, replies;
    private Runnable timeout;
    private AlertDialog passwordDialog;
    private EditText passwordInput;

    CertificateImporter(Activity activity, Listener listener) {
        this.activity = activity; this.listener = listener;
        File[] stale = activity.getCacheDir().listFiles((dir, name) -> name.startsWith("certificate-") && name.endsWith(".pdf"));
        if (stale != null) for (File file : stale) file.delete();
    }
    void resume() { foreground = true; if (passwordPending) showPassword(); }
    void pause() {
        foreground = false;
        // The system picker must survive its own Activity transition. Once a file
        // has returned, backgrounding cancels reading and clears the password UI.
        if (busy && !picking) { cancel(); listener.event("cancelled", "{}"); }
    }
    void choose() {
        if (busy || !foreground) return;
        if (Build.VERSION.SDK_INT < 35) { error("이 가벼운 PDF 가져오기 기능은 Android 15 이상에서 사용할 수 있습니다. 기존 기록 입력·백업 기능은 그대로 사용할 수 있습니다."); return; }
        busy = true; picking = true; attempt = 0; generation++;
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
        if (!busy || !picking) return;
        picking = false;
        if (uri == null || !"content".equals(uri.getScheme())) { cancel(); listener.event("cancelled", "{}"); return; }
        int job = generation;
        listener.event("reading", "{}"); armTimeout();
        new Thread(() -> openAndBind(uri, job), "certificate-open").start();
    }
    private void armTimeout() {
        stopTimeout();
        int job = generation;
        timeout = () -> { if (job == generation && busy) error("PDF 읽기에 시간이 오래 걸려 중단했습니다. 기기에 저장한 원본 PDF를 다시 선택해 주세요."); };
        ui.postDelayed(timeout, 120000);
    }
    private void stopTimeout() { if (timeout != null) ui.removeCallbacks(timeout); timeout = null; }
    private void openAndBind(Uri uri, int job) {
        android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_BACKGROUND);
        ParcelFileDescriptor descriptor = null;
        try {
            descriptor = activity.getContentResolver().openFileDescriptor(uri, "r");
            if (descriptor == null) throw new IOException();
            // Seek the original local file; never write a plaintext PDF cache.
            long size = android.system.Os.lseek(descriptor.getFileDescriptor(), 0, android.system.OsConstants.SEEK_END);
            if (size > MAX_BYTES) throw new TooLarge();
            if (size < 5) throw new IOException();
            android.system.Os.lseek(descriptor.getFileDescriptor(), 0, android.system.OsConstants.SEEK_SET);
            final ParcelFileDescriptor ready = descriptor; descriptor = null;
            ui.post(() -> { if (job != generation || !busy) close(ready); else bind(ready, job); });
        } catch (Exception failure) {
            close(descriptor);
            final String message = failure instanceof TooLarge ? "20MB 이하의 헌혈증명서 PDF를 선택해 주세요." : "기기의 PDF를 읽지 못했습니다. 다운로드 폴더에 저장한 파일을 선택해 주세요.";
            ui.post(() -> { if (job == generation && busy) error(message); });
        }
    }
    private static void close(ParcelFileDescriptor descriptor) {
        if (descriptor != null) try { descriptor.close(); } catch (IOException ignored) {}
    }
    private void bind(ParcelFileDescriptor descriptor, int job) {
        document = descriptor;
        replies = new Messenger(new Handler(Looper.getMainLooper(), message -> {
            if (!busy || message.arg1 != generation || message.arg2 != attempt) return true;
            String payload = message.getData().getString("payload", "");
            if (message.what == CertificateService.PROGRESS) listener.event("progress", payload);
            else if (message.what == CertificateService.DONE) { cleanup(); listener.event("ready", payload); }
            else if (message.what == CertificateService.ERROR) error(payload);
            else if (message.what == CertificateService.PASSWORD_REQUIRED) {
                stopTimeout(); passwordPending = true; retryPassword = attempt > 1;
                listener.event("password", "{}"); showPassword();
            }
            return true;
        }));
        connection = new ServiceConnection() {
            @Override public void onServiceConnected(ComponentName name, IBinder binder) {
                if (job != generation || !busy) return;
                worker = new Messenger(binder); read(null);
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
    private void read(char[] password) {
        Bundle data = new Bundle();
        try {
            if (!busy || document == null || worker == null) return;
            android.system.Os.lseek(document.getFileDescriptor(), 0, android.system.OsConstants.SEEK_SET);
            try (ParcelFileDescriptor fd = ParcelFileDescriptor.dup(document.getFileDescriptor())) {
                Message request = Message.obtain(null, CertificateService.READ);
                request.arg1 = generation; request.arg2 = ++attempt; request.replyTo = replies;
                data.putParcelable("pdf", fd);
                if (password != null) data.putCharArray("password", password);
                request.setData(data); armTimeout();
                listener.event("reading", "{}"); worker.send(request);
            }
        } catch (Exception failure) { error("PDF 읽기를 시작하지 못했습니다. 다시 선택해 주세요."); }
        finally { data.remove("password"); if (password != null) Arrays.fill(password, '\0'); }
    }
    private void showPassword() {
        if (!busy || !foreground || !passwordPending || passwordDialog != null) return;
        final int job = generation;
        final EditText input = new EditText(activity);
        input.setSingleLine(true);
        input.setHint("PDF 암호");
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        input.setSaveEnabled(false); input.setFreezesText(false);
        input.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
        input.setImeOptions(EditorInfo.IME_ACTION_DONE | EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING | EditorInfo.IME_FLAG_NO_EXTRACT_UI);
        input.setFilters(new InputFilter[]{new InputFilter.LengthFilter(128)});
        LinearLayout layout = new LinearLayout(activity);
        int pad = (int) (24 * activity.getResources().getDisplayMetrics().density);
        layout.setPadding(pad, 0, pad, 0);
        layout.addView(input, new LinearLayout.LayoutParams(-1, -2));
        final AlertDialog prompt = new AlertDialog.Builder(activity)
            .setTitle(retryPassword ? "PDF 암호를 다시 확인해 주세요" : "암호가 설정된 PDF입니다")
            .setMessage((retryPassword ? "암호가 맞지 않거나 지원하지 않는 PDF 암호화 방식입니다.\n\n" : "")
                + "증명서 발급 안내에 따라 암호를 입력해 주세요. 암호는 이번 가져오기에만 사용하며 저장하거나 전송하지 않습니다.")
            .setView(layout).setPositiveButton("열기", null).setNegativeButton("취소", (d, which) -> cancelPassword(job)).create();
        passwordInput = input; passwordDialog = prompt;
        prompt.setOnCancelListener(d -> cancelPassword(job));
        prompt.setOnDismissListener(d -> {
            input.getText().clear();
            if (passwordDialog == prompt) { passwordDialog = null; passwordInput = null; cancelPassword(job); }
        });
        prompt.setCanceledOnTouchOutside(true);
        if (prompt.getWindow() != null) prompt.getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        prompt.show();
        if (prompt.getWindow() != null) prompt.getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        Runnable submit = () -> {
            if (job != generation || !busy || !foreground || passwordDialog != prompt) return;
            int length = input.length();
            if (length == 0) { input.setError("PDF 암호를 입력해 주세요."); return; }
            char[] password = new char[length];
            TextUtils.getChars(input.getText(), 0, length, password, 0);
            input.getText().clear(); passwordPending = false;
            clearPasswordDialog(); read(password);
        };
        prompt.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> submit.run());
        input.setOnEditorActionListener((v, action, event) -> { if (action == EditorInfo.IME_ACTION_DONE) { submit.run(); return true; } return false; });
        input.requestFocus();
    }
    private void cancelPassword(int job) { if (busy && generation == job) { cancel(); listener.event("cancelled", "{}"); } }
    private void clearPasswordDialog() {
        AlertDialog previous = passwordDialog; passwordDialog = null;
        if (passwordInput != null) passwordInput.getText().clear(); passwordInput = null;
        if (previous != null) previous.dismiss();
    }
    private void error(String message) { cleanup(); listener.event("error", "{\"message\":" + JSONObject.quote(message) + "}"); }
    void cancel() { generation++; cleanup(); }
    private void cleanup() {
        busy = false; picking = false; passwordPending = false; retryPassword = false;
        stopTimeout(); clearPasswordDialog();
        if (bound && connection != null) { try { activity.unbindService(connection); } catch (IllegalArgumentException ignored) {} }
        bound = false; connection = null; worker = null; replies = null;
        close(document); document = null;
    }
}
