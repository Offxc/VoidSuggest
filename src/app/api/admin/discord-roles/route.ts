import { DiscordError, listGuildRoles } from "@/server/discord";
import { unavailable } from "@/server/errors";
import { defineApi } from "@/server/http";

/** Roles in the Discord server, for choosing which one counts as "Member". */
export const GET = defineApi({
  auth: "owner",
  handler: async () => {
    try {
      return { roles: await listGuildRoles() };
    } catch (err) {
      if (err instanceof DiscordError) throw unavailable("Couldn't read the server's roles. Check the bot is in the server.");
      throw err;
    }
  },
});
