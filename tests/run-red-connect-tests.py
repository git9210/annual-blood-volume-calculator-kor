"""Exercise the real launcher with small host-side Android fakes, not a device UI.

Checks the consent boundary, lifecycle cancellation, target identity and absence
of donated data in the launch Intent. No network or Android emulator is used.
"""
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
SOURCES = {
    "android/content/DialogInterface.java": """
package android.content;
public interface DialogInterface {
    interface OnClickListener { void onClick(DialogInterface dialog, int which); }
    interface OnDismissListener { void onDismiss(DialogInterface dialog); }
}
""",
    "android/content/ActivityNotFoundException.java": """
package android.content;
public class ActivityNotFoundException extends RuntimeException {}
""",
    "android/content/ComponentName.java": """
package android.content;
public class ComponentName {
    private final String name;
    public ComponentName(String name) { this.name = name; }
    public String getPackageName() { return name; }
}
""",
    "android/net/Uri.java": """
package android.net;
public class Uri {
    private final String value;
    private Uri(String value) { this.value = value; }
    public static Uri parse(String value) { return new Uri(value); }
    public String getScheme() { int i=value.indexOf(':'); return i<0?null:value.substring(0,i); }
    private java.net.URI parsed() { return java.net.URI.create(value); }
    public String getHost() { return parsed().getHost(); }
    public String getUserInfo() { return parsed().getUserInfo(); }
    public int getPort() { return parsed().getPort(); }
    @Override public String toString() { return value; }
}
""",
    "android/content/Intent.java": """
package android.content;
import android.net.Uri;
public class Intent {
    public static final String ACTION_VIEW="android.intent.action.VIEW", CATEGORY_BROWSABLE="android.intent.category.BROWSABLE";
    public ComponentName component;
    public Uri data;
    public String action, category, extras;
    public boolean fileGrant;
    public Intent selector;
    public Intent(ComponentName component) { this.component = component; }
    public Intent(String action, Uri data) { this.action=action; this.data=data; }
    public Intent addCategory(String category) { this.category=category; return this; }
    public void setSelector(Intent selector) { this.selector=selector; }
    public ComponentName getComponent() { return component; }
    public static Intent makeMainActivity(ComponentName component) { return new Intent(component); }
}
""",
    "android/content/pm/PackageManager.java": """
package android.content.pm;
import android.content.Intent;
public class PackageManager {
    public Intent available;
    public int queries;
    public Intent getLaunchIntentForPackage(String name) {
        if (!"com.sk.redconnect".equals(name)) throw new AssertionError("unrelated package query");
        queries++;
        return available;
    }
}
""",
    "android/app/Activity.java": """
package android.app;
import android.content.Intent;
import android.content.pm.PackageManager;
public class Activity {
    public final PackageManager packages = new PackageManager();
    public int launched;
    public Intent lastIntent;
    public RuntimeException launchError;
    public PackageManager getPackageManager() { return packages; }
    public void startActivity(Intent intent) {
        if (launchError != null) throw launchError;
        launched++;
        lastIntent = intent;
    }
}
""",
    "android/app/AlertDialog.java": """
package android.app;
import android.content.DialogInterface;
public class AlertDialog implements DialogInterface {
    public static AlertDialog last;
    public boolean visible;
    public String title, message, positiveLabel;
    public OnClickListener positive, negative;
    private OnDismissListener dismissed;
    public void setOnDismissListener(OnDismissListener listener) { dismissed = listener; }
    public void setCanceledOnTouchOutside(boolean value) {}
    public void show() { visible = true; last = this; }
    public void dismiss() {
        if (!visible) return;
        visible = false;
        if (dismissed != null) dismissed.onDismiss(this);
    }
    public static class Builder {
        private final AlertDialog dialog = new AlertDialog();
        public Builder(Activity activity) {}
        public Builder setTitle(String title) { dialog.title = title; return this; }
        public Builder setMessage(String message) { dialog.message = message; return this; }
        public Builder setPositiveButton(String label, OnClickListener listener) {
            dialog.positiveLabel = label; dialog.positive = listener; return this;
        }
        public Builder setNegativeButton(String label, OnClickListener listener) {
            dialog.negative = listener; return this;
        }
        public AlertDialog create() { return dialog; }
    }
}
""",
    "kr/bloodnote/app/RedConnectLauncherTest.java": """
package kr.bloodnote.app;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.ComponentName;
import android.content.Intent;
public class RedConnectLauncherTest {
    static int checks;
    static void check(boolean ok) { checks++; if (!ok) throw new AssertionError("check " + checks); }
    public static void main(String[] args) {
        Activity app = new Activity();
        Intent installed = new Intent(new ComponentName("com.sk.redconnect"));
        installed.data = android.net.Uri.parse("https://never-forward.example"); installed.extras = "never-forward"; installed.fileGrant = true;
        app.packages.available = installed;
        boolean[] foreground = {false};
        RedConnectLauncher launcher = new RedConnectLauncher(app, () -> foreground[0]);
        check(app.packages.queries == 0 && app.launched == 0);
        launcher.request(); check(app.packages.queries == 0);
        foreground[0] = true;
        launcher.request(); AlertDialog first = AlertDialog.last;
        check(first.visible && app.launched == 0);
        check(first.message.contains("데이터 요금") && first.message.contains("전달하지 않습니다"));
        check(first.message.contains("증명서 발급") && first.message.contains("시작 화면"));
        check(first.message.contains("원하는 지점·날짜·시간·헌혈 종류") && first.message.contains("못할 수 있습니다"));
        check(first.message.contains("실제 예약이 완료되는 것은 아닙니다") && first.message.contains("예약 내역을 확인해 주세요"));
        check(first.positiveLabel.equals("확인 후 실행"));
        launcher.request(); check(AlertDialog.last == first && app.packages.queries == 1);
        first.negative.onClick(first, 0); check(!first.visible && app.launched == 0);
        first.positive.onClick(first, 1); check(app.launched == 0);
        launcher.request(); AlertDialog outside = AlertDialog.last;
        outside.dismiss(); outside.positive.onClick(outside, 1); check(app.launched == 0);
        launcher.request(); AlertDialog paused = AlertDialog.last;
        foreground[0] = false; check(launcher.cancelPending());
        foreground[0] = true; paused.positive.onClick(paused, 1); check(app.launched == 0);
        launcher.request(); AlertDialog background = AlertDialog.last;
        foreground[0] = false; background.positive.onClick(background, 1); check(app.launched == 0);
        foreground[0] = true;
        launcher.request(); AlertDialog approved = AlertDialog.last;
        approved.positive.onClick(approved, 1); check(app.launched == 1 && !approved.visible);
        check(app.lastIntent != installed && app.lastIntent.data == null && app.lastIntent.extras == null && !app.lastIntent.fileGrant);
        check("com.sk.redconnect".equals(app.lastIntent.getComponent().getPackageName()));
        approved.positive.onClick(approved, 1); check(app.launched == 1);
        launcher.request(); check(app.launched == 1 && AlertDialog.last != approved);
        launcher.cancelPending();
        app.packages.available = null;
        launcher.request(); AlertDialog missing = AlertDialog.last;
        check(missing.title.equals("레드커넥트를 열 수 없습니다") && missing.negative != null);
        missing.negative.onClick(missing, 0); missing.positive.onClick(missing, 1); check(app.launched == 1);
        app.packages.available = installed;
        launcher.request(); AlertDialog removed = AlertDialog.last;
        app.packages.available = null; removed.positive.onClick(removed, 1);
        check(app.launched == 1 && AlertDialog.last.title.equals("레드커넥트를 열 수 없습니다"));
        launcher.cancelPending();
        app.packages.available = new Intent(new ComponentName("other.app"));
        launcher.request(); check(AlertDialog.last.positiveLabel.equals("브라우저로 계속")); launcher.cancelPending();
        app.packages.available = installed;
        for (RuntimeException error : new RuntimeException[]{new ActivityNotFoundException(), new SecurityException()}) {
            app.launchError = error;
            launcher.request(); AlertDialog denied = AlertDialog.last; denied.positive.onClick(denied, 1);
            check(app.launched == 1 && AlertDialog.last.positiveLabel.equals("브라우저로 계속"));
            launcher.cancelPending();
        }
        check(!launcher.cancelPending());
        app.launchError = null;
        int launched = app.launched, queries = app.packages.queries;
        launcher.requestService("invalid"); launcher.requestService(null);
        check(app.launched == launched && app.packages.queries == queries);
        launcher.requestService("browser"); AlertDialog web = AlertDialog.last;
        check(web.message.contains("데이터 요금") && web.message.contains("https://www.bloodinfo.net/"));
        check(web.message.contains("원하는 지점·날짜·시간·헌혈 종류"));
        check(web.message.contains("실제 예약이 완료되는 것은 아닙니다") && web.message.contains("예약 내역을 확인해 주세요"));
        check(app.launched == launched && app.packages.queries == queries);
        launcher.requestWeb("https://emi.bloodinfo.net/emi4.do?lang=ko"); check(AlertDialog.last == web);
        web.negative.onClick(web, 0); web.positive.onClick(web, 1); check(app.launched == launched);
        launcher.requestService("browser"); web=AlertDialog.last; web.positive.onClick(web, 1);
        check(app.launched == ++launched && app.packages.queries == queries);
        check(app.lastIntent.data.toString().equals("https://www.bloodinfo.net/"));
        check(app.lastIntent.action.equals(Intent.ACTION_VIEW) && app.lastIntent.category.equals(Intent.CATEGORY_BROWSABLE));
        check(app.lastIntent.selector != null && app.lastIntent.selector.data.toString().equals("https://"));
        check(app.lastIntent.component == null && app.lastIntent.extras == null && !app.lastIntent.fileGrant);
        web.positive.onClick(web, 1); check(app.launched == launched);
        for (String url : new String[]{"https://emi.bloodinfo.net/emi4.do?lang=ko", "https://github.com/hyunbinseo/holidays-kr", "https://github.com/hyunbinseo/holidays-kr/blob/main/LICENSE"}) {
            launcher.requestWeb(url); AlertDialog p=AlertDialog.last;
            check(app.launched == launched && p.message.contains("데이터 요금") && p.message.contains(url));
            p.positive.onClick(p,1); check(app.launched == ++launched && app.lastIntent.data.toString().equals(url));
        }
        for (String bad : new String[]{null,"", "http://www.bloodinfo.net/", "https://www.bloodinfo.net.evil/", "https://user@www.bloodinfo.net/", "https://www.bloodinfo.net:443/", "javascript:alert(1)", "intent://www.bloodinfo.net", "file:///sdcard/private", "https://example.com/", "https://github.com@evil.example/"}) {
            launcher.requestWeb(bad); AlertDialog p=AlertDialog.last;
            check(p.title.equals("열 수 없는 주소입니다") && p.positiveLabel.equals("닫기"));
            p.positive.onClick(p,1); check(app.launched == launched);
        }
        launcher.requestWeb("https://www.bloodinfo.net/"); AlertDialog outsideWeb=AlertDialog.last;
        outsideWeb.dismiss(); outsideWeb.positive.onClick(outsideWeb,1); check(app.launched == launched);
        launcher.requestService("browser"); AlertDialog staleWeb=AlertDialog.last;
        foreground[0]=false; launcher.cancelPending();
        launcher.requestService("browser"); check(AlertDialog.last == staleWeb);
        foreground[0]=true; staleWeb.positive.onClick(staleWeb,1); check(app.launched == launched);
        launcher.requestService("browser"); AlertDialog liveWeb=AlertDialog.last;
        staleWeb.negative.onClick(staleWeb,0); check(liveWeb.visible);
        liveWeb.positive.onClick(liveWeb,1); check(app.launched == ++launched);
        app.packages.available=null; launcher.requestService("redconnect"); AlertDialog fallback=AlertDialog.last;
        check(fallback.positiveLabel.equals("브라우저로 계속") && fallback.message.contains("데이터 요금") && app.launched == launched);
        check(fallback.message.contains("원하는 지점·날짜·시간·헌혈 종류"));
        check(fallback.message.contains("실제 예약이 완료되는 것은 아닙니다") && fallback.message.contains("예약 내역을 확인해 주세요"));
        fallback.positive.onClick(fallback,1); check(app.launched == ++launched && app.lastIntent.data.toString().equals("https://www.bloodinfo.net/"));
        fallback.positive.onClick(fallback,1); check(app.launched == launched);
        app.launchError=new ActivityNotFoundException();
        launcher.requestService("browser"); AlertDialog broken=AlertDialog.last; broken.positive.onClick(broken,1);
        check(app.launched == launched && AlertDialog.last.title.equals("인터넷 브라우저를 열 수 없습니다")); launcher.cancelPending();
        app.launchError=null;
        check(!launcher.cancelPending());
        System.out.println("PASS: " + checks + " launcher consent/target/lifecycle checks (host Android fakes; not device UI).");
    }
}
""",
}

with tempfile.TemporaryDirectory(prefix="red-connect-tests-") as temp:
    directory = Path(temp)
    files = []
    for name, source in SOURCES.items():
        file = directory / name
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(source, encoding="utf-8")
        files.append(str(file))
    files.append(str(ROOT / "src/kr/bloodnote/app/RedConnectLauncher.java"))
    subprocess.run(["java", "-m", "jdk.compiler/com.sun.tools.javac.Main", "-encoding", "UTF-8", "-d", temp, *files], check=True)
    subprocess.run(["java", "-cp", temp, "kr.bloodnote.app.RedConnectLauncherTest"], check=True)
