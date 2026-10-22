package kr.bloodnote.app;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InterruptedIOException;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;

/** No network or Android runtime needed: tests the updater's security boundaries. */
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
    private static final UpdatePolicy.Transfer CONTINUE = new UpdatePolicy.Transfer() {
        public boolean cancelled() { return false; }
        public void progress(long bytes) { }
    };
    public static void main(String[] args) throws Exception {
        check(UpdatePolicy.compareVersions("v2.10.0", "2.9.99") > 0);
        check(UpdatePolicy.compareVersions("3.0.0", "2.999.999") > 0);
        check(UpdatePolicy.compareVersions("2.2.0", "v2.2.0") == 0);
        check(UpdatePolicy.compareVersions("2.1.1", "2.2.0") < 0);
        check(UpdatePolicy.apkName("v2.2.0").equals("Annual-Blood-Volume-Calculator-2.2.0-Small.apk"));
        for (String value : new String[]{null, "", "2.2", "2.2.0-beta", "2.2.0+build", "02.2.0", "2.-2.0", " 2.2.0", "2.2.0\n", "99999999999.0.0"})
            rejects(IllegalArgumentException.class, () -> UpdatePolicy.version(value));

        String asset = "https://github.com/" + UpdatePolicy.REPOSITORY + "/releases/download/v2.2.0/" + UpdatePolicy.apkName("2.2.0");
        check(UpdatePolicy.allowed(UpdatePolicy.API, true));
        check(!UpdatePolicy.allowed(UpdatePolicy.API + "?token=x", true));
        check(!UpdatePolicy.allowed(asset, true));
        check(UpdatePolicy.allowed(asset, false));
        check(UpdatePolicy.allowed("https://release-assets.githubusercontent.com/github-production-release-asset/123/file?sig=example", false));
        check(UpdatePolicy.allowed("https://objects.githubusercontent.com/github-production-release-asset/123/file?sig=example", false));
        for (String url : new String[]{null, "file:///data/user/0/kr.bloodnote.app/files/records", "content://kr.bloodnote.app.updates/update.apk",
                asset.replace("https:", "http:"), asset.replace("github.com/", "github.com:443/"),
                asset.replace("github.com/", "github.com@evil.example/"), asset.replace("github.com/", "evil.example@github.com/"),
                asset.replace("git9210/", "someone-else/"), asset + "#fragment", asset + "?url=x", asset + "/../other.apk",
                asset.replace("/v2.2.0/", "/%2e%2e/"), "https://release-assets.githubusercontent.com.evil.example/file",
                "https://raw.githubusercontent.com/git9210/annual-blood-volume-calculator-kor/main/app.apk",
                "https://api.github.com/repos/other/repo/releases/latest", "https://objects.githubusercontent.com/../file"})
            check(!UpdatePolicy.allowed(url, false));

        byte[] abc = "abc".getBytes(StandardCharsets.UTF_8);
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        check(UpdatePolicy.copy(new ByteArrayInputStream(abc), out, 3, 3, CONTINUE)
            .equals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"));
        check(Arrays.equals(abc, out.toByteArray()));
        rejects(IOException.class, () -> UpdatePolicy.copy(new ByteArrayInputStream(abc), new ByteArrayOutputStream(), 2, -1, CONTINUE));
        rejects(IOException.class, () -> UpdatePolicy.copy(new ByteArrayInputStream(abc), new ByteArrayOutputStream(), 100, 2, CONTINUE));
        rejects(IOException.class, () -> UpdatePolicy.copy(new ByteArrayInputStream(abc), new ByteArrayOutputStream(), 100, 4, CONTINUE));
        rejects(IOException.class, () -> UpdatePolicy.copy(new ByteArrayInputStream(new byte[0]), new ByteArrayOutputStream(), 100, 3, CONTINUE));
        byte[] large = new byte[96 * 1024];
        ByteArrayOutputStream cancelledOut = new ByteArrayOutputStream();
        rejects(InterruptedIOException.class, () -> UpdatePolicy.copy(new ByteArrayInputStream(large), cancelledOut, large.length, large.length,
            new UpdatePolicy.Transfer() {
                boolean cancel;
                public boolean cancelled() { return cancel; }
                public void progress(long bytes) { cancel = true; }
            }));
        check(cancelledOut.size() == 32 * 1024);
        Thread.currentThread().interrupt();
        try {
            rejects(InterruptedIOException.class, () -> UpdatePolicy.copy(new ByteArrayInputStream(abc), new ByteArrayOutputStream(), 100, 3, CONTINUE));
        } finally { Thread.interrupted(); }
        long[] progress = {0};
        ByteArrayOutputStream complete = new ByteArrayOutputStream();
        UpdatePolicy.copy(new ByteArrayInputStream(large), complete, large.length, large.length, new UpdatePolicy.Transfer() {
            public boolean cancelled() { return false; }
            public void progress(long bytes) { check(bytes > progress[0] && bytes - progress[0] <= 32 * 1024); progress[0] = bytes; }
        });
        check(progress[0] == large.length && complete.size() == large.length);

        UpdatePolicy.checkIdentity("kr.bloodnote.app", "kr.bloodnote.app", "2.2.0", "v2.2.0", 18, 17, true);
        rejects(IOException.class, () -> UpdatePolicy.checkIdentity("kr.other.app", "kr.bloodnote.app", "2.2.0", "2.2.0", 18, 17, true));
        rejects(IOException.class, () -> UpdatePolicy.checkIdentity("kr.bloodnote.app", "kr.bloodnote.app", "2.2.0", "2.2.0", 18, 17, false));
        rejects(IOException.class, () -> UpdatePolicy.checkIdentity("kr.bloodnote.app", "kr.bloodnote.app", "2.2.0", "2.2.0", 17, 17, true));
        rejects(IOException.class, () -> UpdatePolicy.checkIdentity("kr.bloodnote.app", "kr.bloodnote.app", "2.2.0", "2.2.0", 16, 17, true));
        rejects(IOException.class, () -> UpdatePolicy.checkIdentity("kr.bloodnote.app", "kr.bloodnote.app", "2.1.1", "2.2.0", 18, 17, true));
        System.out.println("PASS: " + checks + " update policy checks (versions, origins, bounded download, hash, cancellation, identity).");
    }
}
