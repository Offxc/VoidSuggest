import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { resetEnvForTests } from "@/server/env";
import type { ApiHandler } from "@/server/http";
import { GUILD_ID, MEMBER_ROLE } from "./mock-discord";

/**
 * Plays the part of Discord for the interactions endpoint: a real Ed25519 key
 * pair, with requests signed exactly as Discord signs them.
 */

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
/** Somebody else's key, for requests that claim to be from Discord but are not. */
const stranger = generateKeyPairSync("ed25519");
export const PUBLIC_KEY_HEX = publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("hex");

export function useInteractionKey(): void {
  process.env.DISCORD_PUBLIC_KEY = PUBLIC_KEY_HEX;
  resetEnvForTests();
}

export function removeInteractionKey(): void {
  delete process.env.DISCORD_PUBLIC_KEY;
  resetEnvForTests();
}

export interface SignOptions {
  /** Seconds since the epoch. Default: now. */
  timestamp?: number;
  /** Change the body after signing. */
  tamper?: (body: string) => string;
  /** Leave the signature header out. */
  unsigned?: boolean;
  /** Sign with a key that isn't Discord's. */
  wrongKey?: boolean;
  /** The caller's address, as the proxy would report it. */
  ip?: string;
}

export async function signedCall(handler: ApiHandler, body: unknown, options: SignOptions = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  const timestamp = String(options.timestamp ?? Math.floor(Date.now() / 1000));
  const key: KeyObject = options.wrongKey ? stranger.privateKey : privateKey;
  const signature = sign(null, Buffer.from(timestamp + text), key).toString("hex");
  const headers = new Headers({ "content-type": "application/json", "x-forwarded-for": options.ip ?? "203.0.113.50" });
  if (!options.unsigned) {
    headers.set("x-signature-ed25519", signature);
    headers.set("x-signature-timestamp", timestamp);
  }
  const response = await handler(
    new Request("https://suggest.test/api/discord/interactions", {
      method: "POST",
      headers,
      body: options.tamper ? options.tamper(text) : text,
    }),
    { params: Promise.resolve({}) },
  );
  const raw = await response.text();
  let json: any = null;
  try {
    json = raw ? JSON.parse(raw) : null;
  } catch {
    /* not JSON */
  }
  return { status: response.status, json, text: raw };
}

let counter = 0;

export interface ClickOptions {
  /** The person's Discord ID, as the guild sees them. */
  discordId: string;
  roles?: string[];
  nick?: string | null;
  customId: string;
  guildId?: string;
  applicationId?: string;
  joinedDaysAgo?: number;
}

/** A button click, shaped like the payload Discord sends. */
export function buttonClick(options: ClickOptions) {
  counter += 1;
  return {
    id: String(800000000000000000n + BigInt(counter)),
    application_id: options.applicationId ?? "100000000000000001",
    type: 3,
    version: 1,
    token: "interaction-token",
    guild_id: options.guildId ?? GUILD_ID,
    channel_id: "900000000000000001",
    member: {
      user: { id: options.discordId, username: `user_${options.discordId.slice(-4)}`, global_name: "Global Name", avatar: null },
      roles: options.roles ?? [MEMBER_ROLE],
      nick: options.nick === undefined ? null : options.nick,
      avatar: null,
      joined_at: new Date(Date.now() - (options.joinedDaysAgo ?? 30) * 86_400_000).toISOString(),
      permissions: "0",
    },
    data: { custom_id: options.customId, component_type: 2 },
  };
}

export const ping = () => ({ id: "800000000000000000", application_id: "100000000000000001", type: 1, version: 1, token: "ping-token" });
