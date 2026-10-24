import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { decryptApiKey, encryptApiKey, parseEncryptionKey } from "../../src/tenants/crypto.js";

const KEY_B64 = Buffer.alloc(32, 7).toString("base64");
const KEY_HEX = Buffer.alloc(32, 9).toString("hex");

describe("tenant API key encryption", () => {
  it("round-trips a key and keeps the plaintext out of the ciphertext", () => {
    const key = parseEncryptionKey(KEY_B64);
    const plaintext = "pit-live-secret-token";
    const payload = encryptApiKey(plaintext, key);
    expect(payload.startsWith("v1:")).toBe(true);
    expect(payload).not.toContain(plaintext);
    expect(decryptApiKey(payload, key)).toBe(plaintext);
  });

  it("accepts a 64-character hex key", () => {
    const key = parseEncryptionKey(KEY_HEX);
    expect(decryptApiKey(encryptApiKey("abc", key), key)).toBe("abc");
  });

  it("rejects a short key, a tampered payload, and the wrong key", () => {
    expect(() => parseEncryptionKey("aGVsbG8=")).toThrow(/32 bytes/);
    const key = parseEncryptionKey(KEY_B64);
    const other = parseEncryptionKey(KEY_HEX);
    const payload = encryptApiKey("abc", key);
    expect(() => decryptApiKey(payload, other)).toThrow();
    const parts = payload.split(":");
    const cipher = Buffer.from(parts[3] ?? "", "base64");
    cipher[0] = (cipher[0] ?? 0) ^ 0xff;
    parts[3] = cipher.toString("base64");
    expect(() => decryptApiKey(parts.join(":"), key)).toThrow();
  });

  it("encrypts from stdin without echoing the plaintext", () => {
    const result = spawnSync("node", ["scripts/encrypt-api-key.mjs"], {
      input: "pit-from-stdin",
      encoding: "utf8",
      env: { ...process.env, TENANT_KEY_ENCRYPTION_KEY: KEY_B64 },
    });
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("pit-from-stdin");
    expect(result.stderr).not.toContain("pit-from-stdin");
    expect(decryptApiKey(result.stdout.trim(), parseEncryptionKey(KEY_B64))).toBe("pit-from-stdin");
  });
});
