import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DiscordMark } from "@/components/icons";
import { getUser } from "@/server/current";
import { toSite } from "@/server/dto";
import { safeReturnTo } from "@/server/session";
import { getSettings } from "@/server/settings";
import { DEFAULT_SITE_NAME } from "@/shared/constants";

export const metadata: Metadata = { title: "Sign in" };

const MESSAGES: Record<string, { text: string; tone: "bad" | "warn" }> = {
  not_member: { text: "You need the Member role in our Discord server to sign in.", tone: "warn" },
  denied: { text: "Access denied.", tone: "bad" },
  cancelled: { text: "Sign-in was cancelled.", tone: "warn" },
  state: { text: "That sign-in link expired or didn't match. Please try again.", tone: "warn" },
  discord: { text: "Discord isn't responding right now. Please try again in a moment.", tone: "warn" },
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { error, returnTo } = await searchParams;
  if (await getUser()) redirect(safeReturnTo(returnTo));

  const settings = await getSettings();
  const site = toSite(settings);
  const message = error ? MESSAGES[error] : undefined;
  const href = `/api/auth/login${returnTo ? `?returnTo=${encodeURIComponent(safeReturnTo(returnTo))}` : ""}`;

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        {site.siteName === DEFAULT_SITE_NAME && <img className="auth-logo" src="/logo.png" alt="" width={600} height={358} />}
        <h1>Sign in</h1>
        <p>
          Anyone can browse the board. Sign in with Discord to suggest ideas, vote and comment. You'll need the Member role in the server.
        </p>
        {message && (
          <div className={`notice-bar ${message.tone}`} role="alert">
            {message.text}
            {error === "not_member" && site.discordInviteUrl && (
              <>
                {" "}
                <a href={site.discordInviteUrl} rel="noopener noreferrer">
                  Join the server
                </a>
              </>
            )}
          </div>
        )}
        <p className="small dim">We only read your Discord ID, name and avatar. We never see your messages or email.</p>
        <a className="btn btn-discord btn-block" href={href}>
          <DiscordMark />
          Continue with Discord
        </a>
      </div>
    </div>
  );
}
