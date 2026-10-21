import { createCipheriv, createDecipheriv, hkdfSync, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { getEnv } from "./env";

/**
 * One configured secret (SESSION_SECRET) is stretched into a separate key per
 * purpose, so a signature made for one job can never be replayed for another.
 * Rotating SESSION_SECRET therefore signs everyone out and makes any stored
 * webhook URL unreadable (re-enter it in Settings).
 */
export function deriveKey(purpose: string): Buffer {
  return Buffer.from(hkdfSync("sha256", getEnv().SESSION_SECRET, "voidsuggest/v1", purpose, 32));
}

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey("secret-box"), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", b64url(iv), b64url(cipher.getAuthTag()), b64url(ct)].join(".");
}

/** Returns null if the value is malformed, tampered with, or the key changed. */
export function decryptSecret(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", deriveKey("secret-box"), Buffer.from(parts[1]!, "base64url"));
    decipher.setAuthTag(Buffer.from(parts[2]!, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(parts[3]!, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

// Crockford base32 without the easily-confused characters.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Random, non-sequential id for URLs. 8 characters is about 10^12 possibilities. */
export function randomPublicId(length = 8): string {
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}
