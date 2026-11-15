import { postAllSchema } from "@/shared/schemas";
import { boardOverview, startBackfill } from "@/server/board";
import { defineApi } from "@/server/http";

/** Posts every current suggestion that isn't in the channel yet. Returns at once; progress is read from the board status. */
export const POST = defineApi({
  auth: "owner",
  body: postAllSchema,
  rate: { name: "discord-board-post-all", limit: 6, windowMs: 60_000, per: "user" },
  handler: async ({ req, user, body }) => {
    await startBackfill(user, body, req);
    return boardOverview(user);
  },
});
