"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { LIMITS } from "@/shared/constants";
import { ActionButton } from "./ActionButton";
import { api } from "./api-client";

export function CommentActions({ id, body, canEdit, canDelete }: { id: string; body: string; canEdit: boolean; canDelete: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(body);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function save() {
    setError(null);
    const result = await api("PATCH", `/api/comments/${id}`, { body: text });
    if (!result.ok) return setError(result.fieldErrors?.body?.[0] ?? result.message);
    setEditing(false);
    startTransition(() => router.refresh());
  }

  return (
    <div className="stack">
      {editing && (
        <div className="stack">
          <label className="sr-only" htmlFor={`edit-${id}`}>
            Edit your comment
          </label>
          <textarea id={`edit-${id}`} className="textarea" rows={3} maxLength={LIMITS.commentMax} value={text} onChange={(e) => setText(e.target.value)} />
          {error && (
            <p role="alert" className="error-text">
              {error}
            </p>
          )}
          <div className="row">
            <button type="button" className="btn btn-sm" onClick={save}>
              Save
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {!editing && (canEdit || canDelete) && (
        <div className="row">
          {canEdit && (
            <button type="button" className="btn btn-quiet" onClick={() => setEditing(true)}>
              Edit
            </button>
          )}
          {canDelete && (
            <ActionButton method="DELETE" url={`/api/comments/${id}`} label="Delete" className="btn btn-quiet" confirm="Delete this comment?" />
          )}
        </div>
      )}
    </div>
  );
}
