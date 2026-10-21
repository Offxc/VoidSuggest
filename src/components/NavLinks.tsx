"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Board", match: (p: string) => p === "/" || p.startsWith("/s/") || p === "/new" },
  { href: "/roadmap", label: "Roadmap", match: (p: string) => p === "/roadmap" },
  { href: "/guidelines", label: "Guidelines", match: (p: string) => p === "/guidelines" },
];

export function NavLinks({ isOwner }: { isOwner: boolean }) {
  const pathname = usePathname();
  const links = isOwner ? [...LINKS, { href: "/admin", label: "Admin", match: (p: string) => p.startsWith("/admin") }] : LINKS;
  return (
    <nav className="nav" aria-label="Main">
      {links.map((l) => (
        <Link key={l.href} href={l.href} className="nav-link" aria-current={l.match(pathname) ? "page" : undefined}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
