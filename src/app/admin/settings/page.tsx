import type { Metadata } from "next";
import { SettingsForm } from "@/components/SettingsForm";
import { requireOwner } from "@/server/current";
import { toColor } from "@/server/dto";
import { getSettings } from "@/server/settings";

export const metadata: Metadata = { title: "Settings" };

export default async function GeneralSettingsPage() {
  await requireOwner("/admin/settings");
  const s = await getSettings();
  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Settings</h1>
          <p>How the site looks, who can take part, and the limits that keep voting meaningful.</p>
        </div>
      </div>
      <SettingsForm
        initial={{
          siteName: s.siteName,
          introText: s.introText ?? "",
          accentColor: toColor(s.accentColor),
          discordInviteUrl: s.discordInviteUrl ?? "",
          memberRoleId: s.memberRoleId,
          voteSlots: s.voteSlots,
          minDaysInServer: s.minDaysInServer,
          submissionsOpen: s.submissionsOpen,
          maxPendingPerUser: s.maxPendingPerUser,
          maxSubmissionsPerDay: s.maxSubmissionsPerDay,
          maxTagsPerSuggestion: s.maxTagsPerSuggestion,
          requireGuidelinesAck: s.requireGuidelinesAck,
          defaultCommentsMode: s.defaultCommentsMode === "OPEN" ? "OPEN" : "OFF",
          removeVotesOnLeave: s.removeVotesOnLeave,
        }}
      />
    </>
  );
}
