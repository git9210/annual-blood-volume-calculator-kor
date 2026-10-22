package kr.bloodnote.app;

import java.security.GeneralSecurityException;
import java.util.Arrays;
import javax.crypto.Cipher;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Versioned AES-256-GCM envelope; keys are supplied by Android Keystore. */
final class VaultCrypto {
    static final int MAX_BYTES = 5_000_000;
    private static final byte[] HEADER = {'B', 'N', 'V', '1'};
    static byte[] seal(SecretKey key, byte[] plaintext) throws GeneralSecurityException {
        if (plaintext.length > MAX_BYTES) throw new GeneralSecurityException("Too large");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        // The provider creates a fresh random IV, including for non-exportable Keystore keys.
        cipher.init(Cipher.ENCRYPT_MODE, key);
        cipher.updateAAD(HEADER);
        byte[] iv = cipher.getIV(), encrypted = cipher.doFinal(plaintext);
        if (iv.length != 12) throw new GeneralSecurityException("Invalid IV");
        byte[] result = new byte[16 + encrypted.length];
        System.arraycopy(HEADER, 0, result, 0, 4);
        System.arraycopy(iv, 0, result, 4, 12);
        System.arraycopy(encrypted, 0, result, 16, encrypted.length);
        return result;
    }
    static byte[] open(SecretKey key, byte[] envelope) throws GeneralSecurityException {
        if (envelope.length < 32 || envelope.length > MAX_BYTES + 32
            || !Arrays.equals(HEADER, Arrays.copyOfRange(envelope, 0, 4)))
            throw new GeneralSecurityException("Invalid envelope");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, envelope, 4, 12));
        cipher.updateAAD(HEADER);
        return cipher.doFinal(envelope, 16, envelope.length - 16);
    }
}
