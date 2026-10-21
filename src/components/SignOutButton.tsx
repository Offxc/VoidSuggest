"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "./api-client";

export function SignOutButton({ className = "btn btn-ghost btn-sm" }: { className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={className}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await api("POST", "/api/auth/logout");
        router.push("/");
        // Re-render every server component, so the header and pages show the signed-out view.
        router.refresh();
      }}
    >
      Sign out
    </button>
  );
}
