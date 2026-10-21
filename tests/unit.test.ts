import { afterEach, describe, expect, it } from "vitest";
import { sanitizeDetails, csvCell } from "@/server/audit";
import { decryptSecret, encryptSecret, randomPublicId, safeEqual } from "@/server/crypto";
import { avatarUrl, parseWebhookUrl } from "@/server/discord";
import { excerptOf } from "@/server/dto";
import { participationBlock } from "@/server/eligibility";
import { getEnv, resetEnvForTests } from "@/server/env";
import { clientIp, rateLimit, resetRateLimitsForTests } from "@/server/rate-limit";
import { cleanBlock, cleanLine, slugify } from "@/shared/text";
import { boardQuerySchema, createSuggestionSchema, settingsSchema, statusSchema } from "@/shared/schemas";

describe("text clean-up", () => {
  it("removes control characters and the invisible tricks used to spoof or hide text", () => {
    expect(cleanLine("  Hello\u0000\u0007 \u202eworld\u200b  ")).toBe("Hello world");
    expect(cleanLine("a\n\n  b\tc")).toBe("a b c");
    expect(cleanBlock("one\r\ntwo\n\n\n\n\nthree\u202e")).toBe("one\ntwo\n\nthree");
    expect(cleanLine("é")).toBe("é");
  });

  it("makes safe slugs", () => {
    expect(slugify("In Progress")).toBe("in-progress");
    expect(slugify("  Ünïcode / ../ tricks!! ")).toBe("unicode-tricks");
    expect(slugify("💥💥")).toBe("item");
    expect(slugify("x".repeat(100)).length).toBeLessThanOrEqual(40);
  });

  it("makes plain-text excerpts from markdown without links or formatting", () => {
    expect(excerptOf("**Bold** and [a link](http://evil.example) and `code`")).toBe("Bold and a link and code");
    expect(excerptOf("x".repeat(500), 50)).toHaveLength(50);
  });
});

describe("request schemas", () => {
  it("trims and cleans titles, and enforces length limits", () => {
    const ok = createSuggestionSchema.parse({ title: "  A good \u202etitle here  ", body: "x".repeat(30) });
    expect(ok.title).toBe("A good title here");
    expect(createSuggestionSchema.safeParse({ title: "short", body: "x".repeat(30) }).success).toBe(false);
    expect(createSuggestionSchema.safeParse({ title: "A fine title", body: "x".repeat(4001) }).success).toBe(false);
    expect(createSuggestionSchema.safeParse({ title: "A fine title", body: "x".repeat(30), tagIds: Array(21).fill("a") }).success).toBe(false);
  });

  it("allows only palette colours, not arbitrary CSS", () => {
    const base = { name: "X", votingOpen: true, closesCommentsOnEntry: false, showOnRoadmap: false };
    expect(statusSchema.safeParse({ ...base, color: "purple" }).success).toBe(true);
    for (const bad of ["#ff0000", "red; background:url(x)", "expression(alert(1))", "PURPLE"]) {
      expect(statusSchema.safeParse({ ...base, color: bad }).success, bad).toBe(false);
    }
  });

  it("only accepts https Discord links for the invite, and sensible numbers for limits", () => {
    expect(settingsSchema.safeParse({ discordInviteUrl: "https://discord.gg/abc123" }).success).toBe(true);
    for (const bad of ["http://discord.gg/abc", "https://evil.example/discord.gg", "javascript:alert(1)", "https://discord.gg.evil.example/x"]) {
      expect(settingsSchema.safeParse({ discordInviteUrl: bad }).success, bad).toBe(false);
    }
    expect(settingsSchema.safeParse({ voteSlots: 0 }).success).toBe(false);
    expect(settingsSchema.safeParse({ voteSlots: 51 }).success).toBe(false);
    expect(settingsSchema.safeParse({ voteSlots: null }).success).toBe(true);
    expect(settingsSchema.safeParse({ defaultCommentsMode: "CLOSED" }).success).toBe(false);
    expect(settingsSchema.safeParse({}).success).toBe(false);
  });

  it("bounds search and paging input", () => {
    expect(boardQuerySchema.parse({}).page).toBe(1);
    expect(boardQuerySchema.safeParse({ page: "0" }).success).toBe(false);
    expect(boardQuerySchema.safeParse({ page: "99999" }).success).toBe(false);
    expect(boardQuerySchema.safeParse({ sort: "random" }).success).toBe(false);
    expect(boardQuerySchema.safeParse({ q: "x".repeat(200) }).success).toBe(false);
  });
});

describe("secrets", () => {
  it("encrypts and decrypts, and refuses tampered or malformed values", () => {
    const token = encryptSecret("https://discord.com/api/webhooks/1/secret");
    expect(token).not.toContain("secret");
    expect(decryptSecret(token)).toBe("https://discord.com/api/webhooks/1/secret");
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
    const parts = token.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(decryptSecret(parts.join("."))).toBeNull();
    expect(decryptSecret("garbage")).toBeNull();
    expect(decryptSecret("v1.a.b.c")).toBeNull();
  });

  it("stops being readable if the signing secret is rotated", () => {
    const token = encryptSecret("value");
    const original = process.env.SESSION_SECRET;
    process.env.SESSION_SECRET = "a-completely-different-long-secret-value-0000";
    resetEnvForTests();
    expect(decryptSecret(token)).toBeNull();
    process.env.SESSION_SECRET = original;
    resetEnvForTests();
    expect(decryptSecret(token)).toBe("value");
  });

  it("compares in constant time and generates unguessable public ids", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    const ids = new Set(Array.from({ length: 2000 }, () => randomPublicId()));
    expect(ids.size).toBe(2000);
    for (const id of ids) expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
  });
});

describe("webhook URLs", () => {
  const good = "https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz0123456789";
  it("accepts a real Discord webhook and drops anything extra", () => {
    expect(parseWebhookUrl(good)).toBe(good);
    expect(parseWebhookUrl(`${good}?wait=true`)).toBe(good);
    expect(parseWebhookUrl(`  ${good}  `)).toBe(good);
  });
  it("rejects everything that could point the server somewhere else", () => {
    for (const bad of [
      "http://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz",
      "https://discord.com.evil.example/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz",
      "https://discord.com@evil.example/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz",
      "https://evil.example/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz",
      "https://discord.com:8443/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz",
      "https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz?redirect=http://evil",
      "https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz#x",
      "https://discord.com/api/webhooks/../../internal",
      "https://127.0.0.1/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz",
      "https://[::1]/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz",
      "file:///etc/passwd",
      "",
      "not a url",
    ]) {
      expect(parseWebhookUrl(bad), bad).toBeNull();
    }
  });
});

describe("avatars", () => {
  it("are always built on Discord's CDN host from stored hashes", () => {
    const base = { discordId: "123456789012345678" };
    expect(avatarUrl({ ...base, avatarHash: "abc123", guildAvatarHash: null })).toBe("https://cdn.discordapp.com/avatars/123456789012345678/abc123.png?size=64");
    expect(avatarUrl({ ...base, avatarHash: "abc123", guildAvatarHash: "def456" })).toMatch(/^https:\/\/cdn\.discordapp\.com\/guilds\/200000000000000001\/users\/123456789012345678\/avatars\/def456\.png/);
    expect(avatarUrl({ ...base, avatarHash: null, guildAvatarHash: null })).toMatch(/^https:\/\/cdn\.discordapp\.com\/embed\/avatars\/[0-5]\.png$/);
  });
});

describe("audit helpers", () => {
  it("redacts secrets, strips line breaks and bounds what it keeps", () => {
    const out = sanitizeDetails({
      reason: "line one\nFAKE 2099 admin logged in",
      webhookUrl: "https://discord.com/api/webhooks/1/secret",
      nested: { password: "hunter2", token: "t", ok: "fine" },
      list: Array.from({ length: 100 }, (_, i) => i),
      long: "x".repeat(5000),
    }) as Record<string, any>;
    expect(out.reason).not.toMatch(/\n/);
    expect(out.webhookUrl).toBe("[redacted]");
    expect(out.nested).toEqual({ password: "[redacted]", token: "[redacted]", ok: "fine" });
    expect(out.list).toHaveLength(20);
    expect(out.long.length).toBeLessThan(400);
    expect(JSON.stringify(out)).not.toMatch(/hunter2|secret/);
  });

  it("neutralises spreadsheet formulas in CSV exports", () => {
    expect(csvCell("=HYPERLINK(\"http://evil\")")).toBe('"\'=HYPERLINK(""http://evil"")"');
    expect(csvCell("+1+1")).toBe("\"'+1+1\"");
    expect(csvCell("-2")).toBe("\"'-2\"");
    expect(csvCell("@SUM(A1)")).toBe("\"'@SUM(A1)\"");
    expect(csvCell("plain, with comma")).toBe('"plain, with comma"');
    expect(csvCell(null)).toBe('""');
  });
});

describe("rate limiting", () => {
  afterEach(() => resetRateLimitsForTests());

  it("allows the limit, blocks beyond it, and recovers after the window", () => {
    const t = 1_000_000;
    expect([1, 2, 3].map((n) => rateLimit("k", 3, 1000, t + n).allowed)).toEqual([true, true, true]);
    const blocked = rateLimit("k", 3, 1000, t + 4);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(rateLimit("other", 3, 1000, t + 4).allowed).toBe(true);
    expect(rateLimit("k", 3, 1000, t + 2000).allowed).toBe(true);
  });

  it("reads the client address from the configured proxy header, trusting the last entry", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" }))).toBe("203.0.113.9");
    expect(clientIp(new Headers({ "x-forwarded-for": "not-an-ip" }))).toBe("unknown");
    expect(clientIp(new Headers())).toBe("unknown");
    process.env.CLIENT_IP_HEADER = "CF-Connecting-IP";
    resetEnvForTests();
    expect(clientIp(new Headers({ "cf-connecting-ip": "198.51.100.4", "x-forwarded-for": "6.6.6.6" }))).toBe("198.51.100.4");
    process.env.CLIENT_IP_HEADER = "x-forwarded-for";
    resetEnvForTests();
  });
});

describe("who may take part", () => {
  const base = { blockedAt: null, isOwner: false, isMember: true, joinedGuildAt: new Date(Date.now() - 30 * 86_400_000) };
  const settings = { memberRoleId: "1", minDaysInServer: 0 };

  it("covers each way of being turned away", () => {
    expect(participationBlock(base, settings)).toBeNull();
    expect(participationBlock({ ...base, blockedAt: new Date() }, settings)?.code).toBe("blocked");
    expect(participationBlock({ ...base, isMember: false }, settings)?.code).toBe("not_member");
    expect(participationBlock(base, { ...settings, memberRoleId: null })?.code).toBe("not_configured");
    expect(participationBlock({ ...base, joinedGuildAt: new Date() }, { ...settings, minDaysInServer: 7 })?.code).toBe("too_new");
    expect(participationBlock({ ...base, joinedGuildAt: null }, { ...settings, minDaysInServer: 7 })?.code).toBe("too_new");
    expect(participationBlock({ ...base, joinedGuildAt: new Date() }, { ...settings, minDaysInServer: 7 }, { tenure: false })).toBeNull();
  });

  it("always lets the owner through unless blocked, regardless of the role setting", () => {
    expect(participationBlock({ ...base, isOwner: true, isMember: false }, { memberRoleId: null, minDaysInServer: 30 })).toBeNull();
  });
});

describe("environment validation", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    resetEnvForTests();
  });

  it("names what is wrong without printing secret values", () => {
    process.env.SESSION_SECRET = "too-short-secret";
    process.env.DISCORD_CLIENT_ID = "not-a-number";
    resetEnvForTests();
    let message = "";
    try {
      getEnv();
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/SESSION_SECRET/);
    expect(message).toMatch(/DISCORD_CLIENT_ID/);
    expect(message).not.toContain("too-short-secret");
    expect(message).not.toContain("not-a-number");
  });

  it("requires https in production (except on localhost) and treats blank optional values as unset", () => {
    Object.assign(process.env, { NODE_ENV: "production" });
    process.env.SITE_URL = "http://suggest.example.com";
    resetEnvForTests();
    expect(() => getEnv()).toThrow(/https/);

    process.env.SITE_URL = "http://localhost:3000";
    process.env.OWNER_DISCORD_ID = "   ";
    process.env.CONTACT_EMAIL = "";
    resetEnvForTests();
    const env = getEnv();
    expect(env.OWNER_DISCORD_ID).toBeUndefined();
    expect(env.secureCookies).toBe(false);
    expect(env.redirectUri).toBe("http://localhost:3000/api/auth/callback");
  });
});
