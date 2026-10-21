import { NextResponse, type NextRequest } from "next/server";

/**
 * Runs on every page and API request (Next.js 16's renamed middleware).
 *
 * Sets a Content-Security-Policy with a fresh nonce per request. Scripts run
 * only if they carry that nonce (or were loaded by one that did), so an
 * injected <script> or an inline event handler is blocked by the browser even
 * if markup somehow got through. Also adds HSTS when the site is served over
 * https. Nothing here touches the database.
 */

const isDev = process.env.NODE_ENV !== "production";
const AVATAR_HOST = "https://cdn.discordapp.com";

export default function proxy(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const https = (process.env.SITE_URL ?? "").startsWith("https://");

  const csp = [
    "default-src 'self'",
    // React's dev tooling needs eval; production does not.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    isDev ? "style-src 'self' 'unsafe-inline'" : `style-src 'self' 'nonce-${nonce}'`,
    `img-src 'self' ${AVATAR_HOST}`,
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    // Only when the site really is https; on plain-http localhost it would break every asset request.
    ...(https ? ["upgrade-insecure-requests"] : []),
  ].join("; ");

  // Next reads the nonce from the request's CSP header and applies it to its own scripts.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);

  if (https) {
    response.headers.set("Strict-Transport-Security", "max-age=31536000");
  }
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
