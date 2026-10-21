import Link from "next/link";
import type { SiteDto, ViewerDto } from "@/shared/types";
import { DiscordMark } from "./icons";
import { NavLinks } from "./NavLinks";

export function Header({ site, viewer }: { site: SiteDto; viewer: ViewerDto | null }) {
  return (
    <header className="site-header">
      <div className="header-inner">
        <Link href="/" className="brand">
          {site.siteName}
        </Link>
        <NavLinks isOwner={viewer?.isOwner ?? false} />
        <div className="header-actions">
          {viewer ? (
            <Link href="/me" className="user-chip" title="Your activity">
              <img className="avatar avatar-sm" src={viewer.avatarUrl} alt="" width={22} height={22} referrerPolicy="no-referrer" />
              <span className="chip-name">{viewer.name}</span>
              {viewer.unreadNotices > 0 && (
                <span className="badge-dot" aria-label={`${viewer.unreadNotices} unread notices`}>
                  {viewer.unreadNotices > 9 ? "9+" : viewer.unreadNotices}
                </span>
              )}
            </Link>
          ) : (
            <a className="btn btn-discord btn-sm" href="/api/auth/login">
              <DiscordMark />
              Sign in
            </a>
          )}
        </div>
      </div>
    </header>
  );
}
