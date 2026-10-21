import { reorderSchema } from "@/shared/schemas";
import { reorderTags } from "@/server/config";
import { defineApi } from "@/server/http";

export const POST = defineApi({
  auth: "owner",
  body: reorderSchema,
  handler: async ({ user, body }) => {
    await reorderTags(user, body.ids);
    return { ok: true };
  },
});
