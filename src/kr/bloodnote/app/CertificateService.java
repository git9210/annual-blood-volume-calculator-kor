package kr.bloodnote.app;

import android.app.Service;
import android.content.Intent;
import android.graphics.pdf.LoadParams;
import android.graphics.pdf.PdfRenderer;
import android.graphics.pdf.content.PdfPageTextContent;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.Message;
import android.os.Messenger;
import android.os.ParcelFileDescriptor;
import android.os.RemoteException;
import android.os.Bundle;
import java.io.IOException;
import java.util.Arrays;
import java.util.concurrent.atomic.AtomicBoolean;

/** Isolated process: no network or app records. Retried passwords live only in RAM. */
public final class CertificateService extends Service {
    static final int READ = 1, PROGRESS = 2, DONE = 3, ERROR = 4, PASSWORD_REQUIRED = 5;
    private final AtomicBoolean reading = new AtomicBoolean();
    private Thread worker;
    private final Messenger endpoint = new Messenger(new Handler(Looper.getMainLooper(), message -> {
        if (message.what != READ) return true;
        Bundle data = message.getData();
        final ParcelFileDescriptor input = data.getParcelable("pdf");
        final char[] password = data.getCharArray("password"); data.remove("password");
        if (!reading.compareAndSet(false, true)) {
            if (password != null) Arrays.fill(password, '\0');
            if (input != null) try { input.close(); } catch (IOException ignored) {}
            return true;
        }
        final Messenger reply = message.replyTo;
        final int job = message.arg1, attempt = message.arg2;
        worker = new Thread(() -> read(input, password, reply, job, attempt), "certificate-reader");
        worker.start(); return true;
    }));
    @Override public IBinder onBind(Intent intent) { return endpoint.getBinder(); }
    private static PdfRenderer open(ParcelFileDescriptor input, char[] password) throws IOException {
        try {
            // Android's API requires a String. It is never retained in app state,
            // logged, persisted or sent outside this isolated local process.
            return password == null ? new PdfRenderer(input) : new PdfRenderer(input,
                new LoadParams.Builder().setPassword(new String(password)).build());
        } finally { if (password != null) Arrays.fill(password, '\0'); }
    }
    private void read(ParcelFileDescriptor input, char[] password, Messenger reply, int job, int attempt) {
        android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_BACKGROUND);
        int result = ERROR;
        String payload = "PDF를 읽지 못했습니다. 손상되지 않은 헌혈증명서 원본을 선택해 주세요.";
        try (ParcelFileDescriptor descriptor = input; PdfRenderer pdf = open(descriptor, password)) {
            CertificateParser parser = new CertificateParser(pdf.getPageCount());
            for (int i = 0; i < pdf.getPageCount(); i++) {
                if (Thread.currentThread().isInterrupted()) return;
                try (PdfRenderer.Page page = pdf.openPage(i)) {
                    StringBuilder text = new StringBuilder();
                    for (PdfPageTextContent block : page.getTextContents()) {
                        String part = block.getText();
                        if (text.length() + part.length() + 1 > CertificateParser.MAX_PAGE_CHARS)
                            throw new CertificateParser.FormatException("한 쪽의 내용이 너무 많습니다. 일반 헌혈증명서 PDF를 선택해 주세요.");
                        text.append(part).append('\n');
                    }
                    parser.accept(text.toString(), i + 1);
                }
                if (i == 0 || (i + 1) % 5 == 0 || i + 1 == pdf.getPageCount())
                    send(reply, PROGRESS, job, attempt, "{\"done\":" + (i + 1) + ",\"total\":" + pdf.getPageCount() + "}");
            }
            payload = parser.finishJson(); result = DONE;
        } catch (SecurityException error) {
            result = PASSWORD_REQUIRED; payload = "{}";
        } catch (CertificateParser.FormatException error) {
            payload = error.getMessage() == null ? "증명서 양식을 확인하지 못했습니다." : error.getMessage();
        } catch (IOException | RuntimeException error) {
            // Use a fixed message; never expose PDF content or a password in logs/errors.
        } finally {
            if (password != null) Arrays.fill(password, '\0');
            reading.set(false);
        }
        // Resources and read lock are released before a retry can reach the worker.
        send(reply, result, job, attempt, payload);
    }
    private static void send(Messenger target, int kind, int job, int attempt, String payload) {
        if (target == null) return;
        Message message = Message.obtain(null, kind); message.arg1 = job; message.arg2 = attempt;
        Bundle data = new Bundle(); data.putString("payload", payload); message.setData(data);
        try { target.send(message); } catch (RemoteException ignored) {}
    }
    @Override public void onDestroy() {
        if (worker != null) worker.interrupt();
        super.onDestroy();
        android.os.Process.killProcess(android.os.Process.myPid());
    }
}
