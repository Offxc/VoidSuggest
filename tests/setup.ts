import { afterAll } from "vitest";
import { disconnectForTests } from "@/server/db";
import { resetEnvForTests } from "@/server/env";

// Fixed, obviously fake values. Nothing here reaches a real service: Discord
// calls go to the local stand-in started by the tests that need it.
Object.assign(process.env, {
  NODE_ENV: "test",
  SESSION_SECRET: "test-session-secret-that-is-long-enough-123456",
  SITE_URL: "https://suggest.test",
  DISCORD_CLIENT_ID: "100000000000000001",
  DISCORD_CLIENT_SECRET: "test-client-secret",
  DISCORD_BOT_TOKEN: "test-bot-token-0123456789abcdef",
  DISCORD_GUILD_ID: "200000000000000001",
  CLIENT_IP_HEADER: "x-forwarded-for",
});
delete process.env.OWNER_DISCORD_ID;
resetEnvForTests();

afterAll(async () => {
  await disconnectForTests();
});
