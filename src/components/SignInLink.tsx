"use client";

import { usePathname } from "next/navigation";
import { DiscordMark } from "./icons";

/** Sends people back to the page they were on once they've signed in. */
export function SignInLink() {
  const pathname = usePathname();
  const href = pathname && pathname !== "/" && pathname !== "/login" ? `/api/auth/login?returnTo=${encodeURIComponent(pathname)}` : "/api/auth/login";
  return (
    <a className="btn btn-discord btn-sm" href={href}>
      <DiscordMark />
      Sign in
    </a>
  );
}
