import { defineApi } from "@/server/http";
import { publicIdParam } from "@/server/params";
import { approveSuggestion } from "@/server/suggestions";

export const POST = defineApi({
  auth: "owner",
  handler: async ({ req, user, params }) => {
    await approveSuggestion(user, publicIdParam(params), req);
    return { ok: true };
  },
});
