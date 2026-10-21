import { rejectSchema } from "@/shared/schemas";
import { defineApi } from "@/server/http";
import { publicIdParam } from "@/server/params";
import { rejectSuggestion } from "@/server/suggestions";

export const POST = defineApi({
  auth: "owner",
  body: rejectSchema,
  handler: async ({ req, user, body, params }) => {
    await rejectSuggestion(user, publicIdParam(params), body.reason, req);
    return { ok: true };
  },
});
