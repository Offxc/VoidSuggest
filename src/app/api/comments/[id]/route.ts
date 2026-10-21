import { commentSchema } from "@/shared/schemas";
import { deleteComment, editComment } from "@/server/comments";
import { defineApi } from "@/server/http";
import { rowIdParam } from "@/server/params";

export const PATCH = defineApi({
  auth: "member",
  skipTenure: true,
  body: commentSchema,
  rate: { name: "comment-edit", limit: 20, windowMs: 60_000, per: "user" },
  handler: async ({ user, body, params }) => {
    await editComment(user, rowIdParam(params), body.body);
    return { ok: true };
  },
});

export const DELETE = defineApi({
  auth: "member",
  skipTenure: true,
  rate: { name: "comment-edit", limit: 20, windowMs: 60_000, per: "user" },
  handler: async ({ req, user, params }) => {
    await deleteComment(user, rowIdParam(params), req);
    return { ok: true };
  },
});
