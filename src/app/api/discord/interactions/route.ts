import { defineApi } from "@/server/http";
import { handleInteraction, interactionSchema } from "@/server/interactions";

/**
 * Where Discord sends button clicks. Not for browsers: there is no session
 * here, and every request must carry Discord's signature (`auth: "discord"`).
 * The limit is generous because Discord's requests share a few addresses.
 */
export const POST = defineApi({
  auth: "discord",
  body: interactionSchema,
  rate: { name: "discord-interactions", limit: 1200, windowMs: 60_000 },
  handler: async ({ body }) => handleInteraction(body),
});
