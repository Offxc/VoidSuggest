import { commentsModeSchema } from "@/shared/schemas";
import { defineApi } from "@/server/http";
import { publicIdParam } from "@/server/params";
import { setCommentsMode } from "@/server/suggestions";

export const POST = defineApi({
  auth: "owner",
  body: commentsModeSchema,
  handler: async ({ req, user, body, params }) => {
    await setCommentsMode(user, publicIdParam(params), body.mode, req);
    return { ok: true };
  },
});
