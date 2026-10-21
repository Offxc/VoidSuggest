import { createHash } from "node:crypto";
import { z } from "zod";
import { randomToken } from "@/server/crypto";
import { buildAuthorizeUrl } from "@/server/discord";
import { defineApi } from "@/server/http";
import { cookieHeader, oauthCookieName, safeReturnTo, signOAuthState } from "@/server/session";

/**
 * Starts Discord sign-in. A random `state` (checked on the way back) guards
 * against forged callbacks, and a PKCE verifier means a stolen authorisation
 * code is useless without the cookie set here.
 */
export const GET = defineApi({
  auth: "public",
  rate: { name: "auth", limit: 20, windowMs: 60_000 },
  query: z.object({ returnTo: z.string().max(300).optional() }),
  handler: async ({ query }) => {
    const state = randomToken(24);
    const verifier = randomToken(48);
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const returnTo = safeReturnTo(query.returnTo);

    const cookie = cookieHeader(oauthCookieName(), await signOAuthState({ state, verifier, returnTo }), 600);
    const headers = new Headers({ Location: buildAuthorizeUrl({ state, challenge }) });
    headers.append("Set-Cookie", cookie);
    return new Response(null, { status: 302, headers });
  },
});
