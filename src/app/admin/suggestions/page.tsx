import type { Metadata } from "next";
import Link from "next/link";
import { SuggestionCard } from "@/components/SuggestionCard";
import { cleanLine } from "@/shared/text";
import { getViewer, requireOwner } from "@/server/current";
import { getAdminList, getStatuses } from "@/server/queries";

export const metadata: Metadata = { title: "All suggestions" };

type SP = { approval?: string; status?: string; q?: string; page?: string };

export default async function AdminSuggestionsPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireOwner("/admin/suggestions");
  const sp = await searchParams;
  const approval = sp.approval === "PENDING" || sp.approval === "APPROVED" || sp.approval === "REJECTED" ? sp.approval : undefined;
  const page = Math.min(500, Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1));
  const q = sp.q ? cleanLine(sp.q).slice(0, 80) : undefined;

  const [viewer, statuses, list] = await Promise.all([
    getViewer(),
    getStatuses(),
    getAdminList({ approval, status: sp.status || undefined, q, page }),
  ]);

  const params = new URLSearchParams();
  if (approval) params.set("approval", approval);
  if (sp.status) params.set("status", sp.status);
  if (q) params.set("q", q);
  const link = (p: number) => `/admin/suggestions?${new URLSearchParams({ ...Object.fromEntries(params), page: String(p) }).toString()}`;

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">All suggestions</h1>
          <p>{list.total} in total. Open one to move it between statuses, change its comments or remove it.</p>
        </div>
      </div>

      <form className="toolbar" method="get" role="search">
        <label className="sr-only" htmlFor="a-q">Search</label>
        <input id="a-q" className="input search" name="q" type="search" placeholder="Search title, text or author" defaultValue={q ?? ""} maxLength={80} />
        <label className="sr-only" htmlFor="a-approval">Approval</label>
        <select id="a-approval" className="select" name="approval" defaultValue={approval ?? ""}>
          <option value="">Any approval</option>
          <option value="PENDING">Waiting</option>
          <option value="APPROVED">Approved</option>
          <option value="REJECTED">Rejected</option>
        </select>
        <label className="sr-only" htmlFor="a-status">Status</label>
        <select id="a-status" className="select" name="status" defaultValue={sp.status ?? ""}>
          <option value="">Any status</option>
          {statuses.map((s) => (
            <option key={s.id} value={s.slug}>{s.name}</option>
          ))}
        </select>
        <button type="submit" className="btn btn-ghost btn-sm">Filter</button>
      </form>

      {list.items.length === 0 ? (
        <div className="panel empty">No suggestions match.</div>
      ) : (
        <div className="s-list">
          {list.items.map((item) => (
            <SuggestionCard key={item.publicId} item={item} viewer={viewer} loginHref="/" showApproval />
          ))}
        </div>
      )}

      {list.pageCount > 1 && (
        <nav className="pager" aria-label="Pages">
          {page > 1 ? <Link className="btn btn-ghost btn-sm" href={link(page - 1)}>Previous</Link> : <span />}
          <span>Page {page} of {list.pageCount}</span>
          {page < list.pageCount ? <Link className="btn btn-ghost btn-sm" href={link(page + 1)}>Next</Link> : <span />}
        </nav>
      )}
    </>
  );
}
