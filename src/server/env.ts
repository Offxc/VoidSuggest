import { z } from "zod";

/**
 * Environment configuration, validated once on first use. Validation is lazy
 * so `next build` does not need real secrets; `instrumentation.ts` calls
 * `getEnv()` at server start so a bad configuration stops the process there
 * with a clear message instead of failing on the first request.
 */

const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const optional = <T extends z.ZodType>(schema: T) => z.preprocess(blankToUndefined, schema.optional());
const snowflake = z.string().regex(/^\d{5,25}$/, "must be a Discord ID (digits only)");

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.string().min(1, "is required"),
  SESSION_SECRET: z.string().min(32, "must be at least 32 characters"),
  SITE_URL: z.url("must be a full URL such as https://suggest.example.com"),
  DISCORD_CLIENT_ID: snowflake,
  DISCORD_CLIENT_SECRET: z.string().min(8, "is required"),
  DISCORD_BOT_TOKEN: z.string().min(20, "is required"),
  DISCORD_GUILD_ID: snowflake,
  OWNER_DISCORD_ID: optional(snowflake),
  CLIENT_IP_HEADER: z.preprocess(blankToUndefined, z.string().trim().toLowerCase().default("x-forwarded-for")),
  CONTACT_EMAIL: optional(z.email()),
  // Overridable so tests can point the server at a local stand-in for Discord.
  DISCORD_API_BASE: z.preprocess(blankToUndefined, z.url().default("https://discord.com/api/v10")),
  MEMBER_SYNC_MINUTES: z.preprocess(blankToUndefined, z.coerce.number().int().min(0).max(1440).default(15)),
});

export interface Env extends z.infer<typeof schema> {
  isProd: boolean;
  siteOrigin: string;
  redirectUri: string;
  /** Cookies get the Secure flag and the __Host- prefix when the site is served over https. */
  secureCookies: boolean;
}

let cached: Env | undefined;

export function getEnv(): Env {
  if (cached) return cached;

  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".") || "env"}: ${i.message}`);
    // Names and reasons only, never the values.
    throw new Error(`Invalid environment configuration.\n  - ${problems.join("\n  - ")}\nSee .env.example.`);
  }

  const env = parsed.data;
  const site = new URL(env.SITE_URL);
  const isLocalhost = site.hostname === "localhost" || site.hostname === "127.0.0.1";
  if (env.NODE_ENV === "production" && site.protocol !== "https:" && !isLocalhost) {
    throw new Error("Invalid environment configuration.\n  - SITE_URL: must use https:// in production");
  }

  cached = {
    ...env,
    isProd: env.NODE_ENV === "production",
    siteOrigin: site.origin,
    redirectUri: `${site.origin}/api/auth/callback`,
    secureCookies: site.protocol === "https:",
  };
  return cached;
}

/** Test hook: forget the cached configuration so changed process.env is re-read. */
export function resetEnvForTests(): void {
  cached = undefined;
}
