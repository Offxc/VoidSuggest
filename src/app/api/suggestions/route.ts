import { createSuggestionSchema } from "@/shared/schemas";
import { defineApi } from "@/server/http";
import { createSuggestion } from "@/server/suggestions";

export const POST = defineApi({
  auth: "member",
  body: createSuggestionSchema,
  rate: { name: "submit", limit: 10, windowMs: 60_000, per: "user" },
  handler: async ({ req, user, body }) => createSuggestion(user, body, req),
});
