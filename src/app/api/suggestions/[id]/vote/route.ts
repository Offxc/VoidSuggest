import { defineApi } from "@/server/http";
import { publicIdParam } from "@/server/params";
import { castVote, retractVote } from "@/server/votes";

export const PUT = defineApi({
  auth: "member",
  rate: { name: "vote", limit: 30, windowMs: 60_000, per: "user" },
  handler: async ({ user, params }) => castVote(user, publicIdParam(params)),
});

export const DELETE = defineApi({
  auth: "member",
  skipTenure: true,
  rate: { name: "vote", limit: 30, windowMs: 60_000, per: "user" },
  handler: async ({ user, params }) => retractVote(user, publicIdParam(params)),
});
