package kr.bloodnote.app;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.util.Arrays;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;

public final class VaultCryptoTest {
    private static int checks;
    private static void check(boolean condition) { checks++; if (!condition) throw new AssertionError(); }
    private static void rejects(SecretKey key, byte[] data) throws Exception {
        try { VaultCrypto.open(key, data); throw new AssertionError("Accepted tampered data"); }
        catch (GeneralSecurityException expected) { checks++; }
    }
    public static void main(String[] args) throws Exception {
        KeyGenerator generator = KeyGenerator.getInstance("AES");generator.init(256);
        SecretKey key = generator.generateKey();
        byte[] plaintext = "PRIVATE-RECORD-CANARY: 헌혈 기록·계획·설정".getBytes(StandardCharsets.UTF_8);
        byte[] first = VaultCrypto.seal(key, plaintext),second = VaultCrypto.seal(key, plaintext);
        check(Arrays.equals(VaultCrypto.open(key, first), plaintext));
        check(!Arrays.equals(first, second));
        check(!new String(first, StandardCharsets.UTF_8).contains("PRIVATE-RECORD-CANARY"));
        rejects(generator.generateKey(), first);
        for (int index : new int[]{0, 4, 16, first.length - 1}) {
            byte[] altered = first.clone();altered[index] ^= 1;rejects(key, altered);
        }
        rejects(key, Arrays.copyOf(first, first.length - 1));
        rejects(key, new byte[0]);
        byte[] large = new byte[240000];Arrays.fill(large, (byte) 42);
        check(Arrays.equals(VaultCrypto.open(key, VaultCrypto.seal(key, large)), large));
        System.out.println("PASS: " + checks + " AES-256-GCM roundtrip, random IV, tamper, wrong-key and large-history checks. Android Keystore itself requires device testing.");
    }
}
