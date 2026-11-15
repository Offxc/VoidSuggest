import { discordBoardSchema } from "@/shared/schemas";
import { boardOverview, configureBoard } from "@/server/board";
import { defineApi } from "@/server/http";

/** Progress and settings for the Discord board. */
export const GET = defineApi({
  auth: "owner",
  handler: async ({ user }) => boardOverview(user),
});

/** Switches the board on or off and sets its channels. The channels are checked with Discord first. */
export const PUT = defineApi({
  auth: "owner",
  body: discordBoardSchema,
  rate: { name: "discord-board-config", limit: 20, windowMs: 60_000, per: "user" },
  handler: async ({ req, user, body }) => {
    await configureBoard(user, body, req);
    return boardOverview(user);
  },
});
