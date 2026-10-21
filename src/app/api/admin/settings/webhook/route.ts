import { webhookSchema } from "@/shared/schemas";
import { setWebhook } from "@/server/config";
import { defineApi } from "@/server/http";

/** Sets or clears (empty string) the Discord webhook. The stored value is never returned. */
export const PUT = defineApi({
  auth: "owner",
  body: webhookSchema,
  handler: async ({ req, user, body }) => setWebhook(user, body.url, req),
});
