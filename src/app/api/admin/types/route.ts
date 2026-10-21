import { typeSchema } from "@/shared/schemas";
import { createType } from "@/server/config";
import { defineApi } from "@/server/http";

export const POST = defineApi({
  auth: "owner",
  body: typeSchema,
  handler: async ({ req, user, body }) => createType(user, body, req),
});
