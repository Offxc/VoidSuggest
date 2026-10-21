import Link from "next/link";
import { timeAgo } from "@/shared/format";
import type { SuggestionCardDto, ViewerDto } from "@/shared/types";
import { Icon } from "./icons";
import { Person } from "./Person";
import { StatusPill, TagPill, TypePill } from "./Pills";
import { VoteButton } from "./VoteButton";

interface Props {
  item: SuggestionCardDto;
  viewer: ViewerDto | null;
  loginHref: string;
  /** Show the approval state (for "my submissions"). */
  showApproval?: boolean;
  /** Skip the status pill, for lists that are already one status. */
  hideStatus?: boolean;
  children?: React.ReactNode;
}

export function SuggestionCard({ item, viewer, loginHref, showApproval = false, hideStatus = false, children }: Props) {
  const approved = item.approval === "APPROVED";
  return (
    <article className="s-card">
      {approved && item.status ? (
        <VoteButton
          publicId={item.publicId}
          count={item.voteCount}
          voted={item.viewerHasVoted}
          open={item.status.votingOpen}
          eligible={viewer !== null && viewer.participationMessage === null}
          signedIn={viewer !== null}
          remaining={viewer?.budget?.remaining ?? null}
          loginHref={loginHref}
        />
      ) : (
        <div className="vote vote-static" aria-hidden="true">
          <Icon name="clock" className="arrow" />
          <span className="lbl">{item.approval === "PENDING" ? "Pending" : "Declined"}</span>
        </div>
      )}
      <div className="s-main">
        <h2 className="s-title">
          <Link href={`/s/${item.publicId}`}>{item.title}</Link>
        </h2>
        <p className="s-excerpt">{item.excerpt}</p>
        <div className="s-meta">
          {showApproval && !approved && (
            <span className={`pill tone-${item.approval === "PENDING" ? "amber" : "red"}`}>
              {item.approval === "PENDING" ? "Waiting for approval" : "Not accepted"}
            </span>
          )}
          {approved && item.status && !hideStatus && <StatusPill status={item.status} />}
          {item.type && <TypePill type={item.type} />}
          {item.tags.map((t) => (
            <TagPill key={t.id} tag={t} href={`/?tag=${t.slug}&status=${item.status?.slug ?? ""}`} />
          ))}
          <Person person={item.author} small />
          <span>{timeAgo(item.createdAt)}</span>
          {approved && item.commentsMode !== "OFF" && (
            <span title={item.commentsMode === "CLOSED" ? "Comments closed" : "Comments open"}>
              <Icon name="chat" /> {item.commentCount}
            </span>
          )}
        </div>
        {children && <div className="s-actions">{children}</div>}
      </div>
    </article>
  );
}
