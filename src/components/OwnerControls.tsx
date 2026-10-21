"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import type { Approval, CommentsModeDto, StatusDto } from "@/shared/types";
import { ActionButton } from "./ActionButton";
import { api } from "./api-client";

interface Props {
  publicId: string;
  approval: Approval;
  statusId: string | null;
  statuses: StatusDto[];
  commentsMode: CommentsModeDto;
  commentCount: number;
}

interface Voter {
  userId: string;
  displayName: string;
  votedAt: string;
}

/** Everything the owner can do to one suggestion, from its own page. */
export function OwnerControls({ publicId, approval, statusId, statuses, commentsMode, commentCount }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [target, setTarget] = useState(statusId ?? "");
  const [reason, setReason] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [voters, setVoters] = useState<Voter[] | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  const refresh = () => startTransition(() => router.refresh());

  async function move() {
    setMessage(null);
    const result = await api<{ statusName: string; commentsClosed: boolean; votesReturned: number }>(
      "POST",
      `/api/admin/suggestions/${publicId}/status`,
      { statusId: target },
    );
    if (!result.ok || !result.data) return setMessage({ tone: "bad", text: result.message ?? "Couldn't move it." });
    const parts = [`Moved to ${result.data.statusName}.`];
    if (result.data.votesReturned > 0) parts.push(`${result.data.votesReturned} vote${result.data.votesReturned === 1 ? "" : "s"} returned.`);
    if (result.data.commentsClosed) parts.push("Comments closed.");
    setMessage({ tone: "ok", text: parts.join(" ") });
    refresh();
  }

  async function setComments(mode: CommentsModeDto) {
    setMessage(null);
    const result = await api("POST", `/api/admin/suggestions/${publicId}/comments-mode`, { mode });
    if (!result.ok) return setMessage({ tone: "bad", text: result.message ?? "Couldn't change comments." });
    refresh();
  }

  async function reject() {
    const result = await api("POST", `/api/admin/suggestions/${publicId}/reject`, { reason });
    if (!result.ok) return setMessage({ tone: "bad", text: result.message ?? "Couldn't reject it." });
    setRejecting(false);
    refresh();
  }

  async function removeVote(voter: Voter) {
    if (!window.confirm(`Remove ${voter.displayName}'s vote?`)) return;
    const result = await api("DELETE", `/api/admin/suggestions/${publicId}/votes/${voter.userId}`);
    if (!result.ok) return setMessage({ tone: "bad", text: result.message ?? "Couldn't remove that vote." });
    // The page refreshes behind the dialog, but the dialog keeps its own copy of the list.
    setVoters((current) => (current ?? []).filter((v) => v.userId !== voter.userId));
    refresh();
  }

  async function showVoters() {
    const result = await api<{ voters: Voter[] }>("GET", `/api/admin/suggestions/${publicId}/voters`);
    if (!result.ok || !result.data) return setMessage({ tone: "bad", text: result.message ?? "Couldn't load voters." });
    setVoters(result.data.voters);
    dialog.current?.showModal();
  }

  return (
    <div className="stack">
      {approval !== "APPROVED" && (
        <div className="stack">
          <div className="row">
            <ActionButton method="POST" url={`/api/admin/suggestions/${publicId}/approve`} label="Approve" className="btn btn-ok btn-sm" />
            {approval === "PENDING" && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRejecting((v) => !v)}>
                Reject…
              </button>
            )}
          </div>
          {rejecting && (
            <div className="field">
              <label htmlFor="reject-reason">Reason (only the author sees this)</label>
              <textarea id="reject-reason" className="textarea" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
              <div className="row">
                <button type="button" className="btn btn-danger btn-sm" onClick={reject}>
                  Reject suggestion
                </button>
                <button type="button" className="btn btn-quiet" onClick={() => setRejecting(false)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {approval === "APPROVED" && (
        <>
          <div className="field">
            <label htmlFor="move-status">Move to</label>
            <div className="row">
              <select id="move-status" className="select grow" value={target} onChange={(e) => setTarget(e.target.value)}>
                {statuses.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.votingOpen ? "" : " (voting closed)"}
                  </option>
                ))}
              </select>
              <button type="button" className="btn btn-sm" onClick={move} disabled={target === statusId || !target}>
                Move
              </button>
            </div>
          </div>

          <div className="field">
            <label htmlFor="comments-mode">Comments</label>
            <select id="comments-mode" className="select" value={commentsMode} onChange={(e) => setComments(e.target.value as CommentsModeDto)}>
              <option value="OFF" disabled={commentCount > 0}>
                Off
              </option>
              <option value="OPEN">Open</option>
              <option value="CLOSED">Closed (read only)</option>
            </select>
          </div>

          <button type="button" className="btn btn-ghost btn-sm" onClick={showVoters}>
            See who voted
          </button>
        </>
      )}

      <div className="row">
        <a className="btn btn-ghost btn-sm" href={`/s/${publicId}/edit`}>
          Edit
        </a>
        <ActionButton
          method="DELETE"
          url={`/api/suggestions/${publicId}`}
          label="Delete"
          className="btn btn-danger btn-sm"
          confirm="Delete this suggestion for good? Its votes and comments go with it."
          redirectTo="/"
        />
      </div>

      {message && (
        <p role="status" className={`status-msg ${message.tone}`}>
          {message.text}
        </p>
      )}

      <dialog ref={dialog} className="modal" aria-labelledby="voters-title">
        <div className="modal-body">
          <h2 id="voters-title">Who voted</h2>
          {voters && voters.length === 0 && <p className="muted">Nobody yet.</p>}
          <ul className="copy-list">
            {voters?.map((v) => (
              <li key={v.userId}>
                <span>{v.displayName}</span>
                <button type="button" className="btn btn-quiet" onClick={() => removeVote(v)}>
                  Remove vote
                </button>
              </li>
            ))}
          </ul>
          <div className="row" role="group" aria-label="Dialog actions">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                dialog.current?.close();
                refresh();
              }}
            >
              Close
            </button>
          </div>
        </div>
      </dialog>
    </div>
  );
}
