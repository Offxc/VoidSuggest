import { moveStatusSchema } from "@/shared/schemas";
import { defineApi } from "@/server/http";
import { publicIdParam } from "@/server/params";
import { moveSuggestion } from "@/server/suggestions";

export const POST = defineApi({
  auth: "owner",
  body: moveStatusSchema,
  handler: async ({ req, user, body, params }) => moveSuggestion(user, publicIdParam(params), body.statusId, req),
});
