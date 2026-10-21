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
import { getSettings } from "@/server/settings";

// Everything here depends on who is looking and on the database, so nothing is
// prerendered. This also lets the Docker image build without a database.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSettings();
  return {
    title: { default: settings.siteName, template: `%s · ${settings.siteName}` },
    description: "Suggest features and updates, and vote for the ideas you want most.",
    robots: { index: true, follow: true },
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
