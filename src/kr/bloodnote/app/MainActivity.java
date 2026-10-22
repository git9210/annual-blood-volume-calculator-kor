package kr.bloodnote.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.accessibility.AccessibilityManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebStorage;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.widget.Toast;
import android.window.OnBackInvokedDispatcher;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import org.json.JSONObject;

/** Offline-first shell. Holiday refresh and update requests require explicit native consent. */
public final class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String HOME = "https://" + HOST + "/assets/index.html";
    private static final String HOLIDAYS = "https://raw.githubusercontent.com/hyunbinseo/holidays-kr/main/public/basic.json";
    private static final Set<String> ASSETS = new HashSet<>(Arrays.asList(
        "index.html", "app.mjs", "engine.mjs", "calendar-view.mjs", "holidays.mjs",
        "holiday-snapshot.mjs", "licenses.mjs", "certificate-import.mjs", "secure-storage.mjs", "backup-crypto.mjs", "style.css", "icon.svg",
        "holiday-data-license.txt"
    ));
    private static final Set<String> EXTERNAL_HOSTS = new HashSet<>(Arrays.asList(
        "github.com", "emi.bloodinfo.net"
    ));
    private static final int IMPORT_FILE = 101, EXPORT_FILE = 102;
    private static final int MAX_EXPORT_BYTES = 5_000_000;
    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private byte[] pendingExport;
    private boolean exportBusy;
    private Toast exitToast;
    private Toast feedbackToast;
    private boolean exitToastVisible;
    private final Handler toastHandler = new Handler(Looper.getMainLooper());
    private Runnable exitTimeout;
    private CertificateImporter certificateImporter;
    private SecureStore secureStore;
    private final HolidayAccess holidayAccess = new HolidayAccess();
    private AlertDialog holidayConsent;
    private String holidayConsentId;
    private boolean resumed;
    private AppUpdater updater;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(244, 245, 239));
        setContentView(root);
        configureInsets(root);
        secureStore = new SecureStore(this);
        updater = new AppUpdater(this, () -> resumed && !isFinishing() && !isDestroyed());
        certificateImporter = new CertificateImporter(this, (phase, payload) -> {
            if (web != null && !isFinishing() && !isDestroyed())
                web.evaluateJavascript("if(window.bloodNoteCertificateEvent)window.bloodNoteCertificateEvent(" + JSONObject.quote(phase) + "," + payload + ");", null);
        });
        try {
            web = new WebView(this);
            root.addView(web, new FrameLayout.LayoutParams(-1, -1));
            configureWebView();
            String hash = state == null ? "" : state.getString("page", "");
            if (!hash.matches("(dashboard|planner|records|settings)?")) hash = "";
            web.loadUrl(HOME + (hash.isEmpty() ? "" : "#" + hash));
        } catch (RuntimeException error) {
            root.removeAllViews();
            TextView message = new TextView(this);
            message.setPadding(32, 64, 32, 32);
            message.setText("앱 화면을 열지 못했습니다. Android System WebView 또는 Chrome을 업데이트한 뒤 다시 열어 주세요.");
            root.addView(message);
        }
        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::handleBack);
        }
    }

    private void configureInsets(FrameLayout root) {
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) controller.setSystemBarsAppearance(
                WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS,
                WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
            root.setOnApplyWindowInsetsListener((view, insets) -> {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                android.graphics.Insets keyboard = insets.getInsets(WindowInsets.Type.ime());
                view.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, keyboard.bottom));
                return WindowInsets.CONSUMED;
            });
            root.requestApplyInsets();
        } else {
            getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        }
    }

    private void configureWebView() {
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true); // User-selected content:// backup only.
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        if (Build.VERSION.SDK_INT >= 33) settings.setAlgorithmicDarkeningAllowed(false);
        WebView.setWebContentsDebuggingEnabled(false);
        CookieManager.getInstance().setAcceptCookie(false);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        web.setBackgroundColor(Color.rgb(244, 245, 239));
        web.addJavascriptInterface(new NativeBridge(), "BloodNoteAndroid");
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (isLocal(uri)) {
                    String name = uri.getPath().substring("/assets/".length());
                    if (!"GET".equals(request.getMethod()) || !ASSETS.contains(name)) return blocked();
                    try {
                        Map<String, String> headers = new HashMap<>();
                        headers.put("Cache-Control", "no-store");
                        headers.put("X-Content-Type-Options", "nosniff");
                        headers.put("Referrer-Policy", "no-referrer");
                        headers.put("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src " + HOLIDAYS + "; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'");
                        return new WebResourceResponse(mime(name), "UTF-8", 200, "OK", headers, getAssets().open(name));
                    } catch (IOException error) { return blocked(); }
                }
                // No analytics, remote scripts, fonts, auto-sync, or other network resources.
                if (!request.isForMainFrame() && "GET".equals(request.getMethod()) && HOLIDAYS.equals(uri.toString())
                    && holidayAccess.consume(SystemClock.elapsedRealtime())) return null;
                return blocked();
            }

            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (isLocalDocument(request.getUrl())) return false;
                if (request.isForMainFrame() && request.hasGesture()) openExternal(request.getUrl().toString());
                return true;
            }

            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
                if (isLocalDocument(Uri.parse(url))) return false;
                openExternal(url);
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams parameters) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("*/*");
                intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"application/json", "text/plain", "application/octet-stream"});
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, false);
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                try { startActivityForResult(intent, IMPORT_FILE); }
                catch (ActivityNotFoundException error) {
                    fileCallback.onReceiveValue(null);
                    fileCallback = null;
                    message("파일 선택 앱을 찾을 수 없습니다.");
                }
                return true;
            }
        });
    }

    private static boolean isLocal(Uri uri) {
        return "https".equals(uri.getScheme()) && HOST.equals(uri.getHost()) && uri.getPort() == -1
            && uri.getUserInfo() == null && uri.getPath() != null && uri.getPath().startsWith("/assets/");
    }

    private static boolean isLocalDocument(Uri uri) {
        return isLocal(uri) && "/assets/index.html".equals(uri.getPath());
    }

    private static WebResourceResponse blocked() {
        return new WebResourceResponse("text/plain", "UTF-8", 403, "Blocked", new HashMap<>(), new ByteArrayInputStream(new byte[0]));
    }

    private static String mime(String name) {
        if (name.endsWith(".html")) return "text/html";
        if (name.endsWith(".mjs")) return "text/javascript";
        if (name.endsWith(".css")) return "text/css";
        if (name.endsWith(".svg")) return "image/svg+xml";
        if (name.endsWith(".png")) return "image/png";
        return "text/plain";
    }

    public final class NativeBridge {
        @JavascriptInterface public void saveText(String filename, String type, String text) {
            if (filename == null || type == null || text == null || text.length() > MAX_EXPORT_BYTES
                || !filename.matches("[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}")) {
                message("저장할 파일을 확인해 주세요."); return;
            }
            String contentType = type.split(";", 2)[0].trim().toLowerCase(Locale.ROOT);
            boolean valid = filename.endsWith(".json") && contentType.equals("application/json");
            try { valid &= "blood-note-encrypted-backup".equals(new JSONObject(text).optString("format")); }
            catch (Exception error) { valid = false; }
            byte[] data = text.getBytes(StandardCharsets.UTF_8);
            if (!valid || data.length > MAX_EXPORT_BYTES) { message("5MB 이하의 암호화 백업 파일만 저장할 수 있습니다."); return; }
            runOnUiThread(() -> beginExport(filename, contentType, data));
        }

        @JavascriptInterface public void openLink(String url) { runOnUiThread(() -> openExternal(url)); }
        @JavascriptInterface public void cancelExitHint() { runOnUiThread(MainActivity.this::resetExitHint); }
        @JavascriptInterface public void importCertificate() { runOnUiThread(() -> certificateImporter.choose()); }
        @JavascriptInterface public void requestAppUpdate() { runOnUiThread(() -> { resetExitHint(); updater.request(); }); }
        @JavascriptInterface public void cancelCertificateImport() { runOnUiThread(() -> certificateImporter.cancel()); }
        @JavascriptInterface public void requestHolidayConsent(String requestId) {
            if (requestId == null || !requestId.matches("[a-zA-Z0-9-]{1,64}")) return;
            runOnUiThread(() -> showHolidayConsent(requestId));
        }
        @JavascriptInterface public void finishHolidayRefresh(String requestId) { holidayAccess.finish(requestId); }
        @JavascriptInterface public String readSecureData() { return secureStore.read(); }
        @JavascriptInterface public String writeSecureData(String text) { return secureStore.write(text); }
        @JavascriptInterface public void clearLegacyStorage() {
            if (!secureStore.hasVerifiedData()) return;
            runOnUiThread(() -> {
                WebStorage.getInstance().deleteAllData();
                if (web != null) web.clearCache(true);
            });
        }
    }

    private void showHolidayConsent(String requestId) {
        if (!resumed || isFinishing() || isDestroyed()) { sendHolidayConsent(requestId, false); return; }
        if (holidayConsentId != null) {
            if (!holidayConsentId.equals(requestId)) sendHolidayConsent(requestId, false);
            return;
        }
        resetExitHint();
        holidayAccess.clear();
        holidayConsentId = requestId;
        holidayConsent = new AlertDialog.Builder(this)
            .setTitle("공휴일 갱신에 인터넷을 사용할까요?")
            .setMessage("이번 한 번만 인터넷에 연결해 최신 공휴일 자료를 가져옵니다. 데이터 요금이 발생할 수 있습니다.\n\n헌혈 기록이나 PDF는 전송하지 않습니다. 취소하면 저장된 공휴일 자료를 그대로 사용합니다.")
            .setNegativeButton("취소", (dialog, which) -> completeHolidayConsent(false))
            .setPositiveButton("이번만 허용", (dialog, which) -> completeHolidayConsent(true))
            .create();
        holidayConsent.setOnDismissListener(dialog -> {
            if (requestId.equals(holidayConsentId)) completeHolidayConsent(false);
        });
        holidayConsent.show();
    }

    private void completeHolidayConsent(boolean allowed) {
        String requestId = holidayConsentId;
        if (requestId == null) return;
        AlertDialog previous = holidayConsent;
        holidayConsent = null;
        holidayConsentId = null;
        if (previous != null) previous.dismiss();
        allowed = allowed && resumed && !isFinishing() && !isDestroyed();
        if (allowed) holidayAccess.approve(requestId, SystemClock.elapsedRealtime());
        else holidayAccess.clear();
        sendHolidayConsent(requestId, allowed);
    }

    private void sendHolidayConsent(String requestId, boolean allowed) {
        if (web != null && !isFinishing() && !isDestroyed())
            web.evaluateJavascript("if(window.bloodNoteHolidayConsent)window.bloodNoteHolidayConsent("
                + JSONObject.quote(requestId) + "," + allowed + ");", null);
    }

    private void beginExport(String name, String type, byte[] data) {
        if (isFinishing() || isDestroyed()) return;
        if (exportBusy) { message("진행 중인 파일 저장을 먼저 마쳐 주세요."); return; }
        pendingExport = data;
        exportBusy = true;
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(type);
        intent.putExtra(Intent.EXTRA_TITLE, name);
        intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        try { startActivityForResult(intent, EXPORT_FILE); }
        catch (ActivityNotFoundException error) {
            pendingExport = null;
            exportBusy = false;
            message("파일 저장 앱을 찾을 수 없습니다.");
        }
    }

    private void openExternal(String raw) {
        if (raw == null) return;
        Uri uri = Uri.parse(raw);
        if (!"https".equals(uri.getScheme()) || uri.getUserInfo() != null || uri.getPort() != -1
            || !EXTERNAL_HOSTS.contains(uri.getHost())) { message("열 수 없는 주소입니다."); return; }
        try { startActivity(new Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE)); }
        catch (ActivityNotFoundException error) { message("주소를 열 브라우저가 없습니다."); }
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent result) {
        super.onActivityResult(requestCode, resultCode, result);
        if (updater != null && updater.result(requestCode, resultCode)) return;
        Uri uri = resultCode == RESULT_OK && result != null ? result.getData() : null;
        boolean contentUri = uri != null && "content".equals(uri.getScheme());
        if (requestCode == CertificateImporter.PICK_PDF) {
            certificateImporter.selected(contentUri ? uri : null);
        } else if (requestCode == IMPORT_FILE) {
            if (fileCallback != null) {
                fileCallback.onReceiveValue(contentUri ? new Uri[]{uri} : null);
                fileCallback = null;
            }
        } else if (requestCode == EXPORT_FILE) {
            final byte[] data = pendingExport;
            pendingExport = null;
            if (!contentUri || data == null) {
                exportBusy = false;
                message(data == null && contentUri ? "앱이 다시 시작되어 저장을 완료하지 못했습니다. 다시 백업해 주세요." : "파일 저장을 취소했습니다.");
                return;
            }
            new Thread(() -> {
                boolean success = false;
                try (OutputStream out = getContentResolver().openOutputStream(uri, "wt")) {
                    if (out == null) throw new IOException("No output stream");
                    out.write(data);
                    out.flush();
                    success = true;
                } catch (IOException | SecurityException error) { success = false; }
                final boolean saved = success;
                runOnUiThread(() -> {
                    exportBusy = false;
                    message(saved ? "파일을 저장했습니다." : "파일을 저장하지 못했습니다. 저장 위치와 남은 공간을 확인해 주세요.");
                });
            }, "backup-writer").start();
        }
    }

    private void message(String text) {
        runOnUiThread(() -> {
            if (isFinishing() || isDestroyed()) return;
            resetExitHint();
            if (feedbackToast != null) feedbackToast.cancel();
            feedbackToast = Toast.makeText(this, text, Toast.LENGTH_LONG);
            feedbackToast.show();
        });
    }

    private void handleBack() {
        if (holidayConsentId != null) { completeHolidayConsent(false); return; }
        // Honor a second back at the time it happens, before a WebView callback can be delayed.
        if (exitToastVisible) { backFromHome(); return; }
        if (web == null) { backFromHome(); return; }
        web.evaluateJavascript("(()=>{if(window.bloodNoteHandleBack)return window.bloodNoteHandleBack();const dialog=document.querySelector('dialog[open]');if(dialog){dialog.close();return true;}return false;})()",
            handled -> { if ("true".equals(handled)) resetExitHint(); else backFromHome(); });
    }

    private void backFromHome() {
        if (isFinishing() || isDestroyed()) return;
        if (exitToastVisible) {
            resetExitHint();
            finish();
            return;
        }
        // Avoid queuing repeated toasts while Android is preparing the first one.
        if (exitToast != null) return;
        if (feedbackToast != null) { feedbackToast.cancel(); feedbackToast = null; }
        final Toast hint = Toast.makeText(this, "한 번 더 뒤로가기를 하면 앱이 종료됩니다", Toast.LENGTH_LONG);
        exitToast = hint;
        if (Build.VERSION.SDK_INT >= 30) {
            hint.addCallback(new Toast.Callback() {
                @Override public void onToastShown() {
                    if (exitToast != hint) return;
                    if (exitTimeout != null) toastHandler.removeCallbacks(exitTimeout);
                    exitTimeout = null;
                    exitToastVisible = true;
                }
                @Override public void onToastHidden() {
                    if (exitToast == hint) resetExitHint();
                }
            });
            // A blocked toast has no callbacks and must never arm invisible exit.
            exitTimeout = () -> { if (exitToast == hint && !exitToastVisible) resetExitHint(); };
            toastHandler.postDelayed(exitTimeout, 5000);
        } else {
            // Android 8–10 has no Toast callbacks; bound the toast and exit window together.
            int duration = 3500;
            if (Build.VERSION.SDK_INT >= 29) {
                AccessibilityManager accessibility = (AccessibilityManager) getSystemService(ACCESSIBILITY_SERVICE);
                if (accessibility != null) duration = accessibility.getRecommendedTimeoutMillis(duration, AccessibilityManager.FLAG_CONTENT_TEXT);
            }
            exitToastVisible = true;
            exitTimeout = () -> { if (exitToast == hint) resetExitHint(); };
            toastHandler.postDelayed(exitTimeout, duration);
        }
        hint.show();
    }

    private void resetExitHint() {
        if (exitTimeout != null) toastHandler.removeCallbacks(exitTimeout);
        exitTimeout = null;
        exitToastVisible = false;
        Toast previous = exitToast;
        exitToast = null;
        if (previous != null) previous.cancel();
    }

    @Override public void onBackPressed() { handleBack(); }
    @Override protected void onResume() {
        super.onResume();
        resumed = true;
        if (updater != null) updater.resume();
        if (web != null) {
            web.onResume();
            web.evaluateJavascript("if(typeof window.bloodNoteRefreshDay==='function')window.bloodNoteRefreshDay();", null);
        }
    }
    @Override protected void onPause() {
        resumed = false;
        if (updater != null) updater.pause();
        completeHolidayConsent(false);
        holidayAccess.clear();
        resetExitHint();
        if (feedbackToast != null) { feedbackToast.cancel(); feedbackToast = null; }
        if (web != null) web.onPause();
        super.onPause();
    }
    @Override protected void onSaveInstanceState(Bundle out) {
        if (web != null && web.getUrl() != null) {
            String fragment = Uri.parse(web.getUrl()).getFragment();
            if (fragment != null) out.putString("page", fragment);
        }
        super.onSaveInstanceState(out);
    }
    @Override protected void onDestroy() {
        resumed = false;
        if (updater != null) updater.destroy();
        completeHolidayConsent(false);
        holidayAccess.clear();
        if (certificateImporter != null) certificateImporter.cancel();
        resetExitHint();
        if (feedbackToast != null) feedbackToast.cancel();
        if (fileCallback != null) { fileCallback.onReceiveValue(null); fileCallback = null; }
        if (web != null) { web.removeJavascriptInterface("BloodNoteAndroid"); web.destroy(); web = null; }
        pendingExport = null;
        super.onDestroy();
    }
}
