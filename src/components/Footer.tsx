import Link from "next/link";
import { APP_VERSION } from "@/shared/version";

export function Footer({ siteName }: { siteName: string }) {
  return (
    <footer className="site-footer">
      <div className="container footer-inner">
        <span>{siteName}</span>
        <span className="row footer-links">
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <a href="https://github.com/Offxc/VoidSuggest" rel="noopener noreferrer">VoidSuggest {APP_VERSION}</a>
        </span>
      </div>
    </footer>
  );
}
