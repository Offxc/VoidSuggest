import { editSuggestionSchema } from "@/shared/schemas";
import { defineApi } from "@/server/http";
import { publicIdParam } from "@/server/params";
import { deleteSuggestion, updateSuggestion } from "@/server/suggestions";

/** Authors may edit or withdraw their own suggestion while it awaits approval; the owner may do either at any time. */
export const PATCH = defineApi({
  auth: "member",
  skipTenure: true,
  body: editSuggestionSchema,
  rate: { name: "edit", limit: 20, windowMs: 60_000, per: "user" },
  handler: async ({ req, user, body, params }) => {
    await updateSuggestion(user, publicIdParam(params), body, req);
    return { ok: true };
  },
});

export const DELETE = defineApi({
  auth: "member",
  skipTenure: true,
  rate: { name: "edit", limit: 20, windowMs: 60_000, per: "user" },
  handler: async ({ req, user, params }) => {
    await deleteSuggestion(user, publicIdParam(params), req);
    return { ok: true };
  },
});
