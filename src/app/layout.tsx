import type { Metadata, Viewport } from "next";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter/latin-800.css";
import "@fontsource/inter/latin-ext-400.css";
import "@fontsource/inter/latin-ext-600.css";
import "@fontsource/jersey-10/latin-400.css";
import "./globals.css";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { toSite } from "@/server/dto";
import { getViewer } from "@/server/current";
import { getEnv } from "@/server/env";
import { getSettings } from "@/server/settings";

// Everything here depends on who is looking and on the database, so nothing is
// prerendered. This also lets the Docker image build without a database.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSettings();
  const description = "Suggest features and updates, and vote for the ideas you want most.";
  return {
    // Makes the share image below an absolute address, which link previews (Discord, for one) need.
    metadataBase: new URL(getEnv().siteOrigin),
    title: { default: settings.siteName, template: `%s · ${settings.siteName}` },
    description,
    robots: { index: true, follow: true },
    openGraph: {
      type: "website",
      siteName: settings.siteName,
      title: settings.siteName,
      description,
      images: [{ url: "/og.png", width: 1200, height: 630, alt: settings.siteName }],
    },
    twitter: { card: "summary_large_image" },
  };
}

export const viewport: Viewport = {
  themeColor: "#05040b",
  colorScheme: "dark",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [settings, viewer] = await Promise.all([getSettings(), getViewer()]);
  const site = toSite(settings);
  return (
    <html lang="en" data-accent={site.accentColor}>
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <Header site={site} viewer={viewer} />
        <main id="main" className="page">
          <div className="container">{children}</div>
        </main>
        <Footer siteName={site.siteName} />
      </body>
    </html>
  );
}
