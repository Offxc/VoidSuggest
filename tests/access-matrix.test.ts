import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ApiHandler } from "@/server/http";
import { resetRateLimitsForTests } from "@/server/rate-limit";
import { call, configureSite, makeUser, resetDb } from "./helpers/db";

/**
 * Walks every API route file and checks the access rules hold for all of
 * them, so adding an endpoint without thinking about who may call it fails
 * here instead of shipping.
 */

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
const loaders = import.meta.glob("../src/app/api/**/route.ts");

interface RouteCase {
  file: string;
  urlPath: string;
  method: (typeof METHODS)[number];
  handler: ApiHandler;
}

const routes: RouteCase[] = [];
const PARAMS = { id: "ABCDEFGH", userId: "abcdefghijklmnopqrstuvwxy" };

beforeAll(async () => {
  for (const [file, load] of Object.entries(loaders)) {
    const mod = (await load()) as Record<string, unknown>;
    const urlPath = file.replace("../src/app", "").replace("/route.ts", "").replace(/\[[^\]]+\]/g, "x");
    for (const method of METHODS) {
      if (mod[method]) routes.push({ file, urlPath, method, handler: mod[method] as ApiHandler });
    }
    // Anything else exported from a route file would be reachable as an unknown method.
    const stray = Object.keys(mod).filter((k) => !(METHODS as readonly string[]).includes(k));
    expect(stray, `${file} exports unexpected names`).toEqual([]);
  }
});

beforeEach(async () => {
  await resetDb();
  await configureSite();
  resetRateLimitsForTests();
});

describe("route inventory", () => {
  it("finds the routes", () => {
    expect(routes.length).toBeGreaterThan(40);
  });

  it("builds every handler with defineApi, so each one declares who may call it", () => {
    for (const r of routes) {
      expect(r.handler.meta, `${r.method} ${r.urlPath} is not built with defineApi`).toBeDefined();
      expect(["public", "member", "owner"]).toContain(r.handler.meta.auth);
    }
  });

  it("makes everything under /api/admin owner-only", () => {
    for (const r of routes.filter((x) => x.urlPath.startsWith("/api/admin"))) {
      expect(r.handler.meta.auth, `${r.method} ${r.urlPath}`).toBe("owner");
    }
  });

  it("allows only the known sign-in/out and read-only routes to be public", () => {
    const publicRoutes = routes.filter((r) => r.handler.meta.auth === "public").map((r) => `${r.method} ${r.urlPath}`).sort();
    expect(publicRoutes).toEqual([
      "GET /api/auth/callback",
      "GET /api/auth/login",
      "GET /api/health",
      "GET /api/suggestions/similar",
      "POST /api/auth/logout",
    ]);
  });

  it("rate-limits every route that signs people in or takes free text from the public", () => {
    for (const r of routes.filter((x) => x.urlPath.startsWith("/api/auth") || x.urlPath.endsWith("/similar"))) {
      expect(r.handler.meta.rate, `${r.method} ${r.urlPath}`).toBeDefined();
    }
  });
});

describe("who gets through", () => {
  it("turns away signed-out visitors from every member and owner route", async () => {
    for (const r of routes.filter((x) => x.handler.meta.auth !== "public")) {
      const res = await call(r.handler, { method: r.method, path: r.urlPath, params: PARAMS, body: r.method === "GET" ? undefined : {} });
      expect(res.status, `${r.method} ${r.urlPath}`).toBe(401);
    }
  });

  it("turns away ordinary members from every owner route", async () => {
    const member = await makeUser();
    for (const r of routes.filter((x) => x.handler.meta.auth === "owner")) {
      const res = await call(r.handler, { method: r.method, path: r.urlPath, params: PARAMS, user: member, body: r.method === "GET" ? undefined : {} });
      expect(res.status, `${r.method} ${r.urlPath}`).toBe(403);
    }
  });

  it("turns away signed-in people without the Member role from every member route", async () => {
    const outsider = await makeUser({ member: false });
    for (const r of routes.filter((x) => x.handler.meta.auth === "member")) {
      const res = await call(r.handler, { method: r.method, path: r.urlPath, params: PARAMS, user: outsider, body: r.method === "GET" ? undefined : {} });
      expect(res.status, `${r.method} ${r.urlPath}`).toBe(403);
      expect(res.json.error.code).toBe("not_member");
    }
  });

  it("turns away blocked people, whose cookie no longer counts as a session", async () => {
    const blocked = await makeUser({ blocked: true });
    for (const r of routes.filter((x) => x.handler.meta.auth !== "public")) {
      const res = await call(r.handler, { method: r.method, path: r.urlPath, params: PARAMS, user: blocked, body: r.method === "GET" ? undefined : {} });
      expect(res.status, `${r.method} ${r.urlPath}`).toBe(401);
    }
  });

  it("records a denied attempt by a signed-in person in the audit log", async () => {
    const { prisma } = await import("@/server/db");
    const member = await makeUser({ name: "Curious Member" });
    const target = routes.find((r) => r.urlPath === "/api/admin/settings")!;
    await call(target.handler, { method: "PATCH", path: target.urlPath, user: member, body: { siteName: "x" } });
    const row = await prisma.auditLog.findFirst({ where: { action: "access.denied", actorName: "Curious Member" } });
    expect(row).toMatchObject({ outcome: "DENIED" });
  });
});

describe("request hygiene on every state-changing route", () => {
  it("blocks cross-site requests, even from the owner's own browser", async () => {
    const owner = await makeUser({ owner: true });
    for (const r of routes.filter((x) => x.method !== "GET")) {
      const wrongOrigin = await call(r.handler, { method: r.method, path: r.urlPath, params: PARAMS, user: owner, body: {}, origin: "https://evil.example" });
      const noOrigin = await call(r.handler, { method: r.method, path: r.urlPath, params: PARAMS, user: owner, body: {}, origin: null });
      expect(wrongOrigin.status, `${r.method} ${r.urlPath} (wrong origin)`).toBe(403);
      expect(noOrigin.status, `${r.method} ${r.urlPath} (no origin)`).toBe(403);
      expect(wrongOrigin.json.error.code).toBe("bad_origin");
    }
  });

  it("blocks requests that claim to come from another site via Fetch Metadata", async () => {
    const owner = await makeUser({ owner: true });
    const route = routes.find((r) => r.urlPath === "/api/admin/settings")!;
    const res = await call(route.handler, {
      method: "PATCH",
      path: route.urlPath,
      user: owner,
      body: { siteName: "Hijacked" },
      headers: { "sec-fetch-site": "cross-site" },
    });
    expect(res.status).toBe(403);
  });

  it("insists on JSON for routes that read a body, and rejects oversized or malformed ones", async () => {
    const owner = await makeUser({ owner: true });
    const route = routes.find((r) => r.urlPath === "/api/admin/settings")!;
    const form = await call(route.handler, { method: "PATCH", path: route.urlPath, user: owner, body: "siteName=x", headers: { "content-type": "application/x-www-form-urlencoded" } });
    expect([415, 400]).toContain(form.status);

    const bad = await call(route.handler, { method: "PATCH", path: route.urlPath, user: owner, body: undefined, headers: { "content-type": "application/json" } });
    expect(bad.status).toBe(400);

    const huge = await call(route.handler, { method: "PATCH", path: route.urlPath, user: owner, body: { siteName: "x".repeat(40_000) } });
    expect(huge.status).toBe(413);
  });

  it("never leaks internals in an error", async () => {
    const owner = await makeUser({ owner: true });
    const route = routes.find((r) => r.urlPath === "/api/admin/settings")!;
    const res = await call(route.handler, { method: "PATCH", path: route.urlPath, user: owner, body: { siteName: "" } });
    expect(res.status).toBe(400);
    expect(res.json.error.code).toBe("validation_failed");
    expect(res.text).not.toMatch(/prisma|stack|at \w+ \(|node_modules|SELECT /i);
  });

  it("rejects malformed ids in the URL before touching the database", async () => {
    const owner = await makeUser({ owner: true });
    const route = routes.find((r) => r.urlPath === "/api/admin/suggestions/x/approve")!;
    for (const bad of ["abc", "ABCDEFGH' OR 1=1--", "../../etc/passwd", "abcdefgh"]) {
      const res = await call(route.handler, { method: "POST", path: route.urlPath, user: owner, params: { id: bad }, body: {} });
      expect(res.status, bad).toBe(404);
    }
  });

  it("returns Cache-Control: no-store on API responses", async () => {
    const route = routes.find((r) => r.urlPath === "/api/health")!;
    const res = await call(route.handler, { path: "/api/health" });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("rate limits", () => {
  it("answer 429 with Retry-After once a limit is hit, per client address", async () => {
    const route = routes.find((r) => r.urlPath === "/api/suggestions/similar")!;
    const statuses: number[] = [];
    for (let i = 0; i < 45; i++) {
      statuses.push((await call(route.handler, { path: "/api/suggestions/similar?q=hello", headers: { "x-forwarded-for": "198.51.100.9" } })).status);
    }
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
    expect(statuses.slice(0, 40).every((s) => s === 200)).toBe(true);

    const limited = await call(route.handler, { path: "/api/suggestions/similar?q=hello", headers: { "x-forwarded-for": "198.51.100.9" } });
    expect(limited.headers.get("retry-after")).toMatch(/^\d+$/);
    // Somebody else is unaffected.
    const other = await call(route.handler, { path: "/api/suggestions/similar?q=hello", headers: { "x-forwarded-for": "198.51.100.10" } });
    expect(other.status).toBe(200);
    resetRateLimitsForTests();
  });
});
