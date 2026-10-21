import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET as callbackGET } from "@/app/api/auth/callback/route";
import { GET as loginGET } from "@/app/api/auth/login/route";
import { POST as logoutPOST } from "@/app/api/auth/logout/route";
import { prisma } from "@/server/db";
import { resetEnvForTests } from "@/server/env";
import {
  oauthCookieName,
  safeReturnTo,
  sessionCookieName,
  signSessionToken,
  userFromToken,
  verifySessionToken,
} from "@/server/session";
import { signInWithDiscordId } from "@/server/signin";
import { castVote } from "@/server/votes";
import { call, configureSite, makeApproved, makeUser, resetDb } from "./helpers/db";
import { MEMBER_ROLE, MockDiscord } from "./helpers/mock-discord";

const discord = new MockDiscord();
const OWNER_ID = "500000000000000001";
const MEMBER_ID = "500000000000000002";
const OUTSIDER_ID = "500000000000000003";

beforeAll(async () => {
  await discord.start();
});
afterAll(async () => {
  await discord.stop();
});

beforeEach(async () => {
  await resetDb();
  await configureSite();
  discord.failWith = null;
  discord.requests.length = 0;
  discord.members.clear();
  discord.add({ id: OWNER_ID, username: "founder", roles: [] });
  discord.add({ id: MEMBER_ID, username: "player_one", globalName: "Player One", nick: "P1 in the server", roles: [MEMBER_ROLE] });
  discord.add({ id: OUTSIDER_ID, username: "outsider", roles: [] });
  delete process.env.OWNER_DISCORD_ID;
  resetEnvForTests();
});

describe("who can sign in", () => {
  it("makes the very first account the owner, even without the Member role; later accounts need the role", async () => {
    const first = await signInWithDiscordId(OWNER_ID);
    expect(first).toMatchObject({ ok: true, claimedOwnership: true });

    const outsider = await signInWithDiscordId(OUTSIDER_ID);
    expect(outsider).toEqual({ ok: false, reason: "not_member" });
    expect(await prisma.user.findUnique({ where: { discordId: OUTSIDER_ID } })).toBeNull();

    const member = await signInWithDiscordId(MEMBER_ID);
    expect(member).toMatchObject({ ok: true, claimedOwnership: false });
    expect(await prisma.user.count({ where: { isOwner: true } })).toBe(1);
  });

  it("only ever creates one owner, even when several first sign-ins arrive together", async () => {
    for (let n = 0; n < 5; n++) discord.add({ id: String(600000000000000000n + BigInt(n)), username: `racer_${n}`, roles: [MEMBER_ROLE] });
    const ids = [...discord.members.keys()].filter((id) => id.startsWith("6"));

    const results = await Promise.all(ids.map((id) => signInWithDiscordId(id)));

    expect(results.every((r) => r.ok)).toBe(true);
    expect(results.filter((r) => r.ok && r.claimedOwnership)).toHaveLength(1);
    expect(await prisma.user.count({ where: { isOwner: true } })).toBe(1);
    expect(await prisma.user.count()).toBe(5);
  });

  it("lets the same person sign in twice at once without creating two accounts", async () => {
    const results = await Promise.all([signInWithDiscordId(MEMBER_ID), signInWithDiscordId(MEMBER_ID), signInWithDiscordId(MEMBER_ID)]);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(await prisma.user.count({ where: { discordId: MEMBER_ID } })).toBe(1);
  });

  it("restricts who can claim ownership when OWNER_DISCORD_ID is set", async () => {
    process.env.OWNER_DISCORD_ID = OWNER_ID;
    resetEnvForTests();

    const member = await signInWithDiscordId(MEMBER_ID);
    expect(member).toMatchObject({ ok: true, claimedOwnership: false });
    expect(await prisma.user.count({ where: { isOwner: true } })).toBe(0);

    expect(await signInWithDiscordId(OWNER_ID)).toMatchObject({ ok: true, claimedOwnership: true });
    delete process.env.OWNER_DISCORD_ID;
  });

  it("refuses blocked accounts", async () => {
    await signInWithDiscordId(OWNER_ID);
    const first = await signInWithDiscordId(MEMBER_ID);
    expect(first.ok).toBe(true);
    await prisma.user.update({ where: { discordId: MEMBER_ID }, data: { blockedAt: new Date() } });
    expect(await signInWithDiscordId(MEMBER_ID)).toEqual({ ok: false, reason: "blocked" });
  });

  it("uses the server nickname everywhere, falling back to display name and then username", async () => {
    await signInWithDiscordId(OWNER_ID);
    await signInWithDiscordId(MEMBER_ID);
    expect((await prisma.user.findUniqueOrThrow({ where: { discordId: MEMBER_ID } })).displayName).toBe("P1 in the server");

    discord.add({ id: "500000000000000004", username: "plain_handle", globalName: "Fancy Name", roles: [MEMBER_ROLE] });
    discord.add({ id: "500000000000000005", username: "only_handle", roles: [MEMBER_ROLE] });
    await signInWithDiscordId("500000000000000004");
    await signInWithDiscordId("500000000000000005");
    expect((await prisma.user.findUniqueOrThrow({ where: { discordId: "500000000000000004" } })).displayName).toBe("Fancy Name");
    expect((await prisma.user.findUniqueOrThrow({ where: { discordId: "500000000000000005" } })).displayName).toBe("only_handle");
  });

  it("withdraws a former member's votes when they sign in after losing the role", async () => {
    await signInWithDiscordId(OWNER_ID);
    const result = await signInWithDiscordId(MEMBER_ID);
    if (!result.ok) throw new Error("expected sign-in");
    const s = await makeApproved(await makeUser());
    await castVote(result.user, s.publicId);
    expect((await prisma.suggestion.findUniqueOrThrow({ where: { id: s.id } })).voteCount).toBe(1);

    discord.members.get(MEMBER_ID)!.roles = [];
    expect(await signInWithDiscordId(MEMBER_ID)).toEqual({ ok: false, reason: "not_member" });

    expect((await prisma.suggestion.findUniqueOrThrow({ where: { id: s.id } })).voteCount).toBe(0);
    expect((await prisma.user.findUniqueOrThrow({ where: { discordId: MEMBER_ID } })).isMember).toBe(false);
  });
});

async function beginLogin(returnTo?: string) {
  const path = `/api/auth/login${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ""}`;
  const res = await call(loginGET, { path });
  const location = new URL(res.headers.get("location")!);
  const oauthCookie = res.headers.getSetCookie().find((c) => c.startsWith(oauthCookieName()))!;
  return { res, location, state: location.searchParams.get("state")!, cookie: oauthCookie.split(";")[0]! };
}

describe("the sign-in round trip", () => {
  it("sends people to Discord with state and a PKCE challenge, and stores the secret half in a locked-down cookie", async () => {
    const { res, location, oauthCookie } = await (async () => {
      const b = await beginLogin();
      return { res: b.res, location: b.location, oauthCookie: b.res.headers.getSetCookie()[0]! };
    })();

    expect(res.status).toBe(302);
    expect(location.origin + location.pathname).toBe("https://discord.com/oauth2/authorize");
    expect(location.searchParams.get("scope")).toBe("identify");
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    expect(location.searchParams.get("redirect_uri")).toBe("https://suggest.test/api/auth/callback");
    expect(location.searchParams.get("state")).toHaveLength(32);
    expect(oauthCookie).toMatch(/HttpOnly/);
    expect(oauthCookie).toMatch(/Secure/);
    expect(oauthCookie).toMatch(/SameSite=Lax/);
    expect(oauthCookie.startsWith("__Host-")).toBe(true);
  });

  it("signs a member in, proves the PKCE verifier, and sets a session that resolves to them", async () => {
    await signInWithDiscordId(OWNER_ID);
    const { state, cookie, location } = await beginLogin("/s/ABCDEFGH");

    const res = await call(callbackGET, {
      path: `/api/auth/callback?code=code-${MEMBER_ID}&state=${state}`,
      headers: { cookie },
    });

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://suggest.test/s/ABCDEFGH");
    const sessionCookie = res.headers.getSetCookie().find((c) => c.startsWith(sessionCookieName()))!;
    expect(sessionCookie).toMatch(/HttpOnly; SameSite=Lax; Secure|HttpOnly.*Secure/);
    const user = await userFromToken(sessionCookie.split(";")[0]!.split("=")[1]);
    expect(user?.discordId).toBe(MEMBER_ID);

    // The code verifier sent to Discord hashes to the challenge from the first step.
    const tokenRequest = discord.requests.find((r) => r.url === "/oauth2/token")!;
    const verifier = new URLSearchParams(tokenRequest.body).get("code_verifier")!;
    expect(createHash("sha256").update(verifier).digest("base64url")).toBe(location.searchParams.get("code_challenge"));
    // And the access token was only ever used for the identity lookup.
    expect(discord.requests.filter((r) => r.auth?.startsWith("Bearer")).map((r) => r.url)).toEqual(["/users/@me"]);
  });

  it("turns away people without the Member role before creating any account or session", async () => {
    await signInWithDiscordId(OWNER_ID);
    const { state, cookie } = await beginLogin();
    const res = await call(callbackGET, { path: `/api/auth/callback?code=code-${OUTSIDER_ID}&state=${state}`, headers: { cookie } });

    expect(res.headers.get("location")).toBe("https://suggest.test/login?error=not_member");
    expect(res.headers.getSetCookie().some((c) => c.startsWith(sessionCookieName()) && !/Max-Age=0/.test(c))).toBe(false);
    expect(await prisma.user.findUnique({ where: { discordId: OUTSIDER_ID } })).toBeNull();
    expect(await prisma.auditLog.count({ where: { action: "auth.signin", outcome: "DENIED" } })).toBe(1);
  });

  it("rejects a callback with the wrong state, a missing cookie, or someone else's cookie", async () => {
    const a = await beginLogin();
    const b = await beginLogin();

    const wrong = await call(callbackGET, { path: `/api/auth/callback?code=code-${MEMBER_ID}&state=${b.state}`, headers: { cookie: a.cookie } });
    const none = await call(callbackGET, { path: `/api/auth/callback?code=code-${MEMBER_ID}&state=${a.state}` });

    for (const res of [wrong, none]) {
      expect(res.headers.get("location")).toBe("https://suggest.test/login?error=state");
      expect(res.headers.getSetCookie().some((c) => c.startsWith(sessionCookieName()) && !/Max-Age=0/.test(c))).toBe(false);
    }
    expect(await prisma.user.count()).toBe(0);
  });

  it("handles someone cancelling on Discord's screen and a Discord outage without a session", async () => {
    const a = await beginLogin();
    const cancelled = await call(callbackGET, { path: "/api/auth/callback?error=access_denied", headers: { cookie: a.cookie } });
    expect(cancelled.headers.get("location")).toBe("https://suggest.test/login?error=cancelled");

    const b = await beginLogin();
    discord.failWith = 500;
    const down = await call(callbackGET, { path: `/api/auth/callback?code=code-${MEMBER_ID}&state=${b.state}`, headers: { cookie: b.cookie } });
    expect(down.headers.get("location")).toBe("https://suggest.test/login?error=discord");
    expect(await prisma.user.count()).toBe(0);
  });

  it("never redirects off-site after sign-in", async () => {
    for (const evil of ["//evil.example/x", "https://evil.example", "/\\evil.example", "javascript:alert(1)", "/api/admin/settings"]) {
      expect(safeReturnTo(evil)).toBe("/");
    }
    expect(safeReturnTo("/s/ABCDEFGH?x=1")).toBe("/s/ABCDEFGH?x=1");
    expect(safeReturnTo(undefined)).toBe("/");

    await signInWithDiscordId(OWNER_ID);
    const { state, cookie } = await beginLogin("//evil.example/phish");
    const res = await call(callbackGET, { path: `/api/auth/callback?code=code-${MEMBER_ID}&state=${state}`, headers: { cookie } });
    expect(res.headers.get("location")).toBe("https://suggest.test/");
  });

  it("clears the session cookie on sign-out, even when nobody was signed in", async () => {
    const res = await call(logoutPOST, { method: "POST" });
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie()[0]).toMatch(/Max-Age=0/);
  });

  it("ends every session for the account on sign-out, so a copied cookie stops working", async () => {
    const user = await makeUser({ name: "Signing Out" });
    const phone = await signSessionToken(user);
    const laptop = await signSessionToken(user);
    expect((await userFromToken(phone))?.id).toBe(user.id);

    const res = await call(logoutPOST, { method: "POST", user });
    expect(res.status).toBe(200);

    expect(await userFromToken(phone)).toBeNull();
    expect(await userFromToken(laptop)).toBeNull();
    expect(await prisma.auditLog.count({ where: { action: "auth.signout", actorName: "Signing Out" } })).toBe(1);
  });
});

describe("sessions", () => {
  it("rejects tampered, foreign and expired tokens", async () => {
    const user = await makeUser();
    const token = await signSessionToken(user);
    expect(await verifySessionToken(token)).toEqual({ uid: user.id, v: 0 });

    const [h, p, s] = token.split(".");
    expect(await verifySessionToken(`${h}.${p}.${s!.slice(0, -2)}xx`)).toBeNull();
    expect(await verifySessionToken(`${h}.${Buffer.from('{"sub":"someone-else","v":0}').toString("base64url")}.${s}`)).toBeNull();
    expect(await verifySessionToken("not-a-token")).toBeNull();
    expect(await verifySessionToken("")).toBeNull();
    // A token for another purpose (the OAuth cookie) is not a session.
    const { signOAuthState } = await import("@/server/session");
    expect(await verifySessionToken(await signOAuthState({ state: "s", verifier: "v", returnTo: "/" }))).toBeNull();
  });

  it("ends immediately when the owner blocks someone or their session version changes", async () => {
    const user = await makeUser();
    const token = await signSessionToken(user);
    expect((await userFromToken(token))?.id).toBe(user.id);

    await prisma.user.update({ where: { id: user.id }, data: { sessionVersion: { increment: 1 } } });
    expect(await userFromToken(token)).toBeNull();

    const other = await makeUser();
    const otherToken = await signSessionToken(other);
    await prisma.user.update({ where: { id: other.id }, data: { blockedAt: new Date() } });
    expect(await userFromToken(otherToken)).toBeNull();
  });
});
