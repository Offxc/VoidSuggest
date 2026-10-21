import { reorderSchema } from "@/shared/schemas";
import { reorderTypes } from "@/server/config";
import { defineApi } from "@/server/http";

export const POST = defineApi({
  auth: "owner",
  body: reorderSchema,
  handler: async ({ user, body }) => {
    await reorderTypes(user, body.ids);
    return { ok: true };
  },
});
