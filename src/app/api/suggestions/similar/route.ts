import { z } from "zod";
import { LIMITS } from "@/shared/constants";
import { cleanLine } from "@/shared/text";
import { defineApi } from "@/server/http";
import { findSimilar } from "@/server/queries";

/** Existing suggestions that look like what someone is typing, to cut down on duplicates. */
export const GET = defineApi({
  auth: "public",
  rate: { name: "similar", limit: 40, windowMs: 60_000 },
  query: z.object({ q: z.string().max(LIMITS.titleMax).transform(cleanLine) }),
  handler: async ({ query }) => ({ items: await findSimilar(query.q) }),
});
