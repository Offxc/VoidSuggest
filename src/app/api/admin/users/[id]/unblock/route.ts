import { defineApi } from "@/server/http";
import { rowIdParam } from "@/server/params";
import { unblockUser } from "@/server/users";

export const POST = defineApi({
  auth: "owner",
  handler: async ({ req, user, params }) => {
    await unblockUser(user, rowIdParam(params), req);
    return { ok: true };
  },
});
