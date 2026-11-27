import { z } from "zod";
import { audit, auditThrottled } from "./audit";
import type { User } from "./db";
import { participationBlock } from "./eligibility";
import { getEnv } from "./env";
import { HttpError, forbidden, unauthorized } from "./errors";
import { ensureFresh } from "./identity";
import { clientIp, rateLimit } from "./rate-limit";
import { readCookie, sessionCookieName, userFromToken } from "./session";
import { getSettings } from "./settings";
import { verifyInteraction } from "./signature";

/**
 * Every API route is built with `defineApi`. It is the one place that
 * enforces, in a fixed order:
 *
 *   1. same-origin check on anything that changes data (CSRF)
 *   2. rate limit
 *   3. authentication and authorisation, as declared by the route
 *   4. JSON content type, size limit and schema validation
 *   5. error handling that never leaks internals
 *
 * A route has to declare who may call it (`auth`), so there is no way to add
 * an endpoint and forget the question. A test walks every route file and
 * checks the declaration is present and actually enforced.
 */

/**
 * `discord` is for the one endpoint Discord itself calls. It has no session and
 * no Origin header; instead the request must carry a valid Ed25519 signature.
 */
export type AuthLevel = "public" | "member" | "owner" | "discord";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const MAX_BODY_BYTES = 32 * 1024;
// Interactions carry a copy of the message that was clicked, so they are larger than our own requests.
const MAX_SIGNED_BODY_BYTES = 128 * 1024;

export interface RateRule {
  /** Shared by every route that should count against the same allowance. */
  name: string;
  limit: number;
  windowMs: number;
  per?: "ip" | "user";
}

export type ApiContext<A extends AuthLevel, B, Q> = {
  req: Request;
  user: A extends "public" | "discord" ? null : User;
  body: B;
  /** The request body as bytes, for routes that declare `rawBody` (file uploads). Null otherwise. */
  raw: Buffer | null;
  query: Q;
  params: Record<string, string>;
  ip: string;
};

export interface ApiOptions<A extends AuthLevel, B, Q> {
  auth: A;
  body?: z.ZodType<B>;
  query?: z.ZodType<Q>;
  rate?: RateRule;
  /**
   * For uploads: the body is a single file sent as-is rather than JSON. The
   * size limit is enforced while the body streams in, so an oversized upload
   * is stopped early, and only the listed content types are accepted.
   */
  rawBody?: { maxBytes: number; types: readonly string[] };
  /** Member routes only: skip the "minimum days in the server" rule (for example, withdrawing your own pending suggestion). */
  skipTenure?: boolean;
  handler: (ctx: ApiContext<A, B, Q>) => Promise<unknown>;
}

export interface ApiMeta {
  auth: AuthLevel;
  hasBody: boolean;
  hasRawBody: boolean;
  rate?: RateRule;
}

type RouteContext = { params: Promise<Record<string, string>> };
export type ApiHandler = ((req: Request, routeContext: RouteContext) => Promise<Response>) & { meta: ApiMeta };

const NO_STORE = { "Cache-Control": "no-store" };

export function jsonResponse(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(data, { status, headers: { ...NO_STORE, ...headers } });
}

function errorResponse(error: HttpError, headers: Record<string, string> = {}): Response {
  return jsonResponse(
    { error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) } },
    error.status,
    headers,
  );
}

function assertSameOrigin(req: Request): void {
  const { siteOrigin } = getEnv();
  const origin = req.headers.get("origin");
  if (!origin || origin !== siteOrigin) throw forbidden("Cross-site request blocked.", "bad_origin");
  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    throw forbidden("Cross-site request blocked.", "bad_origin");
  }
}

/** Reads an uploaded file, giving up as soon as it goes over the limit rather than after buffering it all. */
async function readRaw(req: Request, rule: { maxBytes: number; types: readonly string[] }): Promise<Buffer> {
  const type = (req.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (!rule.types.includes(type)) throw new HttpError(415, "unsupported_media_type", "Please upload a PNG, JPEG or WebP image.");
  const tooLarge = () => new HttpError(413, "too_large", `That file is too large. The limit is ${Math.floor(rule.maxBytes / (1024 * 1024))} MB.`);

  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > rule.maxBytes) throw tooLarge();
  if (!req.body) return Buffer.alloc(0);

  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = req.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > rule.maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, total);
}

async function readJson(req: Request): Promise<unknown> {
  const type = (req.headers.get("content-type") ?? "").toLowerCase();
  if (!type.startsWith("application/json")) {
    throw new HttpError(415, "unsupported_media_type", "Requests must be JSON.");
  }
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) throw new HttpError(413, "too_large", "That request is too large.");
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) throw new HttpError(413, "too_large", "That request is too large.");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "invalid_json", "That request wasn't valid JSON.");
  }
}

/**
 * Reads the body exactly as received and checks Discord's signature over it,
 * before anything is parsed. Returns the parsed JSON.
 */
async function readSignedJson(req: Request, ip: string): Promise<unknown> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_SIGNED_BODY_BYTES) throw new HttpError(413, "too_large", "That request is too large.");
  const text = await req.text();
  if (text.length > MAX_SIGNED_BODY_BYTES) throw new HttpError(413, "too_large", "That request is too large.");

  if (!verifyInteraction(req.headers, text)) {
    await auditThrottled(`signature:${ip}`, {
      action: "discord.bad_signature",
      outcome: "DENIED",
      request: req,
    });
    throw new HttpError(401, "invalid_signature", "Invalid request signature.");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "invalid_json", "That request wasn't valid JSON.");
  }
}

function validate<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (parsed.success) return parsed.data;
  throw new HttpError(400, "validation_failed", "Please check what you entered.", z.flattenError(parsed.error).fieldErrors);
}

export function defineApi<A extends AuthLevel, B = undefined, Q = undefined>(
  options: ApiOptions<A, B, Q>,
): ApiHandler {
  const handler = async (req: Request, routeContext: RouteContext): Promise<Response> => {
    let actor: User | null = null;
    const path = new URL(req.url).pathname;

    try {
      const ip = clientIp(req.headers);

      const signed = options.auth === "discord";
      if (!SAFE_METHODS.has(req.method) && !signed) assertSameOrigin(req);

      const rule = options.rate;
      if (rule && (rule.per ?? "ip") === "ip") enforceRate(rule, `ip:${ip}`, req, null);

      let user: User | null = null;
      if (options.auth === "member" || options.auth === "owner") {
        user = await userFromToken(readCookie(req.headers, sessionCookieName()));
        if (!user) throw unauthorized();
        actor = user;

        if (options.auth === "owner") {
          if (!user.isOwner) throw forbidden();
        } else if (!user.isOwner) {
          user = actor = await ensureFresh(user);
          const block = participationBlock(user, await getSettings(), { tenure: !options.skipTenure });
          if (block) throw forbidden(block.message, block.code);
        }
        if (rule?.per === "user") enforceRate(rule, `user:${user.id}`, req, user);
      }

      const raw = options.rawBody ? await readRaw(req, options.rawBody) : null;
      const json = signed ? await readSignedJson(req, ip) : options.body ? await readJson(req) : undefined;
      const body = options.body ? validate(options.body, json) : (undefined as B);
      const query = options.query
        ? validate(options.query, Object.fromEntries(new URL(req.url).searchParams))
        : (undefined as Q);
      const params = (await routeContext?.params) ?? {};

      const result = await options.handler({
        req,
        user: user as ApiContext<A, B, Q>["user"],
        body,
        raw,
        query,
        params,
        ip,
      });
      if (result instanceof Response) {
        // Nothing is cached unless the route says so itself (images, which are the one thing worth caching).
        if (!result.headers.has("Cache-Control")) result.headers.set("Cache-Control", "no-store");
        return result;
      }
      return jsonResponse(result ?? { ok: true });
    } catch (err) {
      if (err instanceof HttpError) {
        if (err.status === 403 && actor) {
          await auditThrottled(`denied:${actor.id}:${req.method}:${path}`, {
            action: "access.denied",
            outcome: "DENIED",
            actor,
            details: { method: req.method, path, code: err.code },
            request: req,
          });
        }
        const extra: Record<string, string> = {};
        if (err.status === 429 && typeof err.details === "number") extra["Retry-After"] = String(err.details);
        return errorResponse(err, extra);
      }
      // Log the kind of failure, not request contents.
      console.error(`[api] ${req.method} ${path} failed:`, err instanceof Error ? `${err.name}: ${err.message}` : "unknown error");
      return errorResponse(new HttpError(500, "server_error", "Something went wrong on our side."));
    }
  };

  return Object.assign(handler, {
    meta: { auth: options.auth, hasBody: Boolean(options.body), hasRawBody: Boolean(options.rawBody), rate: options.rate } satisfies ApiMeta,
  });
}

function enforceRate(rule: RateRule, subject: string, req: Request, actor: User | null): void {
  const result = rateLimit(`${rule.name}:${subject}`, rule.limit, rule.windowMs);
  if (result.allowed) return;
  void auditThrottled(`rate:${rule.name}:${subject}`, {
    action: "rate_limit.hit",
    outcome: "DENIED",
    actor,
    details: { rule: rule.name },
    request: req,
  });
  throw new HttpError(429, "rate_limited", "You're doing that too quickly. Please wait a moment.", result.retryAfterSeconds);
}

/** For routes that need to record something extra after succeeding. */
export { audit };
