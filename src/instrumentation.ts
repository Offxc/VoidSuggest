/**
 * Runs once when the server starts (not during `next build`).
 *  - Validates the configuration, so a mistake stops the server here with a
 *    clear message rather than failing on someone's first request.
 *  - Creates the starter statuses, types and guidelines on a fresh database.
 *  - Starts the background job that keeps names and roles in step with Discord.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { getEnv } = await import("@/server/env");
  const env = getEnv();

  const { ensureDefaults } = await import("@/server/settings");
  await withRetries("preparing the database", () => ensureDefaults());

  if (env.MEMBER_SYNC_MINUTES > 0) {
    const { sweepMembers } = await import("@/server/identity");
    const run = async () => {
      try {
        const result = await sweepMembers();
        if (result) console.log(`[sync] checked ${result.checked} members, updated ${result.updated}, ${result.left} left`);
      } catch (err) {
        // Most often: "Server Members Intent" isn't switched on for the bot. Sign-in still works.
        console.error("[sync] member sync failed:", err instanceof Error ? err.message : "unknown error");
      }
    };
    setTimeout(run, 30_000).unref();
    setInterval(run, env.MEMBER_SYNC_MINUTES * 60_000).unref();
  }
}

async function withRetries(what: string, fn: () => Promise<void>, attempts = 10): Promise<void> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= attempts) throw err;
      console.warn(`[startup] ${what} failed (attempt ${i}/${attempts}), retrying...`);
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }
}
