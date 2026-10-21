import { guidelineSchema } from "@/shared/schemas";
import { updateGuideline, deleteGuideline } from "@/server/config";
import { defineApi } from "@/server/http";
import { rowIdParam } from "@/server/params";

export const PUT = defineApi({
  auth: "owner",
  body: guidelineSchema,
  handler: async ({ req, user, body, params }) => {
    await updateGuideline(user, rowIdParam(params), body, req);
    return { ok: true };
  },
});

export const DELETE = defineApi({
  auth: "owner",
  handler: async ({ req, user, params }) => {
    await deleteGuideline(user, rowIdParam(params), req);
    return { ok: true };
  },
});
