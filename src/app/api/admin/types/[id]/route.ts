import { typeSchema } from "@/shared/schemas";
import { updateType, deleteType } from "@/server/config";
import { defineApi } from "@/server/http";
import { rowIdParam } from "@/server/params";

export const PUT = defineApi({
  auth: "owner",
  body: typeSchema,
  handler: async ({ req, user, body, params }) => {
    await updateType(user, rowIdParam(params), body, req);
    return { ok: true };
  },
});

export const DELETE = defineApi({
  auth: "owner",
  handler: async ({ req, user, params }) => {
    await deleteType(user, rowIdParam(params), req);
    return { ok: true };
  },
});
