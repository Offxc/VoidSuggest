import { DEFAULT_SITE_NAME } from "@/shared/constants";

/**
 * The site's name as shown in the header. A fresh install shows the logo
 * (public/logo.png); once the owner renames the site it shows that name as
 * text instead, so a renamed site never carries the wrong branding.
 */
export function BrandMark({ siteName, className }: { siteName: string; className?: string }) {
  if (siteName !== DEFAULT_SITE_NAME) return <>{siteName}</>;
  return <img className={className ?? "brand-logo"} src="/logo.png" alt={siteName} width={600} height={358} />;
}
