package kr.bloodnote.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import java.util.function.BooleanSupplier;

/** Single foreground consent boundary for external websites and Red Connect. */
final class RedConnectLauncher {
    private static final String PACKAGE = "com.sk.redconnect";
    private static final String RESERVATION_NOTE = "실제 예약 시 원하는 지점·날짜·시간·헌혈 종류를 선택하지 못할 수 있습니다. 예약 가능 여부는 해당 기관의 운영과 예약 현황에 따라 달라집니다.\n\n이 앱에서 헌혈 계획을 저장하거나 ‘헌혈 예약하기’를 눌러도 실제 예약이 완료되는 것은 아닙니다. 레드커넥트 또는 대한적십자사 웹사이트에서 예약 절차를 끝내고 예약 내역을 확인해 주세요.";
    private static final String WEBSITE = "https://www.bloodinfo.net/";
    private static final Set<String> HOSTS = new HashSet<>(Arrays.asList(
        "github.com", "emi.bloodinfo.net", "www.bloodinfo.net"
    ));
    private final Activity activity;
    private final BooleanSupplier foreground;
    private AlertDialog prompt;

    RedConnectLauncher(Activity activity, BooleanSupplier foreground) {
        this.activity = activity;
        this.foreground = foreground;
    }

    void requestService(String method) {
        if ("browser".equals(method)) requestWeb(WEBSITE);
        else if ("redconnect".equals(method)) request();
    }

    void requestWeb(String raw) {
        if (!foreground.getAsBoolean() || prompt != null) return;
        final Uri uri = allowedUrl(raw);
        if (uri == null) { information("열 수 없는 주소입니다", "앱에서 허용한 HTTPS 주소만 열 수 있습니다."); return; }
        confirm("인터넷에 연결할까요?",
            "스마트폰의 기본 브라우저로 다음 주소를 엽니다.\n\n" + uri
            + "\n\n인터넷 연결과 데이터 요금이 발생할 수 있습니다. 헌혈 기록·계획·PDF·암호는 전달하지 않습니다. 외부 사이트 이용과 데이터 사용은 해당 사이트·브라우저의 설정을 따릅니다." + (WEBSITE.equals(uri.toString()) ? "\n\n" + RESERVATION_NOTE : ""),
            "확인 후 접속", () -> openBrowser(uri));
    }

    void request() {
        if (!foreground.getAsBoolean() || prompt != null) return;
        if (launchIntent() == null) { unavailable(); return; }
        confirm("레드커넥트를 실행할까요?",
            "레드커넥트 실행 후 로그인·헌혈 예약·증명서 발급 등을 이용하면 인터넷 연결과 데이터 요금이 발생할 수 있습니다.\n\n이 앱의 헌혈 기록·계획·PDF·암호는 전달하지 않습니다. 레드커넥트의 시작 화면을 엽니다. 예약이나 증명서 발급 메뉴는 해당 앱에서 직접 선택해 주세요.\n\n계획 저장·예약·증명서 발급은 각각 별개의 작업입니다. 레드커넥트의 데이터 사용은 해당 앱의 설정을 따릅니다.\n\n" + RESERVATION_NOTE,
            "확인 후 실행", () -> {
                Intent intent = launchIntent();
                if (intent == null) { unavailable(); return; }
                try { activity.startActivity(intent); }
                catch (ActivityNotFoundException | SecurityException error) { unavailable(); }
            });
    }

    private static Uri allowedUrl(String raw) {
        if (raw == null || raw.length() > 2048) return null;
        try {
            Uri uri = Uri.parse(raw);
            return "https".equals(uri.getScheme()) && uri.getUserInfo() == null
                && uri.getPort() == -1 && HOSTS.contains(uri.getHost()) ? uri : null;
        } catch (RuntimeException error) { return null; }
    }

    private void openBrowser(Uri uri) {
        if (!foreground.getAsBoolean()) return;
        // Resolve a generic HTTPS handler so a domain-specific app link cannot
        // override the browser choice. The receiving browser gets the real URL.
        Intent intent = new Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE);
        intent.setSelector(new Intent(Intent.ACTION_VIEW, Uri.parse("https://"))
            .addCategory(Intent.CATEGORY_BROWSABLE));
        try { activity.startActivity(intent); }
        catch (ActivityNotFoundException | SecurityException error) {
            information("인터넷 브라우저를 열 수 없습니다", "기본 브라우저가 설치되어 있고 사용 가능한지 확인해 주세요. 기기나 업무 프로필의 실행 제한으로 열리지 않을 수도 있습니다.");
        }
    }

    private Intent launchIntent() {
        try {
            Intent intent = activity.getPackageManager().getLaunchIntentForPackage(PACKAGE);
            if (intent == null || intent.getComponent() == null
                || !PACKAGE.equals(intent.getComponent().getPackageName())) return null;
            return Intent.makeMainActivity(intent.getComponent());
        } catch (RuntimeException error) { return null; }
    }

    private void unavailable() {
        if (!foreground.getAsBoolean()) return;
        confirm("레드커넥트를 열 수 없습니다",
            "앱이 설치되지 않았거나 기기 설정·보안 폴더·업무 프로필 때문에 실행할 수 없습니다.\n\n대신 기본 브라우저로 대한적십자사 혈액관리본부(" + WEBSITE + ")를 열어 계속할까요? 인터넷 연결과 데이터 요금이 발생할 수 있습니다.\n\n헌혈 기록·계획·PDF·암호는 전달하지 않으며, 예약·증명서 발급 메뉴는 사이트에서 직접 선택해 주세요.\n\n" + RESERVATION_NOTE,
            "브라우저로 계속", () -> openBrowser(Uri.parse(WEBSITE)));
    }

    private void confirm(String title, String message, String positive, Runnable action) {
        if (!foreground.getAsBoolean() || prompt != null) return;
        show(new AlertDialog.Builder(activity).setTitle(title).setMessage(message)
            .setNegativeButton("취소", (dialog, which) -> { if (prompt == dialog) cancelPending(); })
            .setPositiveButton(positive, (dialog, which) -> {
                if (prompt != dialog) return;
                cancelPending();
                if (foreground.getAsBoolean()) action.run();
            }).create());
    }

    private void information(String title, String message) {
        if (!foreground.getAsBoolean() || prompt != null) return;
        show(new AlertDialog.Builder(activity).setTitle(title).setMessage(message)
            .setPositiveButton("닫기", (dialog, which) -> { if (prompt == dialog) cancelPending(); }).create());
    }

    private void show(AlertDialog dialog) {
        prompt = dialog;
        dialog.setOnDismissListener(dismissed -> { if (prompt == dialog) prompt = null; });
        dialog.setCanceledOnTouchOutside(true);
        dialog.show();
    }

    boolean cancelPending() {
        AlertDialog previous = prompt;
        prompt = null;
        if (previous != null) previous.dismiss();
        return previous != null;
    }
}
