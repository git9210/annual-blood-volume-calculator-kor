package kr.bloodnote.app;

import java.io.IOException;
import java.io.InputStream;
import java.io.InterruptedIOException;
import java.io.OutputStream;
import java.net.URI;
import java.security.MessageDigest;
import java.util.Locale;

/** Fixed update origin and bounded streaming; contains no UI, credentials or user data. */
final class UpdatePolicy {
    static final String REPOSITORY = "git9210/annual-blood-volume-calculator-kor";
    static final String API = "https://api.github.com/repos/" + REPOSITORY + "/releases/latest";
    static final String RELEASES = "https://github.com/" + REPOSITORY + "/releases";
    static final long MAX_APK = 32L * 1024 * 1024;
    static final int MAX_METADATA = 512 * 1024;

    static String version(String value) {
        if (value == null || !value.matches("v?(0|[1-9][0-9]{0,5})\\.(0|[1-9][0-9]{0,5})\\.(0|[1-9][0-9]{0,5})"))
            throw new IllegalArgumentException("배포 버전 형식을 확인할 수 없습니다.");
        return value.startsWith("v") ? value.substring(1) : value;
    }

    static int compareVersions(String left, String right) {
        String[] a = version(left).split("\\."), b = version(right).split("\\.");
        for (int i = 0; i < 3; i++) {
            int order = Integer.compare(Integer.parseInt(a[i]), Integer.parseInt(b[i]));
            if (order != 0) return order;
        }
        return 0;
    }

    static String apkName(String version) { return "Annual-Blood-Volume-Calculator-" + version(version) + "-Small.apk"; }

    static boolean allowed(String raw, boolean metadata) {
        try {
            URI uri = new URI(raw);
            if (!"https".equals(uri.getScheme()) || uri.getPort() != -1 || uri.getUserInfo() != null || uri.getFragment() != null) return false;
            if (metadata) return API.equals(raw);
            String host = uri.getHost(), path = uri.getRawPath();
            if ("github.com".equals(host))
                return uri.getRawQuery() == null && path != null && path.startsWith("/" + REPOSITORY + "/releases/download/")
                    && !path.contains("..") && !path.contains("%");
            return ("release-assets.githubusercontent.com".equals(host) || "objects.githubusercontent.com".equals(host))
                && path != null && path.startsWith("/") && !path.contains("..");
        } catch (Exception invalid) { return false; }
    }

    interface Transfer {
        boolean cancelled();
        void progress(long bytes);
    }

    static String copy(InputStream in, OutputStream out, long limit, long expected, Transfer transfer) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] buffer = new byte[32 * 1024];
        long total = 0;
        while (true) {
            if (transfer.cancelled() || Thread.currentThread().isInterrupted()) throw new InterruptedIOException("취소했습니다.");
            int count = in.read(buffer);
            if (count == -1) break;
            total += count;
            if (total > limit || (expected >= 0 && total > expected)) throw new IOException("파일 크기가 안내된 값과 다르거나 허용 범위를 넘었습니다.");
            out.write(buffer, 0, count);
            digest.update(buffer, 0, count);
            transfer.progress(total);
        }
        if (expected >= 0 && total != expected) throw new IOException("APK를 끝까지 받지 못했습니다. 다시 시도해 주세요.");
        StringBuilder hex = new StringBuilder();
        for (byte b : digest.digest()) hex.append(String.format(Locale.ROOT, "%02x", b & 255));
        return hex.toString();
    }

    static void checkIdentity(String packageName, String expectedPackage, String apkVersion, String releaseVersion,
                              long apkCode, long installedCode, boolean sameSignature) throws IOException {
        if (!expectedPackage.equals(packageName) || !version(releaseVersion).equals(apkVersion)
                || apkCode <= installedCode || !sameSignature)
            throw new IOException("앱 이름표·버전 또는 서명이 맞지 않아 설치를 중단했습니다. 기존 앱과 기록은 유지됩니다.");
    }
}
