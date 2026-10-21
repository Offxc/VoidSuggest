"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { LIMITS } from "@/shared/constants";
import { api } from "./api-client";

export function CommentForm({ publicId }: { publicId: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const result = await api("POST", `/api/suggestions/${publicId}/comments`, { body });
    setBusy(false);
    if (!result.ok) return setError(result.fieldErrors?.body?.[0] ?? result.message);
    setBody("");
    startTransition(() => router.refresh());
  }

  return (
    <form onSubmit={submit} className="stack">
      <div className="field">
        <label htmlFor="comment-body">Add a comment</label>
        <textarea
          id="comment-body"
          className="textarea"
          rows={3}
          maxLength={LIMITS.commentMax}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Be kind and keep it on topic."
          required
        />
        <div className="counter">
          {body.length}/{LIMITS.commentMax}
        </div>
      </div>
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      <button type="submit" className="btn btn-sm" disabled={busy || body.trim().length === 0}>
        Post comment
      </button>
    </form>
  );
}
