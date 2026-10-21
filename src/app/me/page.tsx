import type { Metadata } from "next";
import Link from "next/link";
import { BudgetChip } from "@/components/BudgetChip";
import { MarkNoticesRead } from "@/components/MarkNoticesRead";
import { ParticipationNotice } from "@/components/ParticipationNotice";
import { SignOutButton } from "@/components/SignOutButton";
import { SuggestionCard } from "@/components/SuggestionCard";
import { timeAgo } from "@/shared/format";
import type { NoticeDto } from "@/shared/types";
import { getViewer, loginUrl, requireUser } from "@/server/current";
import { toSite } from "@/server/dto";
import { listNotices } from "@/server/notices";
import { getMySuggestions, getMyVotes } from "@/server/queries";
import { getSettings } from "@/server/settings";

export const metadata: Metadata = { title: "Your activity" };

const TABS = [
  { key: "submissions", label: "Your suggestions" },
  { key: "votes", label: "Your votes" },
  { key: "notices", label: "Notices" },
] as const;

function noticeText(n: NoticeDto): string {
  switch (n.kind) {
    case "SUGGESTION_APPROVED":
      return `"${n.suggestionTitle}" was approved and is now on the board.`;
    case "SUGGESTION_REJECTED":
      return `"${n.suggestionTitle}" wasn't accepted.`;
    case "STATUS_CHANGED":
      return `"${n.suggestionTitle}" moved to ${n.statusName ?? "a new status"}.${n.voteReturned ? " Your vote was returned, so you can use it again." : ""}`;
  }
}

export default async function MePage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requireUser("/me");
  const [viewer, settings, { tab: requested }] = await Promise.all([getViewer(), getSettings(), searchParams]);
  const site = toSite(settings);
  const unread = viewer?.unreadNotices ?? 0;
  const tab = TABS.find((t) => t.key === requested)?.key ?? (unread > 0 ? "notices" : "submissions");
  const loginHref = loginUrl("/me");

  const [mine, votes, notices] = await Promise.all([
    tab === "submissions" ? getMySuggestions(user) : null,
    tab === "votes" ? getMyVotes(user) : null,
    tab === "notices" ? listNotices(user) : null,
  ]);

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div className="row">
          <img className="avatar avatar-lg" src={viewer?.avatarUrl} alt="" width={40} height={40} referrerPolicy="no-referrer" />
          <div>
            <h1 className="page-title">{viewer?.name}</h1>
          </div>
        </div>
        <div className="row">
          {viewer?.budget && <BudgetChip budget={viewer.budget} />}
          <SignOutButton />
        </div>
      </div>

      <ParticipationNotice viewer={viewer} site={site} />

      <div>
        <nav className="tabs" aria-label="Your activity">
          {TABS.map((t) => (
            <Link key={t.key} href={`/me?tab=${t.key}`} aria-current={t.key === tab ? "page" : undefined}>
              {t.label}
              {t.key === "notices" && unread > 0 && <span className="badge-dot"> {unread}</span>}
            </Link>
          ))}
        </nav>

        {mine && (
          mine.length === 0 ? (
            <div className="panel empty">
              <span className="pixel">Nothing yet</span>
              <p>
                You haven't suggested anything. <Link href="/new">Suggest something</Link>.
              </p>
            </div>
          ) : (
            <div className="s-list">
              {mine.map((item) => (
                <SuggestionCard key={item.publicId} item={item} viewer={viewer} loginHref={loginHref} showApproval />
              ))}
            </div>
          )
        )}

        {votes && (
          <div className="stack-lg">
            <section className="stack" aria-labelledby="using-slots">
              <h2 id="using-slots" className="section-title">
                Using a vote
              </h2>
              <p className="muted">These are still open. Remove a vote to free it up for something else.</p>
              {votes.occupying.length === 0 ? (
                <div className="panel empty">
                  <p>You haven't voted for anything that's still open. <Link href="/">Browse the board</Link>.</p>
                </div>
              ) : (
                <div className="s-list">
                  {votes.occupying.map((item) => (
                    <SuggestionCard key={item.publicId} item={item} viewer={viewer} loginHref={loginHref} />
                  ))}
                </div>
              )}
            </section>
            {votes.settled.length > 0 && (
              <section className="stack" aria-labelledby="settled">
                <h2 id="settled" className="section-title">
                  Votes that moved on
                </h2>
                <p className="muted">Voting has closed on these. Your vote still counts for them, but it no longer uses up one of yours.</p>
                <div className="s-list">
                  {votes.settled.map((item) => (
                    <SuggestionCard key={item.publicId} item={item} viewer={viewer} loginHref={loginHref} />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}

        {notices && (
          <>
            <MarkNoticesRead unread={unread} />
            {notices.length === 0 ? (
              <div className="panel empty">
                <span className="pixel">All quiet</span>
                <p>You'll hear about approvals, status changes and returned votes here.</p>
              </div>
            ) : (
              <ul className="notice-list">
                {notices.map((n) => (
                  <li key={n.id} className={n.read ? "" : "unread"}>
                    {n.suggestionPublicId ? <Link href={`/s/${n.suggestionPublicId}`}>{noticeText(n)}</Link> : noticeText(n)}
                    <time dateTime={n.createdAt}>{timeAgo(n.createdAt)}</time>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}
