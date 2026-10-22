package kr.bloodnote.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.ProgressDialog;
import android.content.ClipData;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.os.SystemClock;
import android.provider.Settings;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.UUID;
import java.util.function.BooleanSupplier;
import javax.net.ssl.HttpsURLConnection;
import org.json.JSONArray;
import org.json.JSONObject;

/** Manual, foreground-only updater. Nothing contacts GitHub before native consent. */
final class AppUpdater {
    static final int INSTALL_PERMISSION = 401, INSTALL_APK = 402;
    static final String DISCLOSURE = "이번 한 번 GitHub에 연결해 새 버전 정보를 확인합니다. APK 다운로드는 버전과 용량을 본 뒤 별도로 선택합니다. 데이터 요금이 발생할 수 있습니다.\n\n"
        + "헌혈 기록·계획·PDF·백업은 보내지 않습니다. GitHub에는 접속 IP 등 일반적인 통신 정보가 전달됩니다. 앱 시작 시나 백그라운드에서는 자동으로 확인하지 않습니다.\n\n"
        + "알 수 없는 앱 설치 허용, 기기의 보안 설정·앱 설치 제한·OS 정책 등에 따라 업데이트가 완료되지 않을 수 있습니다. 설치는 Android의 확인을 거칩니다.\n\n"
        + "전문 개발사나 공식 헌혈기관이 아닌 개인이 제작한 비공식 앱입니다. 사용·설치·업데이트는 안내를 확인한 뒤 이용자 본인의 판단과 책임으로 진행해 주세요. 중요한 기록은 먼저 백업해 주세요.";
    private final Activity activity;
    private final BooleanSupplier active;
    private AlertDialog dialog;
    private Task task;
    private Release ready;
    private boolean awaitingPermission, installing;
    private int pendingResult = -1, pendingResultCode;

    private static final class UpdateError extends IOException { UpdateError(String message) { super(message); } }
    private static final class Task {
        volatile boolean cancelled;
        volatile HttpsURLConnection connection;
        Thread thread;
    }
    private static final class Release {
        final String version, url, sha256;
        final long size;
        Release(String version, String url, String sha256, long size) {
            this.version = version; this.url = url; this.sha256 = sha256; this.size = size;
        }
    }

    AppUpdater(Activity activity, BooleanSupplier active) { this.activity = activity; this.active = active; }

    void request() {
        if (!active.getAsBoolean() || task != null || dialog != null || awaitingPermission || installing) return;
        discardReady();
        File[] leftovers = UpdateApkProvider.apk(activity).getParentFile().listFiles();
        if (leftovers != null) for (File file : leftovers) if (file.getName().endsWith(".part")) file.delete();
        show(new AlertDialog.Builder(activity).setTitle("업데이트 확인에 인터넷을 사용할까요?")
            .setMessage(DISCLOSURE).setNegativeButton("취소", null)
            .setPositiveButton("안내 확인 · 이번만 연결", (d, w) -> check()).create());
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
    private void progress(String title, Task work) {
        ProgressDialog next = new ProgressDialog(activity);
        next.setTitle(title); next.setMessage("잠시 기다려 주세요."); next.setIndeterminate(true);
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
    private void fail(Task work, Exception error) {
        String message = error instanceof UpdateError ? error.getMessage()
            : "업데이트를 완료하지 못했습니다. 인터넷 연결·저장 공간·기기 보안 설정을 확인한 뒤 다시 시도해 주세요. 기존 앱과 기록은 유지됩니다.";
        deliver(work, () -> notice("업데이트 중단", message));
    }
    void pause() { cancel(); }
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
    void destroy() { cancel(); }
    private void disconnect(Task work) {
        HttpsURLConnection connection = work.connection; work.connection = null;
        if (connection != null) connection.disconnect();
    }

    private void check() {
        if (!active.getAsBoolean() || task != null) return;
        Task work = new Task(); task = work; progress("GitHub 새 버전 확인", work);
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
            } catch (Exception error) { fail(work, error); }
            finally { disconnect(work); }
        }, "update-check");
        work.thread.start();
    }

    private HttpsURLConnection connect(String start, boolean metadata, Task work) throws Exception {
        String address = start;
        for (int hop = 0; hop <= 4; hop++) {
            if (work.cancelled || Thread.currentThread().isInterrupted()) throw new IOException("Cancelled");
            if (!UpdatePolicy.allowed(address, metadata)) throw new UpdateError("허용된 GitHub 배포 주소가 아니어서 연결을 중단했습니다.");
            HttpsURLConnection connection = (HttpsURLConnection) new URL(address).openConnection();
            work.connection = connection;
            if (work.cancelled || Thread.currentThread().isInterrupted()) { connection.disconnect(); throw new IOException("Cancelled"); }
            connection.setConnectTimeout(15000); connection.setReadTimeout(20000); connection.setUseCaches(false);
            connection.setInstanceFollowRedirects(false); connection.setRequestMethod("GET");
            connection.setRequestProperty("User-Agent", "AnnualBloodVolumeCalculator-ManualUpdater");
            connection.setRequestProperty("Accept", metadata ? "application/vnd.github+json" : "application/octet-stream");
            connection.setRequestProperty("Accept-Encoding", "identity");
            if (metadata) connection.setRequestProperty("X-GitHub-Api-Version", "2026-03-10");
            int code = connection.getResponseCode();
            if (code == 200) return connection;
            if (code == 301 || code == 302 || code == 303 || code == 307 || code == 308) {
                String next = connection.getHeaderField("Location"); connection.disconnect();
                if (next == null) break;
                address = new URL(new URL(address), next).toExternalForm();
                continue;
            }
            connection.disconnect();
            if (code == 404) throw new UpdateError("공개 Release 또는 APK를 찾지 못했습니다. 제작자가 정식 Release에 APK를 등록한 뒤 다시 확인해 주세요.");
            if (code == 403 || code == 429) throw new UpdateError("GitHub 접속 또는 요청 횟수가 제한되었습니다. 잠시 후 직접 다시 확인해 주세요.");
            throw new UpdateError("GitHub에서 자료를 받지 못했습니다. 잠시 후 다시 확인해 주세요.");
        }
        throw new UpdateError("배포 주소 이동이 너무 많거나 올바르지 않아 연결을 중단했습니다.");
    }

    private Release fetchRelease(Task work) throws Exception {
        HttpsURLConnection connection = connect(UpdatePolicy.API, true, work);
        String text;
        try (InputStream in = connection.getInputStream(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            UpdatePolicy.copy(in, out, UpdatePolicy.MAX_METADATA, -1, transfer(work, false, 0));
            text = new String(out.toByteArray(), StandardCharsets.UTF_8);
        } finally { connection.disconnect(); work.connection = null; }
        JSONObject json = new JSONObject(text);
        if (json.optBoolean("draft", true) || json.optBoolean("prerelease", true)) throw new UpdateError("정식 배포판만 업데이트할 수 있습니다.");
        String tag = json.getString("tag_name"), version = UpdatePolicy.version(tag), name = UpdatePolicy.apkName(version);
        JSONArray assets = json.getJSONArray("assets"); Release result = null;
        for (int i = 0; i < assets.length(); i++) {
            JSONObject asset = assets.getJSONObject(i);
            if (!name.equals(asset.optString("name"))) continue;
            String url = asset.getString("browser_download_url"), digest = asset.optString("digest");
            long size = asset.getLong("size");
            String expected = "https://github.com/" + UpdatePolicy.REPOSITORY + "/releases/download/" + tag + "/" + name;
            if (result != null || !expected.equals(url) || !"uploaded".equals(asset.optString("state"))
                || !digest.matches("sha256:[a-f0-9]{64}") || size < 1 || size > UpdatePolicy.MAX_APK)
                throw new UpdateError("APK의 출처·크기·검증 정보를 확인할 수 없습니다. 설치를 진행하지 않습니다.");
            result = new Release(version, url, digest.substring(7), size);
        }
        if (result == null) throw new UpdateError("정식 Release에 이 앱의 Small APK가 없습니다. 제작자에게 배포 파일 확인을 요청해 주세요.");
        return result;
    }

    private String size(long bytes) { return bytes < 1024 * 1024 ? String.format(Locale.KOREA, "%.1f KB", bytes / 1024.0) : String.format(Locale.KOREA, "%.1f MB", bytes / 1048576.0); }
    private void preview(Release release, String installed) {
        show(new AlertDialog.Builder(activity).setTitle("새 버전 v" + release.version)
            .setMessage("현재 v" + installed + " → v" + release.version + "\nAPK 용량: " + size(release.size)
                + " (통신 과정에서 추가 데이터가 사용될 수 있습니다.)\n\n다운로드 후 파일과 앱 서명을 검사하고 Android 설치 확인 화면을 엽니다. 보안 설정에 따라 설치가 제한될 수 있습니다. 중요한 기록은 먼저 백업해 주세요.")
            .setNegativeButton("취소", null).setPositiveButton("다운로드 및 설치", (d, w) -> download(release)).create());
    }
    private UpdatePolicy.Transfer transfer(Task work, boolean showProgress, long expected) {
        return new UpdatePolicy.Transfer() {
            long last;
            public boolean cancelled() { return work.cancelled; }
            public void progress(long bytes) {
                long now = SystemClock.elapsedRealtime();
                if (!showProgress || now - last < 500) return;
                last = now;
                activity.runOnUiThread(() -> {
                    if (task == work && !work.cancelled && dialog instanceof ProgressDialog)
                        ((ProgressDialog) dialog).setMessage(size(bytes) + " / " + size(expected) + "\n앱을 벗어나면 다운로드를 중단합니다.");
                });
            }
        };
    }
    private void download(Release release) {
        if (!active.getAsBoolean() || task != null) return;
        Task work = new Task(); task = work; progress("업데이트 다운로드", work);
        File target = UpdateApkProvider.apk(activity), part = new File(target.getParentFile(), UUID.randomUUID() + ".part");
        work.thread = new Thread(() -> {
            boolean delivered = false;
            try {
                if (!target.getParentFile().isDirectory() && !target.getParentFile().mkdirs()) throw new IOException("Storage unavailable");
                if (target.getParentFile().getUsableSpace() < release.size * 3 + 1024 * 1024) throw new UpdateError("업데이트에 필요한 저장 공간이 부족합니다.");
                HttpsURLConnection connection = connect(release.url, false, work);
                String hash;
                try (InputStream in = connection.getInputStream(); FileOutputStream out = new FileOutputStream(part)) {
                    hash = UpdatePolicy.copy(in, out, UpdatePolicy.MAX_APK, release.size, transfer(work, true, release.size));
                    out.getFD().sync();
                } finally { connection.disconnect(); work.connection = null; }
                if (!release.sha256.equals(hash)) throw new UpdateError("APK 파일 검증값이 일치하지 않아 삭제했습니다. 다시 확인해 주세요.");
                verifyApk(part, release);
                if (work.cancelled) return;
                delivered = true;
                activity.runOnUiThread(() -> {
                    if (task != work || work.cancelled || !active.getAsBoolean()) { part.delete(); return; }
                    task = null; dismiss();
                    if ((target.exists() && !target.delete()) || !part.renameTo(target)) {
                        part.delete(); notice("업데이트 중단", "APK를 저장하지 못했습니다. 저장 공간을 확인해 주세요."); return;
                    }
                    ready = release; installOrPermission();
                });
            } catch (Exception error) { fail(work, error); }
            finally { disconnect(work); if (!delivered) part.delete(); }
        }, "update-download");
        work.thread.start();
    }

    private long code(PackageInfo info) { return Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode; }
    private Signature[] signatures(PackageInfo info) {
        return Build.VERSION.SDK_INT >= 28 ? (info.signingInfo == null ? null : info.signingInfo.getApkContentsSigners()) : info.signatures;
    }
    private void verifyApk(File file, Release release) throws Exception {
        int flags = Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
        PackageManager manager = activity.getPackageManager();
        PackageInfo own = manager.getPackageInfo(activity.getPackageName(), flags), incoming = manager.getPackageArchiveInfo(file.getAbsolutePath(), flags);
        if (incoming == null || incoming.applicationInfo == null) throw new UpdateError("올바른 APK가 아니어서 설치하지 않았습니다.");
        Signature[] a = signatures(own), b = signatures(incoming);
        boolean same = a != null && b != null && a.length > 0 && b.length > 0
            && new HashSet<>(Arrays.asList(a)).equals(new HashSet<>(Arrays.asList(b)));
        try { UpdatePolicy.checkIdentity(incoming.packageName, activity.getPackageName(), incoming.versionName, release.version, code(incoming), code(own), same); }
        catch (IOException error) { throw new UpdateError(error.getMessage()); }
        if (incoming.applicationInfo.minSdkVersion > Build.VERSION.SDK_INT) throw new UpdateError("이 업데이트는 현재 Android 버전에서 설치할 수 없습니다.");
    }
    private void installOrPermission() {
        if (!active.getAsBoolean() || ready == null) return;
        if (activity.getPackageManager().canRequestPackageInstalls()) { launchInstaller(); return; }
        show(new AlertDialog.Builder(activity).setTitle("이 앱의 설치 허용 설정이 필요합니다")
            .setMessage("Android가 이 앱에서 APK 설치를 요청하는 것을 허용하지 않고 있습니다. 설정에서 허용 여부를 직접 선택할 수 있습니다. 허용 후 돌아오면 설치 확인 화면을 엽니다.\n\n기기의 보안 차단이나 관리 정책 때문에 허용·설치가 불가능할 수도 있습니다. 보안 설정을 자동으로 변경하지 않습니다.")
            .setNegativeButton("취소", (d, w) -> discardReady()).setOnCancelListener(d -> discardReady())
            .setPositiveButton("설정 열기", (d, w) -> {
                awaitingPermission = true;
                try { activity.startActivityForResult(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + activity.getPackageName())), INSTALL_PERMISSION); }
                catch (Exception error) { awaitingPermission = false; discardReady(); notice("설치 설정을 열 수 없습니다", "기기의 보안 설정이나 관리 정책을 확인해 주세요. 기존 앱과 기록은 유지됩니다."); }
            }).create());
    }
    private void launchInstaller() {
        if (!active.getAsBoolean() || ready == null || installing) return;
        File file = UpdateApkProvider.apk(activity);
        try {
            if (!file.isFile() || file.length() != ready.size) throw new IOException("Missing APK");
            Uri uri = UpdateApkProvider.uri(activity);
            Intent intent = new Intent(Intent.ACTION_INSTALL_PACKAGE).setDataAndType(uri, "application/vnd.android.package-archive");
            intent.setClipData(ClipData.newRawUri("App update", uri));
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.putExtra(Intent.EXTRA_RETURN_RESULT, true);
            installing = true;
            activity.startActivityForResult(intent, INSTALL_APK);
        } catch (Exception error) {
            installing = false; discardReady();
            notice("설치를 시작하지 못했습니다", "기기 보안 설정·앱 설치 제한 또는 설치 프로그램을 확인해 주세요. 기존 앱과 기록은 유지됩니다.");
        }
    }
    boolean result(int request, int result) {
        if (request != INSTALL_PERMISSION && request != INSTALL_APK) return false;
        pendingResult = request; pendingResultCode = result;
        resume(); return true;
    }
    void resume() {
        if (!active.getAsBoolean() || pendingResult == -1) return;
        int request = pendingResult, result = pendingResultCode; pendingResult = -1;
        if (request == INSTALL_PERMISSION) {
            awaitingPermission = false;
            if (ready == null) { notice("설치를 다시 시작해 주세요", "앱이 다시 시작되어 설치 준비가 중단되었습니다. 업데이트 확인을 다시 눌러 주세요."); return; }
            if (activity.getPackageManager().canRequestPackageInstalls()) launchInstaller();
            else { discardReady(); notice("설치가 허용되지 않았습니다", "보안 설정 때문에 업데이트를 완료하지 못했습니다. 기존 앱과 기록은 유지됩니다."); }
        } else {
            installing = false; discardReady();
            notice(result == Activity.RESULT_OK ? "업데이트 완료" : "설치가 완료되지 않았습니다",
                result == Activity.RESULT_OK ? "앱을 다시 열어 버전을 확인해 주세요." : "사용자가 취소했거나 기기 보안 설정·설치 제한으로 중단됐을 수 있습니다. 기존 기록은 유지됩니다.");
        }
    }
    private void discardReady() { ready = null; UpdateApkProvider.apk(activity).delete(); }
}
