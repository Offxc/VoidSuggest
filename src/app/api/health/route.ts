import { prisma } from "@/server/db";
import { defineApi } from "@/server/http";

/** Liveness and database check, for the container health probe. Reveals nothing else. */
export const GET = defineApi({
  auth: "public",
  rate: { name: "health", limit: 120, windowMs: 60_000 },
  handler: async () => {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true };
  },
});
