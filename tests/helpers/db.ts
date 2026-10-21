import { prisma, type User } from "@/server/db";
import { signSessionToken, sessionCookieName } from "@/server/session";
import { ensureDefaults } from "@/server/settings";
import type { ApiHandler } from "@/server/http";

/** Empties every table (except Prisma's own bookkeeping) and re-creates the starter data. */
export async function resetDb(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    DO $$ DECLARE t text; BEGIN
      FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' LOOP
        EXECUTE format('TRUNCATE TABLE %I RESTART IDENTITY CASCADE', t);
      END LOOP;
    END $$;`);
  await ensureDefaults();
}

let counter = 0;

export interface UserOptions {
  name?: string;
  owner?: boolean;
  member?: boolean;
  blocked?: boolean;
  joinedDaysAgo?: number;
  synced?: boolean;
}

export async function makeUser(options: UserOptions = {}): Promise<User> {
  counter += 1;
  const name = options.name ?? `Player ${counter}`;
  return prisma.user.create({
    data: {
      discordId: String(400000000000000000n + BigInt(counter) + BigInt(Math.floor(Math.random() * 1e9))),
      username: name.toLowerCase().replace(/\s+/g, "_"),
      displayName: name,
      isOwner: options.owner ?? false,
      isMember: options.owner ? false : (options.member ?? true),
      blockedAt: options.blocked ? new Date() : null,
      joinedGuildAt: new Date(Date.now() - (options.joinedDaysAgo ?? 30) * 86_400_000),
      lastSyncedAt: options.synced === false ? null : new Date(),
    },
  });
}

/** Sets the Member role id (any value will do; makeUser sets isMember directly) so the site counts as configured. */
export async function configureSite(patch: Record<string, unknown> = {}): Promise<void> {
  await prisma.settings.update({ where: { id: 1 }, data: { memberRoleId: "300000000000000001", ...patch } });
}

export async function defaultStatus() {
  return prisma.status.findFirstOrThrow({ where: { isDefault: true } });
}

export async function statusBySlug(slug: string) {
  return prisma.status.findUniqueOrThrow({ where: { slug } });
}

export async function makeApproved(author: User, title = "A perfectly reasonable idea", statusSlug = "suggestions") {
  const status = await statusBySlug(statusSlug);
  const type = await prisma.suggestionType.findFirst();
  counter += 1;
  return prisma.suggestion.create({
    data: {
      publicId: `T${String(counter).padStart(7, "0")}`.replace(/[ILOU]/g, "X"),
      authorId: author.id,
      title,
      body: "This is a long enough description to pass validation easily.",
      typeId: type?.id,
      approval: "APPROVED",
      statusId: status.id,
      approvedAt: new Date(),
      statusChangedAt: new Date(),
    },
  });
}

export async function makePending(author: User, title = "A pending idea that nobody should see") {
  const type = await prisma.suggestionType.findFirst();
  counter += 1;
  return prisma.suggestion.create({
    data: {
      publicId: `P${String(counter).padStart(7, "0")}`.replace(/[ILOU]/g, "X"),
      authorId: author.id,
      title,
      body: "This is a long enough description to pass validation easily.",
      typeId: type?.id,
    },
  });
}

export interface CallOptions {
  method?: string;
  path?: string;
  body?: unknown;
  user?: User | null;
  params?: Record<string, string>;
  headers?: Record<string, string>;
  origin?: string | null;
}

/** Calls a route handler the way the framework would, with a genuine signed session cookie. */
export async function call(handler: ApiHandler, options: CallOptions = {}) {
  const method = options.method ?? "GET";
  const headers = new Headers({ "x-forwarded-for": "203.0.113.7", ...options.headers });
  if (method !== "GET" && method !== "HEAD") {
    if (options.origin !== null) headers.set("origin", options.origin ?? "https://suggest.test");
    if (options.body !== undefined) headers.set("content-type", "application/json");
  }
  if (options.user) {
    headers.set("cookie", `${sessionCookieName()}=${await signSessionToken(options.user)}`);
  }
  const response = await handler(
    new Request(`https://suggest.test${options.path ?? "/api/test"}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    }),
    { params: Promise.resolve(options.params ?? {}) },
  );
  const text = await response.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON (CSV, redirects) */
  }
  return { status: response.status, json, text, headers: response.headers };
}
