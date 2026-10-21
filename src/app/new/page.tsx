import type { Metadata } from "next";
import Link from "next/link";
import { toGuidelineItems } from "@/components/GuidelineNodes";
import { ParticipationNotice } from "@/components/ParticipationNotice";
import { SuggestionForm } from "@/components/SuggestionForm";
import { getViewer, requireUser } from "@/server/current";
import { toSite } from "@/server/dto";
import { getGuidelines, getTags, getTypes } from "@/server/queries";
import { getSettings } from "@/server/settings";

export const metadata: Metadata = { title: "Suggest something" };

export default async function NewSuggestionPage() {
  const user = await requireUser("/new");
  const [viewer, settings] = await Promise.all([getViewer(), getSettings()]);
  const site = toSite(settings);

  const blocked = !user.isOwner && !settings.submissionsOpen;
  const canPost = viewer !== null && viewer.participationMessage === null && !blocked;

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div>
          <h1 className="page-title">Suggest something</h1>
          <p>Give it a clear title and explain why it would help. The owner reviews every suggestion before it appears on the board.</p>
        </div>
      </div>

      <ParticipationNotice viewer={viewer} site={site} />
      {blocked && (
        <div className="notice-bar warn" role="status">
          New suggestions are paused right now. Check back soon, and in the meantime <Link href="/">vote on what's already there</Link>.
        </div>
      )}

      {canPost && (
        <SuggestionForm
          mode="create"
          types={await getTypes({ enabledOnly: true })}
          tags={await getTags()}
          maxTags={settings.maxTagsPerSuggestion}
          guidelines={toGuidelineItems(await getGuidelines())}
          needsAck={settings.requireGuidelinesAck && !user.isOwner && user.ackedGuidelinesVersion < settings.guidelinesVersion}
        />
      )}
    </div>
  );
}
