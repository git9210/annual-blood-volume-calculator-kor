package kr.bloodnote.app;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.AtomicFile;
import java.io.File;
import java.io.FileOutputStream;
import java.security.KeyStore;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import org.json.JSONObject;

/** All calls run on the WebView bridge thread, not Android's main UI thread. */
final class SecureStore {
    private static final String ALIAS = "blood-note-vault-aes256-v1";
    private final File path;
    private final AtomicFile file;
    private boolean writable, verified;
    SecureStore(Context context) {
        path = new File(context.getNoBackupFilesDir(), "blood-note.vault");
        file = new AtomicFile(path);
    }
    private boolean exists() { return path.exists() || new File(path.getPath() + ".bak").exists(); }
    private SecretKey key(boolean create) throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.containsAlias(ALIAS)) return (SecretKey) store.getKey(ALIAS, null);
        if (!create || exists()) throw new IllegalStateException("Key unavailable");
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setKeySize(256).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true).build());
        return generator.generateKey();
    }
    synchronized String read() {
        byte[] plaintext = null;
        try {
            if (!exists()) { writable = true; return "{\"ok\":true,\"data\":null}"; }
            if (Math.max(path.length(), new File(path.getPath() + ".bak").length()) > VaultCrypto.MAX_BYTES + 32)
                throw new IllegalStateException("Too large");
            plaintext = VaultCrypto.open(key(false), file.readFully());
            String text = new String(plaintext, StandardCharsets.UTF_8);
            new JSONObject(text);
            writable = true; verified = true;
            return "{\"ok\":true,\"data\":" + JSONObject.quote(text) + "}";
        } catch (Exception error) {
            writable = false; verified = false;
            return "{\"ok\":false}";
        } finally { if (plaintext != null) Arrays.fill(plaintext, (byte) 0); }
    }
    synchronized String write(String text) {
        byte[] plaintext = null;
        FileOutputStream output = null;
        try {
            if (!writable || text == null || text.length() > VaultCrypto.MAX_BYTES) throw new IllegalStateException();
            JSONObject data = new JSONObject(text);
            if (data.getInt("version") != 1 || !(data.get("values") instanceof JSONObject)) throw new IllegalArgumentException();
            plaintext = text.getBytes(StandardCharsets.UTF_8);
            byte[] encrypted = VaultCrypto.seal(key(true), plaintext);
            output = file.startWrite();
            output.write(encrypted);
            file.finishWrite(output);
            output = null;
            if (!Arrays.equals(encrypted, file.readFully())) throw new IllegalStateException("Write verification failed");
            verified = true;
            return "{\"ok\":true}";
        } catch (Exception error) {
            if (output != null) file.failWrite(output);
            return "{\"ok\":false}";
        } finally { if (plaintext != null) Arrays.fill(plaintext, (byte) 0); }
    }
    synchronized boolean hasVerifiedData() { return verified && exists(); }
}
