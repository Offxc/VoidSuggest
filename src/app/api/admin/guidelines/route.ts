import { guidelineSchema } from "@/shared/schemas";
import { createGuideline } from "@/server/config";
import { defineApi } from "@/server/http";

export const POST = defineApi({
  auth: "owner",
  body: guidelineSchema,
  handler: async ({ req, user, body }) => createGuideline(user, body, req),
});
