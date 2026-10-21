"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { api } from "./api-client";

export function BlockButton({ userId, name }: { userId: string; name: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  return (
    <span>
      <button
        type="button"
        className="btn btn-quiet"
        onClick={async () => {
          const reason = window.prompt(`Block ${name}? They'll be signed out and their open votes withdrawn.\n\nReason (optional, only you see it):`);
          if (reason === null) return;
          const result = await api("POST", `/api/admin/users/${userId}/block`, { reason });
          if (!result.ok) return setError(result.message);
          startTransition(() => router.refresh());
        }}
      >
        Block
      </button>
      {error && (
        <span role="alert" className="error-text small">
          {" "}
          {error}
        </span>
      )}
    </span>
  );
}
