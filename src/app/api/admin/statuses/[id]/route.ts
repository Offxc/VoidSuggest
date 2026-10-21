import { statusSchema } from "@/shared/schemas";
import { updateStatus, deleteStatus } from "@/server/config";
import { defineApi } from "@/server/http";
import { rowIdParam } from "@/server/params";

export const PUT = defineApi({
  auth: "owner",
  body: statusSchema,
  handler: async ({ req, user, body, params }) => {
    await updateStatus(user, rowIdParam(params), body, req);
    return { ok: true };
  },
});

export const DELETE = defineApi({
  auth: "owner",
  handler: async ({ req, user, params }) => {
    await deleteStatus(user, rowIdParam(params), req);
    return { ok: true };
  },
});
