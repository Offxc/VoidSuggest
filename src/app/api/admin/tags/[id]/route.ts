import { tagSchema } from "@/shared/schemas";
import { updateTag, deleteTag } from "@/server/config";
import { defineApi } from "@/server/http";
import { rowIdParam } from "@/server/params";

export const PUT = defineApi({
  auth: "owner",
  body: tagSchema,
  handler: async ({ req, user, body, params }) => {
    await updateTag(user, rowIdParam(params), body, req);
    return { ok: true };
  },
});

export const DELETE = defineApi({
  auth: "owner",
  handler: async ({ req, user, params }) => {
    await deleteTag(user, rowIdParam(params), req);
    return { ok: true };
  },
});
