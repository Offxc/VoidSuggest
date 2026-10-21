import { statusSchema } from "@/shared/schemas";
import { createStatus } from "@/server/config";
import { defineApi } from "@/server/http";

export const POST = defineApi({
  auth: "owner",
  body: statusSchema,
  handler: async ({ req, user, body }) => createStatus(user, body, req),
});
