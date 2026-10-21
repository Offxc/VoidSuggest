import { defineApi } from "@/server/http";
import { rowIdParam } from "@/server/params";
import { strikeAllVotes } from "@/server/votes";

/** Removes every vote a person has cast. */
export const DELETE = defineApi({
  auth: "owner",
  handler: async ({ req, user, params }) => ({ removed: await strikeAllVotes(user, rowIdParam(params), req) }),
});
