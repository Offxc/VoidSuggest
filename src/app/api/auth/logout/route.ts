import { audit } from "@/server/audit";
import { prisma } from "@/server/db";
import { defineApi } from "@/server/http";
import { clearCookieHeader, readCookie, sessionCookieName, verifySessionToken } from "@/server/session";

/**
 * Signing out ends every session the account has, not just this browser's.
 * A session is only a signed cookie, so the way to make a copied cookie
 * useless is to change the version number it is checked against.
 */
export const POST = defineApi({
  auth: "public",
  rate: { name: "auth", limit: 20, windowMs: 60_000 },
  handler: async ({ req }) => {
    const claims = await verifySessionToken(readCookie(req.headers, sessionCookieName()) ?? "");
    if (claims) {
      const user = await prisma.user
        .update({ where: { id: claims.uid }, data: { sessionVersion: { increment: 1 } } })
        .catch(() => null);
      if (user) await audit({ action: "auth.signout", actor: user, request: req });
    }
    const response = Response.json({ ok: true });
    response.headers.append("Set-Cookie", clearCookieHeader(sessionCookieName()));
    return response;
  },
});
