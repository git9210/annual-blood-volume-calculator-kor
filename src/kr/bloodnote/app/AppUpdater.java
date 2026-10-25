package kr.bloodnote.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.ProgressDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import java.io.IOException;
import java.io.InputStream;
import java.net.URL;
import java.util.Locale;
import java.util.function.BooleanSupplier;
import javax.net.ssl.HttpsURLConnection;
import org.json.JSONArray;
import org.json.JSONObject;

/** Manual metadata check. The user downloads/installs from an external browser. */
final class AppUpdater {
    static final String DISCLOSURE = "이번 한 번 GitHub에 연결해 새 버전과 APK 용량을 확인합니다. 데이터 요금이 발생할 수 있습니다.\n\n"
        + "헌혈 기록·계획·PDF·백업·암호는 보내지 않습니다. GitHub에는 접속 IP 등 일반적인 통신 정보가 전달됩니다. 앱 시작 시나 백그라운드에서는 자동으로 확인하지 않습니다.\n\n"
        + "새 버전이 있으면 별도 선택 후 기본 브라우저로 배포 페이지를 엽니다. APK 다운로드와 설치는 브라우저와 Android에서 직접 진행합니다. 이 앱은 APK를 내려받거나 설치 권한을 요청하지 않습니다.\n\n"
        + "기기의 보안 설정·앱 설치 제한·OS 정책 등에 따라 업데이트가 완료되지 않을 수 있습니다. 개인이 제작한 비공식 앱이며, 사용·설치·업데이트는 이용자 본인의 판단과 책임으로 진행해 주세요. 중요한 기록은 먼저 백업해 주세요.";
    private final Activity activity;
    private final BooleanSupplier active;
    private AlertDialog dialog;
    private Task task;

    private static final class UpdateError extends IOException { UpdateError(String message) { super(message); } }
    private static final class Task {
        volatile boolean cancelled;
        volatile HttpsURLConnection connection;
        Thread thread;
    }
    private static final class Release {
        final String version, page;
        final long size;
        Release(String tag, long size) {
            this.version = UpdatePolicy.version(tag); this.page = UpdatePolicy.releasePage(tag); this.size = size;
        }
    }

    AppUpdater(Activity activity, BooleanSupplier active) {
        this.activity = activity; this.active = active;
        UpdatePolicy.clearLegacyCache(activity.getCacheDir());
    }

    void request() {
        if (!active.getAsBoolean() || task != null || dialog != null) return;
        show(new AlertDialog.Builder(activity).setTitle("업데이트 확인에 인터넷을 사용할까요?")
            .setMessage(DISCLOSURE).setNegativeButton("취소", null)
            .setPositiveButton("안내 확인 · 이번만 연결", (d, w) -> { if (dialog == d) check(); }).create());
    }

    private void show(AlertDialog next) {
        dismiss(); dialog = next;
        next.setOnDismissListener(d -> { if (dialog == next) dialog = null; });
        if (active.getAsBoolean()) next.show(); else dialog = null;
    }
    private void dismiss() { AlertDialog old = dialog; dialog = null; if (old != null) old.dismiss(); }
    private void notice(String title, String message) {
        if (active.getAsBoolean()) show(new AlertDialog.Builder(activity).setTitle(title).setMessage(message).setPositiveButton("확인", null).create());
    }
    private void progress() {
        ProgressDialog next = new ProgressDialog(activity);
        next.setTitle("GitHub 새 버전 확인"); next.setMessage("잠시 기다려 주세요."); next.setIndeterminate(true);
        next.setCanceledOnTouchOutside(false); next.setCancelable(true);
        next.setButton(AlertDialog.BUTTON_NEGATIVE, "취소", (d, w) -> cancel());
        next.setOnCancelListener(d -> cancel());
        show(next);
    }
    private void deliver(Task work, Runnable action) {
        activity.runOnUiThread(() -> {
            if (task != work || work.cancelled || !active.getAsBoolean()) return;
            task = null; dismiss(); action.run();
        });
    }
    void pause() { cancel(); }
    void destroy() { cancel(); }
    void cancel() {
        Task work = task; task = null;
        if (work != null) {
            work.cancelled = true;
            if (work.thread != null) work.thread.interrupt();
            HttpsURLConnection connection = work.connection;
            if (connection != null) connection.disconnect();
        }
        dismiss();
    }

    private void check() {
        if (!active.getAsBoolean() || task != null) return;
        Task work = new Task(); task = work; progress();
        work.thread = new Thread(() -> {
            try {
                Release release = fetchRelease(work);
                PackageInfo installed = activity.getPackageManager().getPackageInfo(activity.getPackageName(), 0);
                int order = UpdatePolicy.compareVersions(release.version, installed.versionName);
                deliver(work, () -> {
                    if (order <= 0) notice("업데이트 확인", "현재 v" + installed.versionName + "\nGitHub 정식 배포 v" + release.version
                        + (order == 0 ? "\n\n현재 공개된 최신 버전을 사용하고 있습니다." : "\n\n현재 설치된 앱이 공개 배포판보다 새 버전입니다. 이전 버전으로 되돌리지 않습니다."));
                    else preview(release, installed.versionName);
                });
            } catch (Exception error) {
                String message = error instanceof UpdateError ? error.getMessage()
                    : "새 버전을 확인하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요. 기존 앱과 기록은 유지됩니다.";
                deliver(work, () -> notice("업데이트 확인 중단", message));
            } finally {
                HttpsURLConnection connection = work.connection; work.connection = null;
                if (connection != null) connection.disconnect();
            }
        }, "update-check");
        work.thread.start();
    }

    private Release fetchRelease(Task work) throws Exception {
        if (work.cancelled || Thread.currentThread().isInterrupted()) throw new IOException("Cancelled");
        HttpsURLConnection connection = (HttpsURLConnection) new URL(UpdatePolicy.API).openConnection();
        work.connection = connection;
        if (work.cancelled || Thread.currentThread().isInterrupted()) throw new IOException("Cancelled");
        connection.setConnectTimeout(15000); connection.setReadTimeout(20000); connection.setUseCaches(false);
        connection.setInstanceFollowRedirects(false); connection.setRequestMethod("GET");
        connection.setRequestProperty("User-Agent", "AnnualBloodVolumeCalculator-ManualUpdater");
        connection.setRequestProperty("Accept", "application/vnd.github+json");
        connection.setRequestProperty("Accept-Encoding", "identity");
        connection.setRequestProperty("X-GitHub-Api-Version", "2026-03-10");
        int code = connection.getResponseCode();
        if (code == 404) throw new UpdateError("공개 Release를 찾지 못했습니다. 제작자가 정식 Release에 APK를 등록한 뒤 다시 확인해 주세요.");
        if (code == 403 || code == 429) throw new UpdateError("GitHub 접속 또는 요청 횟수가 제한되었습니다. 잠시 후 직접 다시 확인해 주세요.");
        if (code != 200) throw new UpdateError("GitHub에서 배포 정보를 받지 못했습니다. 주소를 바꾸어 연결하거나 자동 재시도하지 않습니다.");
        String text;
        try (InputStream in = connection.getInputStream()) {
            text = UpdatePolicy.readMetadata(in, () -> work.cancelled);
        }
        JSONObject json = new JSONObject(text);
        if (json.optBoolean("draft", true) || json.optBoolean("prerelease", true)) throw new UpdateError("정식 배포판만 안내합니다.");
        String tag = json.getString("tag_name"), name = UpdatePolicy.apkName(tag);
        JSONArray assets = json.getJSONArray("assets"); Release release = null;
        for (int i = 0; i < assets.length(); i++) {
            JSONObject asset = assets.getJSONObject(i);
            if (!name.equals(asset.optString("name"))) continue;
            long size = asset.getLong("size");
            if (release != null || !UpdatePolicy.validAsset(tag, asset.optString("name"), asset.getString("browser_download_url"), size, asset.optString("state")))
                throw new UpdateError("APK의 배포 주소·이름·용량을 확인할 수 없어 배포 페이지를 열지 않습니다.");
            release = new Release(tag, size);
        }
        if (release == null) throw new UpdateError("정식 Release에 이 앱의 Small APK가 없습니다. 제작자에게 배포 파일 확인을 요청해 주세요.");
        return release;
    }

    private String size(long bytes) { return bytes < 1024 * 1024 ? String.format(Locale.KOREA, "%.1f KiB", bytes / 1024.0) : String.format(Locale.KOREA, "%.1f MiB", bytes / 1048576.0); }
    private void preview(Release release, String installed) {
        show(new AlertDialog.Builder(activity).setTitle("새 버전 v" + release.version)
            .setMessage("현재 v" + installed + " → v" + release.version + "\nAPK 용량: " + size(release.size)
                + "\n\n기본 브라우저로 이 버전의 GitHub 배포 페이지를 엽니다. 페이지 접속과 파일 다운로드에 데이터 요금이 발생할 수 있습니다."
                + "\n\nAssets에서 Small.apk 파일을 직접 내려받아 Android의 안내에 따라 설치하세요. 이 앱은 APK 다운로드·설치·파일 검증을 수행하지 않습니다."
                + "\n\n브라우저에서 받은 APK는 다운로드 폴더 등에 남을 수 있습니다. 설치 후 필요 없으면 직접 삭제하세요. 보안 설정에 따라 설치가 제한될 수 있으며, 기존 앱을 삭제하면 기록도 삭제되므로 먼저 백업해 주세요.")
            .setNegativeButton("취소", null).setPositiveButton("배포 페이지 열기", (d, w) -> { if (dialog == d) openRelease(release); }).create());
    }

    private void openRelease(Release release) {
        if (!active.getAsBoolean()) return;
        dismiss();
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(release.page)).addCategory(Intent.CATEGORY_BROWSABLE);
        intent.setSelector(new Intent(Intent.ACTION_VIEW, Uri.parse("https://")).addCategory(Intent.CATEGORY_BROWSABLE));
        try { activity.startActivity(intent); }
        catch (ActivityNotFoundException | SecurityException error) {
            notice("브라우저를 열 수 없습니다", "기본 브라우저가 설치되어 있고 사용 가능한지 확인해 주세요. 기존 앱과 기록은 유지됩니다.");
        }
    }
}
