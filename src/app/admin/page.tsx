import Link from "next/link";
import { ActionButton } from "@/components/ActionButton";
import { SuggestionCard } from "@/components/SuggestionCard";
import { getViewer, requireOwner } from "@/server/current";
import { getAdminStats, getPendingQueue } from "@/server/queries";
import { getSettings } from "@/server/settings";

export default async function AdminQueuePage() {
  await requireOwner("/admin");
  const [viewer, stats, queue, settings] = await Promise.all([getViewer(), getAdminStats(), getPendingQueue(), getSettings()]);

  const setup = [
    { done: Boolean(settings.memberRoleId), text: "Choose which Discord role counts as “Member”", href: "/admin/settings" },
    { done: Boolean(settings.discordInviteUrl), text: "Add your Discord invite link (optional)", href: "/admin/settings", optional: true },
    { done: Boolean(settings.webhookUrlEnc), text: "Get a Discord message when something needs approval (optional)", href: "/admin/settings/notifications", optional: true },
  ];
  const needsSetup = setup.some((s) => !s.done && !s.optional);

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Queue</h1>
          <p>New suggestions wait here until you approve them. Approved ones go to the board and can be voted on.</p>
        </div>
      </div>

      {(needsSetup || setup.some((s) => !s.done)) && (
        <section className={`notice-bar ${needsSetup ? "warn" : ""}`} aria-label="Setup">
          <strong>{needsSetup ? "Finish setting up" : "Optional extras"}</strong>
          <ul className="setup-list">
            {setup.map((s) => (
              <li key={s.text}>
                <span aria-hidden="true">{s.done ? "✓" : "○"}</span>{" "}
                {s.done ? <span className="muted">{s.text}</span> : <Link href={s.href}>{s.text}</Link>}
              </li>
            ))}
          </ul>
          {needsSetup && <p className="small">Until a Member role is chosen, only you can sign in.</p>}
        </section>
      )}

      <div className="stat-grid">
        <div className="stat"><b>{stats.pending}</b><span>waiting for approval</span></div>
        <div className="stat"><b>{stats.live}</b><span>on the board</span></div>
        <div className="stat"><b>{stats.members}</b><span>members signed up</span></div>
        <div className="stat"><b>{stats.votes}</b><span>votes cast</span></div>
      </div>

      {queue.length === 0 ? (
        <div className="panel empty">
          <span className="pixel">All caught up</span>
          Nothing is waiting for approval.
        </div>
      ) : (
        <div className="s-list">
          {queue.map((item) => (
            <SuggestionCard key={item.publicId} item={item} viewer={viewer} loginHref="/" showApproval>
              <ActionButton method="POST" url={`/api/admin/suggestions/${item.publicId}/approve`} label="Approve" className="btn btn-ok btn-sm" />
              <Link className="btn btn-ghost btn-sm" href={`/s/${item.publicId}`}>
                Review or reject
              </Link>
            </SuggestionCard>
          ))}
        </div>
      )}
    </>
  );
}
