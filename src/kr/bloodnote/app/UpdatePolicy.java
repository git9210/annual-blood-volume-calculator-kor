package kr.bloodnote.app;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.InterruptedIOException;
import java.nio.charset.StandardCharsets;
import java.util.function.BooleanSupplier;

/** Bounded release metadata and a fixed public repository; no APK download/install. */
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

    static String apkName(String tag) { return "Annual-Blood-Volume-Calculator-" + version(tag) + "-Small.apk"; }
    static String releasePage(String tag) { version(tag); return RELEASES + "/tag/" + tag; }

    static boolean validAsset(String tag, String name, String url, long size, String state) {
        String expectedName = apkName(tag);
        return expectedName.equals(name) && size > 0 && size <= MAX_APK && "uploaded".equals(state)
            && (RELEASES + "/download/" + tag + "/" + expectedName).equals(url);
    }

    static String readMetadata(InputStream in, BooleanSupplier cancelled) throws IOException {
        try (ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            while (true) {
                if (cancelled.getAsBoolean() || Thread.currentThread().isInterrupted())
                    throw new InterruptedIOException("취소했습니다.");
                int count = in.read(buffer);
                if (count == -1) break;
                if (out.size() + count > MAX_METADATA) throw new IOException("배포 정보가 너무 큽니다.");
                out.write(buffer, 0, count);
            }
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    // Older versions downloaded here. This version never writes or installs an APK.
    static void clearLegacyCache(File cache) {
        File directory = new File(cache, "app-update");
        File[] files = directory.listFiles();
        if (files == null) return;
        for (File file : files) {
            String name = file.getName();
            if (file.isFile() && ("update.apk".equals(name)
                    || name.matches("[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}\\.part"))) file.delete();
        }
        directory.delete(); // Only succeeds if no unrelated entries remain.
    }
}
