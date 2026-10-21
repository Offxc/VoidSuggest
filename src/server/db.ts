import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";

export { Prisma } from "../../generated/prisma/client";
export type {
  AuditLog,
  Comment,
  Guideline,
  Notice,
  Settings,
  Status,
  Suggestion,
  SuggestionType,
  Tag,
  User,
} from "../../generated/prisma/client";
export type { ApprovalState, CommentsMode } from "../../generated/prisma/enums";

// One client per process. `next dev` re-evaluates modules on every edit, and
// without caching on globalThis each edit would open a new connection pool.
const globalForPrisma = globalThis as unknown as { __voidsuggestPrisma?: PrismaClient };

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. See .env.example.");
  }
  const adapter = new PrismaPg({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  return new PrismaClient({ adapter });
}

function getClient(): PrismaClient {
  globalForPrisma.__voidsuggestPrisma ??= createClient();
  return globalForPrisma.__voidsuggestPrisma;
}

/**
 * Created on first use rather than at import, so `next build` (which loads
 * every route module) works without a database.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getClient();
    const value = Reflect.get(client, prop, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});

export async function disconnectForTests(): Promise<void> {
  const client = globalForPrisma.__voidsuggestPrisma;
  if (client) {
    await client.$disconnect();
    globalForPrisma.__voidsuggestPrisma = undefined;
  }
}
