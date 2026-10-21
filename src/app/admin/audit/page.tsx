import type { Metadata } from "next";
import Link from "next/link";
import { formatDateTime } from "@/shared/format";
import { cleanLine } from "@/shared/text";
import { requireOwner } from "@/server/current";
import { listAudit } from "@/server/users";

export const metadata: Metadata = { title: "Audit log" };

type SP = { action?: string; outcome?: string; actor?: string; page?: string };

export default async function AuditPage({ searchParams }: { searchParams: Promise<SP> }) {
  const owner = await requireOwner("/admin/audit");
  const sp = await searchParams;
  const page = Math.min(1000, Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1));
  const action = sp.action ? cleanLine(sp.action).slice(0, 64) : undefined;
  const actor = sp.actor ? cleanLine(sp.actor).slice(0, 64) : undefined;
  const outcome = sp.outcome === "SUCCESS" || sp.outcome === "DENIED" || sp.outcome === "FAILURE" ? sp.outcome : undefined;
  const list = await listAudit(owner, { action, actor, outcome, page });

  const filters = new URLSearchParams({ ...(action ? { action } : {}), ...(actor ? { actor } : {}), ...(outcome ? { outcome } : {}) });
  const link = (p: number) => `/admin/audit?${new URLSearchParams({ ...Object.fromEntries(filters), page: String(p) }).toString()}`;

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Audit log</h1>
          <p>Sign-ins, moderation and settings changes. It can only be added to, never edited or deleted from inside the app.</p>
        </div>
        <a className="btn btn-ghost btn-sm" href={`/api/admin/audit/export?${filters.toString()}`}>Export CSV</a>
      </div>

      <form className="toolbar" method="get" role="search">
        <label className="sr-only" htmlFor="au-actor">Person</label>
        <input id="au-actor" className="input" name="actor" placeholder="Person" defaultValue={actor ?? ""} maxLength={64} />
        <label className="sr-only" htmlFor="au-action">Action</label>
        <input id="au-action" className="input" name="action" placeholder="Action, e.g. suggestion." defaultValue={action ?? ""} maxLength={64} />
        <label className="sr-only" htmlFor="au-outcome">Outcome</label>
        <select id="au-outcome" className="select" name="outcome" defaultValue={outcome ?? ""}>
          <option value="">Any outcome</option>
          <option value="SUCCESS">Success</option>
          <option value="DENIED">Denied</option>
          <option value="FAILURE">Failure</option>
        </select>
        <button type="submit" className="btn btn-ghost btn-sm">Filter</button>
      </form>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr><th>When</th><th>Who</th><th>Action</th><th>Result</th><th>Details</th></tr>
          </thead>
          <tbody>
            {list.items.map((row) => (
              <tr key={String(row.id)}>
                <td className="small"><time dateTime={row.createdAt.toISOString()}>{formatDateTime(row.createdAt.toISOString())}</time></td>
                <td>{row.actorName}</td>
                <td className="mono small">{row.action}</td>
                <td>
                  <span className={`pill tone-${row.outcome === "SUCCESS" ? "green" : row.outcome === "DENIED" ? "amber" : "red"}`}>{row.outcome.toLowerCase()}</span>
                </td>
                <td className="small muted">
                  {[row.targetType && `${row.targetType}${row.targetId ? ` ${row.targetId}` : ""}`, row.details ? JSON.stringify(row.details) : null]
                    .filter(Boolean)
                    .join(" · ")}
                </td>
              </tr>
            ))}
            {list.items.length === 0 && (
              <tr><td colSpan={5} className="muted">Nothing matches.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {list.pageCount > 1 && (
        <nav className="pager" aria-label="Pages">
          {page > 1 ? <Link className="btn btn-ghost btn-sm" href={link(page - 1)}>Newer</Link> : <span />}
          <span>Page {page} of {list.pageCount}</span>
          {page < list.pageCount ? <Link className="btn btn-ghost btn-sm" href={link(page + 1)}>Older</Link> : <span />}
        </nav>
      )}
    </>
  );
}
