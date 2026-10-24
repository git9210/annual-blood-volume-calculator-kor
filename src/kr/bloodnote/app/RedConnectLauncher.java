package kr.bloodnote.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import java.util.function.BooleanSupplier;

/** Opens only the installed Red Connect app after a fresh, foreground confirmation. */
final class RedConnectLauncher {
    private static final String PACKAGE = "com.sk.redconnect";
    private final Activity activity;
    private final BooleanSupplier foreground;
    private AlertDialog prompt;

    RedConnectLauncher(Activity activity, BooleanSupplier foreground) {
        this.activity = activity;
        this.foreground = foreground;
    }

    void request() {
        if (!foreground.getAsBoolean() || prompt != null) return;
        if (launchIntent() == null) { unavailable(); return; }
        final AlertDialog consent = new AlertDialog.Builder(activity)
            .setTitle("레드커넥트를 실행할까요?")
            .setMessage("레드커넥트 실행 후 로그인·헌혈 예약·증명서 발급 등을 이용하면 인터넷 연결과 데이터 요금이 발생할 수 있습니다.\n\n이 앱의 헌혈 기록·계획·PDF는 전달하지 않습니다. 레드커넥트의 시작 화면을 엽니다. 예약이나 증명서 발급 메뉴는 해당 앱에서 직접 선택해 주세요.\n\n계획 저장·예약·증명서 발급은 각각 별개의 작업입니다. 레드커넥트의 데이터 사용은 해당 앱의 설정을 따릅니다.")
            .setNegativeButton("취소", (dialog, which) -> cancelPending())
            .setPositiveButton("확인 후 실행", (dialog, which) -> {
                // Cancel/back/pause/dismiss revoke this particular prompt permanently.
                if (prompt != dialog) return;
                cancelPending();
                if (!foreground.getAsBoolean()) return;
                // Re-check in case the app was removed or disabled while the prompt was open.
                Intent intent = launchIntent();
                if (intent == null) { unavailable(); return; }
                try { activity.startActivity(intent); }
                catch (ActivityNotFoundException | SecurityException error) { unavailable(); }
            }).create();
        show(consent);
    }

    private Intent launchIntent() {
        try {
            Intent intent = activity.getPackageManager().getLaunchIntentForPackage(PACKAGE);
            if (intent == null || intent.getComponent() == null
                || !PACKAGE.equals(intent.getComponent().getPackageName())) return null;
            // A normal app launch, with no URL, extras, files, or grants from this app.
            return Intent.makeMainActivity(intent.getComponent());
        } catch (RuntimeException error) { return null; }
    }

    private void unavailable() {
        if (!foreground.getAsBoolean()) return;
        show(new AlertDialog.Builder(activity)
            .setTitle("레드커넥트를 열 수 없습니다")
            .setMessage("레드커넥트가 설치되어 있고 사용 가능한지 확인해 주세요. 보안 폴더나 업무 프로필에만 설치되어 있거나 기기 설정에서 실행을 제한한 경우에도 열리지 않을 수 있습니다.\n\n앱이 없다면 Google Play에서 ‘레드커넥트’를 검색해 대한적십자사가 제공하는 앱을 설치해 주세요. 현재 헌혈 기록과 저장된 계획은 그대로 유지됩니다.")
            .setPositiveButton("닫기", (dialog, which) -> cancelPending())
            .create());
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
