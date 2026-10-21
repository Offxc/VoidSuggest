import { cache } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CommentActions } from "@/components/CommentActions";
import { CommentForm } from "@/components/CommentForm";
import { Icon } from "@/components/icons";
import { Markdown } from "@/components/Markdown";
import { OwnerControls } from "@/components/OwnerControls";
import { ParticipationNotice } from "@/components/ParticipationNotice";
import { Person } from "@/components/Person";
import { StatusPill, TagPill, TypePill } from "@/components/Pills";
import { VoteButton } from "@/components/VoteButton";
import { formatDateTime, timeAgo } from "@/shared/format";
import type { TimelineDto } from "@/shared/types";
import { getUser, getViewer, loginUrl } from "@/server/current";
import { toSite } from "@/server/dto";
import { getComments, getStatuses, getSuggestion } from "@/server/queries";
import { getSettings } from "@/server/settings";

const PUBLIC_ID = /^[0-9A-HJKMNP-TV-Z]{8}$/;

const load = cache(async (id: string) => {
  if (!PUBLIC_ID.test(id)) return null;
  return getSuggestion(await getUser(), id);
});

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const detail = await load((await params).id);
  return { title: detail?.title ?? "Not found" };
}

function describe(e: TimelineDto): string {
  switch (e.kind) {
    case "SUBMITTED":
      return "Suggested";
    case "APPROVED":
      return `Approved${e.toStatusName ? ` and added to ${e.toStatusName}` : ""}`;
    case "STATUS_CHANGED":
      return `Moved from ${e.fromStatusName ?? "?"} to ${e.toStatusName ?? "?"}`;
    case "COMMENTS_OPENED":
      return "Comments opened";
    case "COMMENTS_CLOSED":
      return "Comments closed";
    case "EDITED":
      return "Edited by the owner";
  }
}

export default async function SuggestionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await load(id);
  if (!detail) notFound();

  const [user, viewer, settings] = await Promise.all([getUser(), getViewer(), getSettings()]);
  const site = toSite(settings);
  const approved = detail.approval === "APPROVED";
  const [comments, statuses] = await Promise.all([
    approved ? getComments(user, id) : Promise.resolve([]),
    user?.isOwner ? getStatuses() : Promise.resolve([]),
  ]);
  const eligible = viewer !== null && viewer.participationMessage === null;
  const here = `/s/${id}`;

  return (
    <div className="stack-lg">
      <p>
        <Link href="/" className="small muted">
          ← Back to the board
        </Link>
      </p>

      {detail.approval === "PENDING" && (
        <div className="notice-bar warn" role="status">
          {detail.viewerIsAuthor
            ? "Thanks! This is waiting for approval. Only you and the owner can see it until it's approved, and you can still edit or withdraw it."
            : "This suggestion is waiting for approval and isn't public yet."}
        </div>
      )}
      {detail.approval === "REJECTED" && (
        <div className="notice-bar bad" role="status">
          This suggestion wasn't accepted.{detail.rejectionReason ? ` Reason: ${detail.rejectionReason}` : ""}
        </div>
      )}

      <div className="detail">
        <div className="stack-lg">
          <div className="detail-head">
            {approved && detail.status ? (
              <VoteButton
                publicId={detail.publicId}
                count={detail.voteCount}
                voted={detail.viewerHasVoted}
                open={detail.status.votingOpen}
                eligible={eligible}
                signedIn={viewer !== null}
                remaining={viewer?.budget?.remaining ?? null}
                loginHref={loginUrl(here)}
                large
              />
            ) : null}
            <div className="grow">
              <h1 className="detail-title">{detail.title}</h1>
              <div className="detail-meta">
                <Person person={detail.author} />
                <span title={formatDateTime(detail.createdAt)}>{timeAgo(detail.createdAt)}</span>
                {approved && detail.status && <StatusPill status={detail.status} />}
                {detail.type && <TypePill type={detail.type} />}
                {detail.tags.map((t) => (
                  <TagPill key={t.id} tag={t} href={`/?tag=${t.slug}`} />
                ))}
              </div>
            </div>
          </div>

          <ParticipationNotice viewer={viewer} site={site} />

          <div className="panel panel-pad">
            <Markdown>{detail.body}</Markdown>
          </div>

          {approved && detail.commentsMode !== "OFF" && (
            <section className="stack" aria-labelledby="comments-title">
              <h2 id="comments-title" className="section-title">
                Comments {detail.commentCount > 0 && <span className="dim">({detail.commentCount})</span>}
              </h2>
              {comments.length === 0 && <p className="muted">No comments yet.</p>}
              <div className="comments">
                {comments.map((c) => (
                  <div key={c.id} className={`comment ${c.deleted ? "removed" : ""}`}>
                    <img className="avatar avatar-lg" src={c.author.avatarUrl} alt="" width={40} height={40} loading="lazy" referrerPolicy="no-referrer" />
                    <div className="comment-body">
                      <div className="comment-head">
                        <Person person={{ ...c.author, avatarUrl: "" }} small hideAvatar />
                        <span title={formatDateTime(c.createdAt)}>{timeAgo(c.createdAt)}</span>
                        {c.editedAt && <span>(edited)</span>}
                      </div>
                      {c.deleted ? (
                        <p>This comment was removed.</p>
                      ) : (
                        <>
                          <Markdown>{c.body ?? ""}</Markdown>
                          <CommentActions id={c.id} body={c.body ?? ""} canEdit={c.canEdit} canDelete={c.canDelete} />
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {detail.commentsMode === "CLOSED" ? (
                <div className="notice-bar">
                  <Icon name="lock" /> Comments are closed on this suggestion.
                </div>
              ) : viewer === null ? (
                <p>
                  <a href={loginUrl(here)}>Sign in</a> to join the conversation.
                </p>
              ) : eligible ? (
                <CommentForm publicId={detail.publicId} />
              ) : null}
            </section>
          )}
        </div>

        <aside className="sticky-side panel" aria-label="Details">
          {approved && detail.status && (
            <div className="side-block">
              <h3>Status</h3>
              <div className="row">
                <StatusPill status={detail.status} />
              </div>
              <p className="small dim">
                {detail.status.votingOpen ? "Voting is open." : "Voting is closed. The votes below are what it ended with."}
              </p>
            </div>
          )}
          <div className="side-block">
            <h3>History</h3>
            <ul className="timeline">
              {detail.timeline.map((e) => (
                <li key={e.id}>
                  {describe(e)}
                  <time dateTime={e.createdAt}>{formatDateTime(e.createdAt)}</time>
                </li>
              ))}
            </ul>
          </div>
          {detail.viewerIsAuthor && detail.approval === "PENDING" && !user?.isOwner && (
            <div className="side-block">
              <h3>Your suggestion</h3>
              <div className="row">
                <Link className="btn btn-ghost btn-sm" href={`/s/${id}/edit`}>
                  Edit
                </Link>
              </div>
            </div>
          )}
          {user?.isOwner && (
            <div className="side-block">
              <h3>Owner</h3>
              <OwnerControls
                publicId={detail.publicId}
                approval={detail.approval}
                statusId={detail.status?.id ?? null}
                statuses={statuses}
                commentsMode={detail.commentsMode}
                commentCount={detail.commentCount}
              />
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
