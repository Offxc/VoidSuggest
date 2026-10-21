"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { api } from "./api-client";

interface Props {
  method: "POST" | "PUT" | "PATCH" | "DELETE";
  url: string;
  body?: unknown;
  label: string;
  className?: string;
  /** Asks first. Use for anything destructive. */
  confirm?: string;
  /** Where to go afterwards instead of just refreshing the page. */
  redirectTo?: string;
  disabled?: boolean;
  title?: string;
}

/** A button that calls the API, then refreshes the page. Shows the server's reason if it is refused. */
export function ActionButton({ method, url, body, label, className = "btn btn-ghost btn-sm", confirm, redirectTo, disabled, title }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  return (
    <span>
      <button
        type="button"
        className={`${className} ${busy ? "is-busy" : ""}`}
        disabled={disabled || busy}
        title={title}
        onClick={async () => {
          if (confirm && !window.confirm(confirm)) return;
          setBusy(true);
          setError(null);
          const result = await api(method, url, body);
          setBusy(false);
          if (!result.ok) return setError(result.message);
          startTransition(() => {
            if (redirectTo) router.push(redirectTo);
            router.refresh();
          });
        }}
      >
        {label}
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
