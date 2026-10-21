import type { SiteDto, ViewerDto } from "@/shared/types";

/** Explains, in plain words, why a signed-in person can look but not take part. */
export function ParticipationNotice({ viewer, site }: { viewer: ViewerDto | null; site: SiteDto }) {
  if (!viewer?.participationMessage) return null;
  return (
    <div className="notice-bar warn" role="status">
      {viewer.participationMessage}{" "}
      {site.discordInviteUrl && (
        <a href={site.discordInviteUrl} rel="noopener noreferrer">
          Join the Discord server
        </a>
      )}
    </div>
  );
}
