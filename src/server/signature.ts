import { createPublicKey, verify, type KeyObject } from "node:crypto";
import { getEnv } from "./env";

/**
 * Checks that a request really came from Discord.
 *
 * Discord signs every interaction (a click on a button, for example) with the
 * application's Ed25519 key. The signature covers the timestamp header plus
 * the exact request body, so the body has to be checked as received, before
 * it is parsed. A request that fails is answered with 401 and nothing in it is
 * looked at.
 *
 * Requests whose timestamp is far from our clock are refused too, so a
 * captured request cannot be replayed later.
 */

// The fixed DER prefix of an Ed25519 public key; the 32 raw key bytes follow.
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
export const MAX_SKEW_SECONDS = 5 * 60;

let cached: { hex: string; key: KeyObject } | undefined;

function publicKey(): KeyObject | null {
  const hex = getEnv().DISCORD_PUBLIC_KEY;
  if (!hex) return null;
  if (cached?.hex === hex) return cached.key;
  const key = createPublicKey({ key: Buffer.concat([SPKI_PREFIX, Buffer.from(hex, "hex")]), format: "der", type: "spki" });
  cached = { hex, key };
  return key;
}

export function interactionsConfigured(): boolean {
  return publicKey() !== null;
}

export function verifyInteraction(headers: Headers, body: string, now = Date.now()): boolean {
  const key = publicKey();
  if (!key) return false;

  const signature = headers.get("x-signature-ed25519");
  const timestamp = headers.get("x-signature-timestamp");
  if (!signature || !timestamp) return false;
  if (!/^[0-9a-fA-F]{128}$/.test(signature) || !/^\d{9,12}$/.test(timestamp)) return false;
  if (Math.abs(now / 1000 - Number(timestamp)) > MAX_SKEW_SECONDS) return false;

  try {
    return verify(null, Buffer.from(timestamp + body), key, Buffer.from(signature, "hex"));
  } catch {
    return false;
  }
}
