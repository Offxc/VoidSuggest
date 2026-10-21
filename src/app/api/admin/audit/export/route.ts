import { z } from "zod";
import { csvCell } from "@/server/audit";
import { defineApi } from "@/server/http";
import { exportAudit } from "@/server/users";

export const GET = defineApi({
  auth: "owner",
  rate: { name: "audit-export", limit: 5, windowMs: 60_000, per: "user" },
  query: z.object({
    action: z.string().max(64).optional(),
    outcome: z.enum(["SUCCESS", "DENIED", "FAILURE"]).optional(),
    actor: z.string().max(64).optional(),
  }),
  handler: async ({ user, query }) => {
    const rows = await exportAudit(user, query);
    const header = ["time", "actor", "action", "outcome", "target", "details", "ip"].join(",");
    const lines = rows.map((r) =>
      [
        r.createdAt.toISOString(),
        r.actorName,
        r.action,
        r.outcome,
        [r.targetType, r.targetId].filter(Boolean).join(":"),
        r.details ? JSON.stringify(r.details) : "",
        r.ip ?? "",
      ]
        .map(csvCell)
        .join(","),
    );
    return new Response([header, ...lines].join("\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="audit-log.csv"',
      },
    });
  },
});
