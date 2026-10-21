import { defineApi } from "@/server/http";
import { publicIdParam } from "@/server/params";
import { listVoters } from "@/server/votes";

/** Who voted. Visible to the owner only; the public sees counts. */
export const GET = defineApi({
  auth: "owner",
  handler: async ({ user, params }) => ({ voters: await listVoters(user, publicIdParam(params)) }),
});
