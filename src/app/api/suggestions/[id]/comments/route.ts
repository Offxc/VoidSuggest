import { commentSchema } from "@/shared/schemas";
import { addComment } from "@/server/comments";
import { defineApi } from "@/server/http";
import { publicIdParam } from "@/server/params";

export const POST = defineApi({
  auth: "member",
  body: commentSchema,
  rate: { name: "comment", limit: 6, windowMs: 60_000, per: "user" },
  handler: async ({ user, body, params }) => addComment(user, publicIdParam(params), body.body),
});
