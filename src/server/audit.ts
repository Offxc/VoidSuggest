import type { AuditOutcome, Prisma } from "../../generated/prisma/client";
import { prisma, type User } from "./db";
import { clientIp } from "./rate-limit";

/**
 * Append-only record of who did what. Written with logging guidance in mind
 * (OWASP Logging Cheat Sheet):
 *  - secrets are never logged: values under sensitive-looking keys are replaced
 *  - control characters are stripped so entries cannot forge extra log lines
 *  - details are bounded in size, depth and breadth
 *  - a failed write never blocks the action being audited
 *  - actor names are copied in, so a later rename does not rewrite history
 */

export interface AuditInput {
  action: string;
  outcome?: AuditOutcome;
  actor?: Pick<User, "id" | "displayName"> | null;
  targetType?: string;
  targetId?: string;
  details?: Record<string, unknown>;
  request?: { headers: Headers };
}

const SENSITIVE_KEY = /token|secret|password|passwd|webhook|authorization|cookie|session/i;
const MAX_STRING = 300;
const MAX_ARRAY = 20;
const MAX_DEPTH = 4;
const MAX_KEYS = 30;

const CONTROL = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g;

function scrub(text: string, max: number): string {
  const clean = text.replace(CONTROL, " ");
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

export function sanitizeDetails(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return scrub(value, MAX_STRING);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (depth >= MAX_DEPTH) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, MAX_ARRAY).map((v) => sanitizeDetails(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, MAX_KEYS)) {
      const key = scrub(k, 60);
      out[key] = SENSITIVE_KEY.test(k) ? "[redacted]" : sanitizeDetails(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

export async function audit(input: AuditInput): Promise<void> {
  try {
    const headers = input.request?.headers;
    await prisma.auditLog.create({
      data: {
        action: scrub(input.action, 64),
        outcome: input.outcome ?? "SUCCESS",
        actorId: input.actor?.id ?? null,
        actorName: scrub(input.actor?.displayName ?? "anonymous", 64),
        targetType: input.targetType ? scrub(input.targetType, 32) : null,
        targetId: input.targetId ? scrub(input.targetId, 64) : null,
        details: input.details ? (sanitizeDetails(input.details) as Prisma.InputJsonValue) : undefined,
        ip: headers ? clientIp(headers).slice(0, 45) : null,
        userAgent: headers ? scrub(headers.get("user-agent") ?? "", 200) || null : null,
      },
    });
  } catch (err) {
    // Never let a failed audit write take down the request. Log the action
    // name only: nothing from the entry itself.
    console.error(`[audit] failed to record "${input.action}":`, err instanceof Error ? err.name : "error");
  }
}

const recentlyLogged = new Map<string, number>();

/** Like `audit`, but at most once per key per window. For noisy events such as rate-limit hits. */
export async function auditThrottled(key: string, input: AuditInput, windowMs = 60_000): Promise<void> {
  const now = Date.now();
  const last = recentlyLogged.get(key);
  if (last && now - last < windowMs) return;
  if (recentlyLogged.size > 5_000) recentlyLogged.clear();
  recentlyLogged.set(key, now);
  await audit(input);
}

/** Spreadsheet programs treat cells starting with these as formulas. */
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
