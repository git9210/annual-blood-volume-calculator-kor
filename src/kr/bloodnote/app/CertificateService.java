package kr.bloodnote.app;

import android.app.Service;
import android.content.Intent;
import android.graphics.pdf.PdfRenderer;
import android.graphics.pdf.content.PdfPageTextContent;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.Message;
import android.os.Messenger;
import android.os.ParcelFileDescriptor;
import android.os.RemoteException;
import java.io.IOException;

/** One-shot isolated process: no network permission and no access to app records. */
public final class CertificateService extends Service {
    static final int READ = 1, PROGRESS = 2, DONE = 3, ERROR = 4;
    private boolean started;
    private Thread worker;
    private final Messenger endpoint = new Messenger(new Handler(Looper.getMainLooper(), message -> {
        if (message.what != READ || started) return true;
        started = true;
        final ParcelFileDescriptor input = message.getData().getParcelable("pdf");
        final Messenger reply = message.replyTo;
        final int job = message.arg1;
        worker = new Thread(() -> read(input, reply, job), "certificate-reader");
        worker.start();
        return true;
    }));
    @Override public IBinder onBind(Intent intent) { return endpoint.getBinder(); }
    private void read(ParcelFileDescriptor input, Messenger reply, int job) {
        android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_BACKGROUND);
        if (input == null) { send(reply, ERROR, job, "PDF를 열지 못했습니다."); return; }
        try (ParcelFileDescriptor descriptor = input; PdfRenderer pdf = new PdfRenderer(descriptor)) {
            CertificateParser parser = new CertificateParser(pdf.getPageCount());
            for (int i = 0; i < pdf.getPageCount(); i++) {
                if (Thread.currentThread().isInterrupted()) return;
                try (PdfRenderer.Page page = pdf.openPage(i)) {
                    StringBuilder text = new StringBuilder();
                    for (PdfPageTextContent block : page.getTextContents()) {
                        String part = block.getText();
                        if (text.length() + part.length() + 1 > CertificateParser.MAX_PAGE_CHARS)
                            throw new IllegalArgumentException("한 쪽의 내용이 너무 많습니다. 일반 헌혈증명서 PDF를 선택해 주세요.");
                        text.append(part).append('\n');
                    }
                    parser.accept(text.toString(), i + 1);
                }
                if (i == 0 || (i + 1) % 5 == 0 || i + 1 == pdf.getPageCount())
                    send(reply, PROGRESS, job, "{\"done\":" + (i + 1) + ",\"total\":" + pdf.getPageCount() + "}");
            }
            send(reply, DONE, job, parser.finishJson());
        } catch (SecurityException error) {
            send(reply, ERROR, job, "비밀번호가 걸린 PDF는 읽을 수 없습니다. 잠금 없는 증명서 PDF를 선택해 주세요.");
        } catch (IllegalArgumentException error) {
            send(reply, ERROR, job, error.getMessage() == null ? "증명서 양식을 확인하지 못했습니다." : error.getMessage());
        } catch (IOException | RuntimeException error) {
            send(reply, ERROR, job, "PDF를 읽지 못했습니다. 손상되지 않은 헌혈증명서 원본을 선택해 주세요.");
        }
    }
    private static void send(Messenger target, int kind, int job, String payload) {
        if (target == null) return;
        Message message = Message.obtain(null, kind);
        message.arg1 = job;
        Bundle data = new Bundle(); data.putString("payload", payload); message.setData(data);
        try { target.send(message); } catch (RemoteException ignored) {}
    }
    @Override public void onDestroy() {
        if (worker != null) worker.interrupt();
        super.onDestroy();
        // This private isolated process is only used for one import. Release PDF/native memory now.
        android.os.Process.killProcess(android.os.Process.myPid());
    }
}
