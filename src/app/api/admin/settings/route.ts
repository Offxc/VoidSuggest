import { settingsSchema } from "@/shared/schemas";
import { updateSettings } from "@/server/config";
import { defineApi } from "@/server/http";

export const PATCH = defineApi({
  auth: "owner",
  body: settingsSchema,
  handler: async ({ req, user, body }) => {
    await updateSettings(user, body, req);
    return { ok: true };
  },
});
