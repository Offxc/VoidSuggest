"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const MAIN = [
  { href: "/admin", label: "Queue", exact: true },
  { href: "/admin/suggestions", label: "All suggestions" },
  { href: "/admin/users", label: "People" },
  { href: "/admin/audit", label: "Audit log" },
];
const SETTINGS = [
  { href: "/admin/settings", label: "General", exact: true },
  { href: "/admin/settings/statuses", label: "Statuses" },
  { href: "/admin/settings/types", label: "Types" },
  { href: "/admin/settings/tags", label: "Tags" },
  { href: "/admin/settings/guidelines", label: "Guidelines" },
  { href: "/admin/settings/notifications", label: "Notifications" },
];

export function AdminNav({ pending }: { pending: number }) {
  const pathname = usePathname();
  const current = (l: { href: string; exact?: boolean }) => (l.exact ? pathname === l.href : pathname.startsWith(l.href));
  return (
    <nav className="admin-nav" aria-label="Admin">
      {MAIN.map((l) => (
        <Link key={l.href} href={l.href} aria-current={current(l) ? "page" : undefined}>
          {l.label}
          {l.href === "/admin" && pending > 0 && <span className="badge-dot">{pending}</span>}
        </Link>
      ))}
      <div className="group">Settings</div>
      {SETTINGS.map((l) => (
        <Link key={l.href} href={l.href} aria-current={current(l) ? "page" : undefined}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
