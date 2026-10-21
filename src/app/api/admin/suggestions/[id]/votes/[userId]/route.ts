import { defineApi } from "@/server/http";
import { publicIdParam, rowIdParam } from "@/server/params";
import { strikeVote } from "@/server/votes";

export const DELETE = defineApi({
  auth: "owner",
  handler: async ({ req, user, params }) => {
    await strikeVote(user, publicIdParam(params), rowIdParam(params, "userId"), req);
    return { ok: true };
  },
});
