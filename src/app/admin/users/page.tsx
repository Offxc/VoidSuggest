import type { Metadata } from "next";
import Link from "next/link";
import { ActionButton } from "@/components/ActionButton";
import { BlockButton } from "@/components/BlockButton";
import { OwnerBadge } from "@/components/Pills";
import { formatDate, timeAgo } from "@/shared/format";
import { cleanLine } from "@/shared/text";
import { requireOwner } from "@/server/current";
import { listUsers } from "@/server/users";

export const metadata: Metadata = { title: "People" };

export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const owner = await requireOwner("/admin/users");
  const sp = await searchParams;
  const page = Math.min(500, Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1));
  const q = sp.q ? cleanLine(sp.q).slice(0, 64) : undefined;
  const list = await listUsers(owner, { q, page });
  const link = (p: number) => `/admin/users?${new URLSearchParams({ ...(q ? { q } : {}), page: String(p) }).toString()}`;

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">People</h1>
          <p>Everyone who has signed in. Names and roles refresh from Discord automatically.</p>
        </div>
      </div>

      <form className="toolbar" method="get" role="search">
        <label className="sr-only" htmlFor="u-q">Search people</label>
        <input id="u-q" className="input search" name="q" type="search" placeholder="Search by name" defaultValue={q ?? ""} maxLength={64} />
        <button type="submit" className="btn btn-ghost btn-sm">Search</button>
      </form>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Person</th>
              <th>Status</th>
              <th>Suggestions</th>
              <th>Votes</th>
              <th>Last sign-in</th>
              <th><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {list.items.map((u) => (
              <tr key={u.id}>
                <td>
                  <span className="who">
                    <img className="avatar avatar-sm" src={u.avatarUrl} alt="" width={22} height={22} loading="lazy" referrerPolicy="no-referrer" />
                    {u.name} {u.isOwner && <OwnerBadge />}
                  </span>
                </td>
                <td>
                  {u.blocked ? (
                    <span className="pill tone-red" title={u.blockedReason ?? undefined}>Blocked</span>
                  ) : u.isOwner || u.isMember ? (
                    <span className="pill tone-green">{u.isOwner ? "Owner" : "Member"}</span>
                  ) : (
                    <span className="pill tone-gray" title="Left the server or lost the Member role">Not a member</span>
                  )}
                  {u.joinedGuildAt && <span className="dim small"> · joined {formatDate(u.joinedGuildAt)}</span>}
                </td>
                <td>{u.suggestions}</td>
                <td>{u.votes}</td>
                <td>{u.lastLoginAt ? timeAgo(u.lastLoginAt) : "—"}</td>
                <td>
                  {!u.isOwner && (
                    <span className="row">
                      {u.blocked ? (
                        <ActionButton method="POST" url={`/api/admin/users/${u.id}/unblock`} label="Unblock" className="btn btn-quiet" />
                      ) : (
                        <BlockButton userId={u.id} name={u.name} />
                      )}
                      {u.votes > 0 && (
                        <ActionButton
                          method="DELETE"
                          url={`/api/admin/users/${u.id}/votes`}
                          label="Remove votes"
                          className="btn btn-quiet"
                          confirm={`Remove all ${u.votes} of ${u.name}'s votes? This also affects suggestions where voting has closed.`}
                        />
                      )}
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {list.items.length === 0 && (
              <tr><td colSpan={6} className="muted">Nobody found.</td></tr>
            )}
          </tbody>
        </table>
      </div>

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
