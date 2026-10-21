"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { api } from "./api-client";
import { Icon } from "./icons";

interface Props {
  publicId: string;
  count: number;
  voted: boolean;
  /** Voting is open for this suggestion's status. */
  open: boolean;
  /** Whether this person is allowed to take part at all. */
  eligible: boolean;
  signedIn: boolean;
  /** Slots left, or null for unlimited. */
  remaining: number | null;
  loginHref: string;
  large?: boolean;
}

/**
 * The vote control. Clicking toggles the vote; if the person is out of
 * slots the server says so and the message is shown beside the button.
 */
export function VoteButton({ publicId, count, voted, open, eligible, signedIn, remaining, loginHref, large = false }: Props) {
  const router = useRouter();
  const [state, setState] = useState({ count, voted });
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  const className = `vote ${large ? "vote-lg" : ""}`;
  const face = (
    <>
      <Icon name="up" className="arrow" />
      <span className="num">{state.count}</span>
      <span className="lbl">{state.voted ? "Voted" : "Votes"}</span>
    </>
  );

  if (!open) {
    return (
      <div className={`${className} vote-static`} aria-label={`${state.count} votes. Voting is closed.`}>
        {face}
      </div>
    );
  }
  if (!signedIn) {
    return (
      <a className={className} href={loginHref} title="Sign in with Discord to vote" aria-label={`${state.count} votes. Sign in to vote.`}>
        {face}
      </a>
    );
  }
  const outOfVotes = remaining === 0 && !state.voted;

  async function toggle() {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    const result = await api<{ voteCount: number; hasVoted: boolean }>(state.voted ? "DELETE" : "PUT", `/api/suggestions/${publicId}/vote`);
    setBusy(false);
    if (!result.ok || !result.data) {
      setMessage(result.message);
      return;
    }
    setState({ count: result.data.voteCount, voted: result.data.hasVoted });
    startTransition(() => router.refresh());
  }

  return (
    <div className="vote-wrap">
      <button
        type="button"
        className={className}
        aria-pressed={state.voted}
        disabled={!eligible || busy || pending}
        onClick={toggle}
        title={!eligible ? "You can't vote right now" : outOfVotes ? "You're out of votes" : state.voted ? "Remove your vote" : "Vote for this"}
        aria-label={`${state.count} votes. ${state.voted ? "You voted. Press to remove your vote." : "Press to vote."}`}
      >
        {face}
      </button>
      {message && (
        <p role="alert" className="vote-msg">
          {message}
        </p>
      )}
    </div>
  );
}
