import { z } from "zod";
import { audit } from "@/server/audit";
import { safeEqual } from "@/server/crypto";
import { DiscordError, exchangeCode, fetchSelfId } from "@/server/discord";
import { getEnv } from "@/server/env";
import { defineApi } from "@/server/http";
import {
  clearCookieHeader,
  cookieHeader,
  oauthCookieName,
  readCookie,
  safeReturnTo,
  SESSION_TTL_SECONDS,
  sessionCookieName,
  signSessionToken,
  verifyOAuthState,
} from "@/server/session";
import { signInWithDiscordId } from "@/server/signin";

function redirect(path: string, cookies: string[]): Response {
  const headers = new Headers({ Location: new URL(path, getEnv().siteOrigin).toString() });
  for (const c of cookies) headers.append("Set-Cookie", c);
  return new Response(null, { status: 302, headers });
}

export const GET = defineApi({
  auth: "public",
  rate: { name: "auth", limit: 20, windowMs: 60_000 },
  query: z.object({
    code: z.string().max(512).optional(),
    state: z.string().max(256).optional(),
    error: z.string().max(100).optional(),
  }),
  handler: async ({ req, query }) => {
    const clearOAuth = clearCookieHeader(oauthCookieName());
    const fail = (reason: string) => redirect(`/login?error=${reason}`, [clearOAuth]);

    if (query.error) return fail("cancelled");

    const saved = await verifyOAuthState(readCookie(req.headers, oauthCookieName()) ?? "");
    if (!saved || !query.state || !query.code || !safeEqual(saved.state, query.state)) {
      await audit({ action: "auth.signin", outcome: "FAILURE", details: { reason: "state_mismatch" }, request: req });
      return fail("state");
    }

    try {
      const accessToken = await exchangeCode(query.code, saved.verifier);
      const discordId = await fetchSelfId(accessToken);
      const result = await signInWithDiscordId(discordId);

      if (!result.ok) {
        await audit({
          action: "auth.signin",
          outcome: "DENIED",
          details: { reason: result.reason },
          request: req,
        });
        return fail(result.reason === "blocked" ? "denied" : "not_member");
      }

      if (result.claimedOwnership) {
        await audit({ action: "auth.owner_claimed", actor: result.user, targetType: "user", targetId: result.user.id, request: req });
      }
      await audit({ action: "auth.signin", actor: result.user, request: req });

      const session = cookieHeader(sessionCookieName(), await signSessionToken(result.user), SESSION_TTL_SECONDS);
      return redirect(safeReturnTo(saved.returnTo), [clearOAuth, session]);
    } catch (err) {
      await audit({
        action: "auth.signin",
        outcome: "FAILURE",
        details: { reason: err instanceof DiscordError ? "discord_error" : "error", discordStatus: err instanceof DiscordError ? err.status : undefined },
        request: req,
      });
      if (!(err instanceof DiscordError)) console.error("[auth] sign-in failed:", err instanceof Error ? err.message : "unknown");
      return fail("discord");
    }
  },
});
