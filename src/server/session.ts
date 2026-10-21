import { SignJWT, jwtVerify } from "jose";
import { deriveKey } from "./crypto";
import { prisma, type User } from "./db";
import { getEnv } from "./env";

/**
 * Sessions are signed (HS256) cookies holding only the internal user id and a
 * version number. Everything else is read from the database on each request,
 * so blocking someone or bumping their `sessionVersion` ends their session
 * immediately, and a stolen cookie cannot outlive that.
 */

const ISSUER = "voidsuggest";
export const SESSION_TTL_SECONDS = 14 * 24 * 60 * 60;
const OAUTH_TTL_SECONDS = 10 * 60;

export function sessionCookieName(): string {
  return getEnv().secureCookies ? "__Host-vs_session" : "vs_session";
}

export function oauthCookieName(): string {
  return getEnv().secureCookies ? "__Host-vs_oauth" : "vs_oauth";
}

function key(purpose: string): Uint8Array {
  return new Uint8Array(deriveKey(purpose));
}

export async function signSessionToken(user: Pick<User, "id" | "sessionVersion">): Promise<string> {
  return new SignJWT({ v: user.sessionVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuer(ISSUER)
    .setAudience("session")
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(key("session-jwt"));
}

export async function verifySessionToken(token: string): Promise<{ uid: string; v: number } | null> {
  try {
    const { payload } = await jwtVerify(token, key("session-jwt"), {
      issuer: ISSUER,
      audience: "session",
      algorithms: ["HS256"],
    });
    if (typeof payload.sub !== "string" || typeof payload.v !== "number") return null;
    return { uid: payload.sub, v: payload.v };
  } catch {
    // Expired, tampered or signed with another key: same as signed out.
    return null;
  }
}

/** The signed-in user for a session token, or null if there is none or it is no longer valid. */
export async function userFromToken(token: string | undefined): Promise<User | null> {
  if (!token) return null;
  const claims = await verifySessionToken(token);
  if (!claims) return null;
  const user = await prisma.user.findUnique({ where: { id: claims.uid } });
  if (!user || user.sessionVersion !== claims.v || user.blockedAt) return null;
  return user;
}

export interface OAuthState {
  state: string;
  verifier: string;
  returnTo: string;
}

export async function signOAuthState(value: OAuthState): Promise<string> {
  return new SignJWT({ ...value })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISSUER)
    .setAudience("oauth")
    .setIssuedAt()
    .setExpirationTime(`${OAUTH_TTL_SECONDS}s`)
    .sign(key("oauth-jwt"));
}

export async function verifyOAuthState(token: string): Promise<OAuthState | null> {
  try {
    const { payload } = await jwtVerify(token, key("oauth-jwt"), {
      issuer: ISSUER,
      audience: "oauth",
      algorithms: ["HS256"],
    });
    const { state, verifier, returnTo } = payload as Record<string, unknown>;
    if (typeof state !== "string" || typeof verifier !== "string" || typeof returnTo !== "string") return null;
    return { state, verifier, returnTo };
  } catch {
    return null;
  }
}

/**
 * Only same-site relative paths are accepted as a post-login destination, so
 * the login flow cannot be used as an open redirect.
 */
export function safeReturnTo(value: string | null | undefined): string {
  if (!value || value.length > 300) return "/";
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/";
  // Control characters and encoded tricks.
  if (/[\u0000-\u001F\u007F]/.test(value)) return "/";
  if (value.startsWith("/api/")) return "/";
  return value;
}

export function readCookie(headers: Headers, name: string): string | undefined {
  const header = headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

export function cookieHeader(name: string, value: string, maxAgeSeconds: number): string {
  const secure = getEnv().secureCookies;
  return [
    `${name}=${value}`,
    "Path=/",
    `Max-Age=${maxAgeSeconds}`,
    "HttpOnly",
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

export function clearCookieHeader(name: string): string {
  return cookieHeader(name, "", 0);
}
