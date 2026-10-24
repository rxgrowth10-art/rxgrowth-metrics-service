import { createCipheriv, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

const rawKey = process.env.TENANT_ENCRYPTION_KEY;
if (!rawKey || !rawKey.trim()) {
  process.stderr.write("TENANT_ENCRYPTION_KEY is not set\n");
  process.exit(1);
}

function parseKey(raw) {
  const trimmed = raw.trim();
  const key = /^[0-9a-fA-F]{64}$/.test(trimmed)
    ? Buffer.from(trimmed, "hex")
    : Buffer.from(trimmed, "base64");
  if (key.length !== 32) {
    throw new Error("TENANT_ENCRYPTION_KEY must decode to 32 bytes");
  }
  return key;
}

const plaintext = readFileSync(0, "utf8").replace(/\r?\n$/, "");
if (!plaintext) {
  process.stderr.write("Pass the GoHighLevel API key on stdin\n");
  process.exit(1);
}

const key = parseKey(rawKey);
const iv = randomBytes(12);
const cipher = createCipheriv("aes-256-gcm", key, iv);
const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
const tag = cipher.getAuthTag();
const payload = ["v1", iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(
  ":",
);
process.stdout.write(`${payload}\n`);
