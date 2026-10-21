import { reorderSchema } from "@/shared/schemas";
import { reorderStatuses } from "@/server/config";
import { defineApi } from "@/server/http";

export const POST = defineApi({
  auth: "owner",
  body: reorderSchema,
  handler: async ({ user, body }) => {
    await reorderStatuses(user, body.ids);
    return { ok: true };
  },
});
