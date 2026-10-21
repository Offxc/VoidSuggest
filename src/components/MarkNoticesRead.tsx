"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { api } from "./api-client";

/** Marks notices as read once they have been shown, then refreshes so the header badge clears. */
export function MarkNoticesRead({ unread }: { unread: number }) {
  const router = useRouter();
  useEffect(() => {
    if (unread === 0) return;
    let cancelled = false;
    api("POST", "/api/notices/read").then((result) => {
      if (result.ok && !cancelled) router.refresh();
    });
    return () => {
      cancelled = true;
    };
  }, [unread, router]);
  return null;
}
