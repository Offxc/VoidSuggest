import { DiscordError } from "@/server/discord";
import { badRequest } from "@/server/errors";
import { defineApi } from "@/server/http";
import { sendTestMessage } from "@/server/webhook";

export const POST = defineApi({
  auth: "owner",
  rate: { name: "webhook-test", limit: 5, windowMs: 60_000, per: "user" },
  handler: async () => {
    try {
      await sendTestMessage();
      return { ok: true };
    } catch (err) {
      if (err instanceof DiscordError) throw badRequest("Discord didn't accept the test message. Check the webhook URL.", "webhook_failed");
      throw err;
    }
  },
});
