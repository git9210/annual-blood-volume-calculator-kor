package kr.bloodnote.app;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InterruptedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Comparator;

/** Pure Java tests: bounded metadata, fixed release destination, legacy cache migration. */
public final class UpdatePolicyTest {
    private static int checks;
    private interface Checked { void run() throws Exception; }
    private static void check(boolean condition) {
        checks++;
        if (!condition) throw new AssertionError("Check " + checks + " failed");
    }
    private static void rejects(Class<? extends Exception> type, Checked action) throws Exception {
        checks++;
        try { action.run(); } catch (Exception error) {
            if (type.isInstance(error)) return;
            throw new AssertionError("Wrong failure", error);
        }
        throw new AssertionError("Unsafe input was accepted");
    }
    public static void main(String[] args) throws Exception {
        check(UpdatePolicy.compareVersions("v2.10.0", "2.9.99") > 0);
        check(UpdatePolicy.compareVersions("3.0.0", "2.999.999") > 0);
        check(UpdatePolicy.compareVersions("2.2.0", "v2.2.0") == 0);
        check(UpdatePolicy.compareVersions("2.1.1", "2.2.0") < 0);
        for (String value : new String[]{null, "", "2.2", "2.2.0-beta", "2.2.0+build", "02.2.0", "2.-2.0", " 2.2.0", "2.2.0\n", "99999999999.0.0", "4.0.3/../../other", "4.0.3?x=1"})
            rejects(IllegalArgumentException.class, () -> UpdatePolicy.releasePage(value));
        String tag = "v4.0.3", name = UpdatePolicy.apkName(tag);
        String asset = UpdatePolicy.RELEASES + "/download/" + tag + "/" + name;
        check(name.equals("Annual-Blood-Volume-Calculator-4.0.3-Small.apk"));
        check(UpdatePolicy.releasePage(tag).equals("https://github.com/git9210/annual-blood-volume-calculator-kor/releases/tag/v4.0.3"));
        check(UpdatePolicy.releasePage("4.0.3").endsWith("/tag/4.0.3"));
        check(UpdatePolicy.validAsset(tag, name, asset, 1, "uploaded"));
        check(UpdatePolicy.validAsset(tag, name, asset, UpdatePolicy.MAX_APK, "uploaded"));
        for (long size : new long[]{-1, 0, UpdatePolicy.MAX_APK + 1, Long.MAX_VALUE})
            check(!UpdatePolicy.validAsset(tag, name, asset, size, "uploaded"));
        for (String state : new String[]{null, "", "new", "starter"})
            check(!UpdatePolicy.validAsset(tag, name, asset, 10, state));
        check(!UpdatePolicy.validAsset(tag, "Other.apk", asset, 10, "uploaded"));
        for (String url : new String[]{null, "file:///data/user/0/kr.bloodnote.app/files/records", "content://kr.bloodnote.app.updates/update.apk",
                asset.replace("https:", "http:"), asset.replace("github.com/", "github.com:443/"),
                asset.replace("github.com/", "github.com@evil.example/"), asset.replace("github.com/", "evil.example@github.com/"),
                asset.replace("git9210/", "someone-else/"), asset + "#fragment", asset + "?url=x", asset + "/../other.apk",
                asset.replace("/v4.0.3/", "/%2e%2e/"), "https://release-assets.githubusercontent.com/file",
                asset.replace("4.0.3-Small", "4.0.2-Small")})
            check(!UpdatePolicy.validAsset(tag, name, url, 10, "uploaded"));
        String text = "{\"name\":\"헌혈 계산기\"}";
        check(UpdatePolicy.readMetadata(new ByteArrayInputStream(text.getBytes(StandardCharsets.UTF_8)), () -> false).equals(text));
        check(UpdatePolicy.readMetadata(new ByteArrayInputStream(new byte[UpdatePolicy.MAX_METADATA]), () -> false).length() == UpdatePolicy.MAX_METADATA);
        rejects(IOException.class, () -> UpdatePolicy.readMetadata(new ByteArrayInputStream(new byte[UpdatePolicy.MAX_METADATA + 1]), () -> false));
        rejects(InterruptedIOException.class, () -> UpdatePolicy.readMetadata(new ByteArrayInputStream(new byte[10]), () -> true));
        Thread.currentThread().interrupt();
        try { rejects(InterruptedIOException.class, () -> UpdatePolicy.readMetadata(new ByteArrayInputStream(new byte[10]), () -> false)); }
        finally { Thread.interrupted(); }
        int[] polls = {0};
        rejects(InterruptedIOException.class, () -> UpdatePolicy.readMetadata(new ByteArrayInputStream(new byte[16384]), () -> ++polls[0] == 2));

        Path cache = Files.createTempDirectory("update-cache-policy-");
        try {
            UpdatePolicy.clearLegacyCache(cache.toFile());
            check(!Files.exists(cache.resolve("app-update")));
            Path dir = Files.createDirectory(cache.resolve("app-update"));
            Path apk = Files.writeString(dir.resolve("update.apk"), "legacy apk");
            Path part = Files.writeString(dir.resolve("53774965-0ba0-41cc-9111-9940ff834188.part"), "partial");
            Path records = Files.writeString(cache.resolve("records.enc"), "records unchanged");
            Path other = Files.writeString(dir.resolve("keep.txt"), "unrelated");
            Path nested = Files.createDirectory(dir.resolve("other"));
            Path nestedApk = Files.writeString(nested.resolve("update.apk"), "unrelated nested file");
            UpdatePolicy.clearLegacyCache(cache.toFile());
            check(!Files.exists(apk)); check(!Files.exists(part));
            check(Files.readString(records).equals("records unchanged"));
            check(Files.readString(other).equals("unrelated"));
            check(Files.exists(nestedApk)); check(Files.isDirectory(dir));
            Files.delete(nestedApk); Files.delete(nested); Files.delete(other);
            UpdatePolicy.clearLegacyCache(cache.toFile());
            check(!Files.exists(dir));
        } finally {
            try (var paths = Files.walk(cache)) {
                for (Path path : paths.sorted(Comparator.reverseOrder()).toList()) Files.deleteIfExists(path);
            }
        }
        System.out.println("PASS: " + checks + " update metadata/cache policy checks.");
    }
}
