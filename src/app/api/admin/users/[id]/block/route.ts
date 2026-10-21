import { blockUserSchema } from "@/shared/schemas";
import { defineApi } from "@/server/http";
import { rowIdParam } from "@/server/params";
import { blockUser } from "@/server/users";

export const POST = defineApi({
  auth: "owner",
  body: blockUserSchema,
  handler: async ({ req, user, body, params }) => {
    await blockUser(user, rowIdParam(params), body.reason, req);
    return { ok: true };
  },
});
