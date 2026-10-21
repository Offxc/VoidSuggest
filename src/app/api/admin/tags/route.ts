import { tagSchema } from "@/shared/schemas";
import { createTag } from "@/server/config";
import { defineApi } from "@/server/http";

export const POST = defineApi({
  auth: "owner",
  body: tagSchema,
  handler: async ({ req, user, body }) => createTag(user, body, req),
});
