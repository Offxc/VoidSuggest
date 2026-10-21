import { z } from "zod";
import { cleanLine } from "../shared/text";
import { getEnv } from "./env";

/**
 * Everything that talks to Discord. Responses from Discord are validated
 * before use rather than trusted, and every call has a timeout so a slow or
 * unreachable Discord cannot hold requests open.
 */

const snowflake = z.string().regex(/^\d{5,25}$/);
const REQUEST_TIMEOUT_MS = 8_000;

export class DiscordError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "DiscordError";
  }
}

type Auth = { bot: true } | { bearer: string } | { none: true };

async function request(
  path: string,
  init: { method?: string; body?: BodyInit; headers?: Record<string, string> } = {},
  auth: Auth,
  retriesLeft = 1,
): Promise<Response> {
  const env = getEnv();
  const headers: Record<string, string> = {
    "User-Agent": "DiscordBot (https://github.com/Offxc/VoidSuggest, 0.1.0)",
    ...init.headers,
  };
  if ("bot" in auth) headers.Authorization = `Bot ${env.DISCORD_BOT_TOKEN}`;
  if ("bearer" in auth) headers.Authorization = `Bearer ${auth.bearer}`;

  let res: Response;
  try {
    res = await fetch(`${env.DISCORD_API_BASE}${path}`, {
      method: init.method ?? "GET",
      headers,
      body: init.body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      redirect: "error",
      cache: "no-store",
    });
  } catch {
    throw new DiscordError("Discord could not be reached", 0);
  }

  if (res.status === 429 && retriesLeft > 0) {
    const wait = Math.min(Number(res.headers.get("retry-after")) || 1, 5);
    await new Promise((resolve) => setTimeout(resolve, wait * 1000));
    return request(path, init, auth, retriesLeft - 1);
  }
  return res;
}

// ── Sign-in ──────────────────────────────────────────────────────────

export function buildAuthorizeUrl(params: { state: string; challenge: string }): string {
  const env = getEnv();
  const url = new URL("https://discord.com/oauth2/authorize");
  url.searchParams.set("client_id", env.DISCORD_CLIENT_ID);
  url.searchParams.set("redirect_uri", env.redirectUri);
  url.searchParams.set("response_type", "code");
  // Identity only. Roles and nickname come from the bot, not from the user's token.
  url.searchParams.set("scope", "identify");
  url.searchParams.set("state", params.state);
  url.searchParams.set("code_challenge", params.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

const tokenSchema = z.object({ access_token: z.string().min(1) });

/** Trades the one-time code for an access token. The token is used once and never stored. */
export async function exchangeCode(code: string, verifier: string): Promise<string> {
  const env = getEnv();
  const res = await request(
    "/oauth2/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.DISCORD_CLIENT_ID,
        client_secret: env.DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: env.redirectUri,
        code_verifier: verifier,
      }),
    },
    { none: true },
  );
  if (!res.ok) throw new DiscordError("Discord rejected the sign-in code", res.status);
  const parsed = tokenSchema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) throw new DiscordError("Unexpected response from Discord", 502);
  return parsed.data.access_token;
}

const selfSchema = z.object({ id: snowflake });

export async function fetchSelfId(accessToken: string): Promise<string> {
  const res = await request("/users/@me", {}, { bearer: accessToken });
  if (!res.ok) throw new DiscordError("Could not read your Discord account", res.status);
  const parsed = selfSchema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) throw new DiscordError("Unexpected response from Discord", 502);
  return parsed.data.id;
}

// ── Server members ───────────────────────────────────────────────────

const avatarHash = z
  .string()
  .regex(/^(a_)?[0-9a-f]{1,40}$/)
  .nullable()
  .optional()
  .catch(null);

const memberSchema = z.object({
  user: z.object({
    id: snowflake,
    username: z.string().min(1).max(100),
    global_name: z.string().max(100).nullable().optional(),
    avatar: avatarHash,
  }),
  nick: z.string().max(100).nullable().optional(),
  avatar: avatarHash,
  roles: z.array(snowflake).max(300),
  joined_at: z.string().nullable().optional(),
});

export interface GuildMember {
  discordId: string;
  username: string;
  globalName: string | null;
  nick: string | null;
  /** What the site shows: server nickname, then display name, then handle. */
  displayName: string;
  avatarHash: string | null;
  guildAvatarHash: string | null;
  roles: string[];
  joinedAt: Date | null;
}

function normaliseMember(raw: z.infer<typeof memberSchema>): GuildMember {
  const username = cleanLine(raw.user.username).slice(0, 64) || raw.user.id;
  const globalName = raw.user.global_name ? cleanLine(raw.user.global_name).slice(0, 64) || null : null;
  const nick = raw.nick ? cleanLine(raw.nick).slice(0, 64) || null : null;
  const joined = raw.joined_at ? new Date(raw.joined_at) : null;
  return {
    discordId: raw.user.id,
    username,
    globalName,
    nick,
    displayName: nick ?? globalName ?? username,
    avatarHash: raw.user.avatar ?? null,
    guildAvatarHash: raw.avatar ?? null,
    roles: raw.roles,
    joinedAt: joined && !Number.isNaN(joined.getTime()) ? joined : null,
  };
}

/** The member's details in the configured server, or null if they are not in it. */
export async function fetchGuildMember(discordId: string): Promise<GuildMember | null> {
  const guild = getEnv().DISCORD_GUILD_ID;
  const res = await request(`/guilds/${guild}/members/${encodeURIComponent(discordId)}`, {}, { bot: true });
  if (res.status === 404) return null;
  if (!res.ok) throw new DiscordError("Could not read the Discord server", res.status);
  const parsed = memberSchema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) throw new DiscordError("Unexpected response from Discord", 502);
  return normaliseMember(parsed.data);
}

const userSchema = memberSchema.shape.user;

/**
 * A Discord account's public profile, shaped like a member with no roles.
 * Only used for an owner who isn't in the server, where there is no member
 * record to read a name from.
 */
export async function fetchUserProfile(discordId: string): Promise<GuildMember> {
  const res = await request(`/users/${encodeURIComponent(discordId)}`, {}, { bot: true });
  if (!res.ok) throw new DiscordError("Could not read that Discord account", res.status);
  const parsed = userSchema.safeParse(await res.json().catch(() => null));
  if (!parsed.success) throw new DiscordError("Unexpected response from Discord", 502);
  return normaliseMember({ user: parsed.data, roles: [], nick: null, avatar: null, joined_at: null });
}

/**
 * Every member of the server, in pages of 1000. Needs the bot's "Server
 * Members Intent" switched on in the Discord developer portal.
 */
export async function* listGuildMembers(): AsyncGenerator<GuildMember[]> {
  const guild = getEnv().DISCORD_GUILD_ID;
  let after = "0";
  for (let page = 0; page < 200; page++) {
    const res = await request(`/guilds/${guild}/members?limit=1000&after=${after}`, {}, { bot: true });
    if (!res.ok) throw new DiscordError("Could not list the Discord server's members", res.status);
    const json = await res.json().catch(() => null);
    const parsed = z.array(z.unknown()).safeParse(json);
    if (!parsed.success) throw new DiscordError("Unexpected response from Discord", 502);

    const members: GuildMember[] = [];
    for (const item of parsed.data) {
      const m = memberSchema.safeParse(item);
      if (m.success) members.push(normaliseMember(m.data));
    }
    if (members.length > 0) yield members;
    if (parsed.data.length < 1000) return;
    after = members.at(-1)?.discordId ?? after;
  }
}

const roleSchema = z.object({
  id: snowflake,
  name: z.string().max(100),
  position: z.number().int(),
  managed: z.boolean().optional(),
});

export interface GuildRole {
  id: string;
  name: string;
  position: number;
}

/** Roles that can be picked as the "Member" role. Excludes @everyone and bot-managed roles. */
export async function listGuildRoles(): Promise<GuildRole[]> {
  const guild = getEnv().DISCORD_GUILD_ID;
  const res = await request(`/guilds/${guild}/roles`, {}, { bot: true });
  if (!res.ok) throw new DiscordError("Could not read the Discord server's roles", res.status);
  const parsed = z.array(z.unknown()).safeParse(await res.json().catch(() => null));
  if (!parsed.success) throw new DiscordError("Unexpected response from Discord", 502);
  const roles: GuildRole[] = [];
  for (const item of parsed.data) {
    const r = roleSchema.safeParse(item);
    if (r.success && r.data.id !== guild && !r.data.managed) {
      roles.push({ id: r.data.id, name: cleanLine(r.data.name), position: r.data.position });
    }
  }
  return roles.sort((a, b) => b.position - a.position);
}

// ── Avatars ──────────────────────────────────────────────────────────

export const AVATAR_HOST = "https://cdn.discordapp.com";

/** Avatar image URL, built from stored hashes only. The host is fixed, never user-supplied. */
export function avatarUrl(user: {
  discordId: string;
  avatarHash: string | null;
  guildAvatarHash: string | null;
}): string {
  const guild = getEnv().DISCORD_GUILD_ID;
  if (user.guildAvatarHash) {
    return `${AVATAR_HOST}/guilds/${guild}/users/${user.discordId}/avatars/${user.guildAvatarHash}.png?size=64`;
  }
  if (user.avatarHash) {
    return `${AVATAR_HOST}/avatars/${user.discordId}/${user.avatarHash}.png?size=64`;
  }
  const index = Number((BigInt(user.discordId) >> BigInt(22)) % BigInt(6));
  return `${AVATAR_HOST}/embed/avatars/${index}.png`;
}

// ── Webhooks ─────────────────────────────────────────────────────────

const WEBHOOK_HOSTS = new Set(["discord.com", "discordapp.com", "canary.discord.com", "ptb.discord.com"]);

/**
 * Accepts only a genuine Discord webhook URL. Because the owner can enter any
 * text here and the server will POST to it, this is the guard against using
 * the feature to make the server call arbitrary addresses.
 */
export function parseWebhookUrl(input: string): string | null {
  try {
    const url = new URL(input.trim());
    if (url.protocol !== "https:" || !WEBHOOK_HOSTS.has(url.hostname)) return null;
    if (url.port || url.username || url.password || url.hash) return null;
    if (!/^\/api\/webhooks\/\d{5,25}\/[A-Za-z0-9_-]{20,120}$/.test(url.pathname)) return null;
    if (url.search && !/^\?(wait=true)?$/.test(url.search)) return null;
    return `${url.origin}${url.pathname}`;
  } catch {
    return null;
  }
}

export interface WebhookEmbed {
  title: string;
  url?: string;
  description?: string;
  color?: number;
  fields?: { name: string; value: string; inline?: boolean }[];
}

/** Posts one message. Mentions are always disabled so user text can never ping anyone. */
export async function sendWebhook(url: string, username: string, embed: WebhookEmbed): Promise<void> {
  const safe = parseWebhookUrl(url);
  if (!safe) throw new DiscordError("Not a valid Discord webhook URL", 400);
  let res: Response;
  try {
    res = await fetch(safe, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: username.slice(0, 80),
        allowed_mentions: { parse: [] },
        embeds: [embed],
      }),
      signal: AbortSignal.timeout(5_000),
      redirect: "error",
    });
  } catch {
    throw new DiscordError("Webhook could not be reached", 0);
  }
  if (!res.ok) throw new DiscordError("Discord rejected the webhook message", res.status);
}
