import { defineApi } from "@/server/http";
import { markAllRead } from "@/server/notices";

export const POST = defineApi({
  auth: "member",
  skipTenure: true,
  rate: { name: "notices", limit: 30, windowMs: 60_000, per: "user" },
  handler: async ({ user }) => {
    await markAllRead(user.id);
    return { ok: true };
  },
});
