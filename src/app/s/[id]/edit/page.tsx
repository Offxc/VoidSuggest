import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { toGuidelineItems } from "@/components/GuidelineNodes";
import { SuggestionForm } from "@/components/SuggestionForm";
import { requireUser } from "@/server/current";
import { getGuidelines, getSuggestion, getTags, getTypes } from "@/server/queries";
import { getSettings } from "@/server/settings";

export const metadata: Metadata = { title: "Edit suggestion" };

export default async function EditSuggestionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser(`/s/${id}/edit`);
  const detail = await getSuggestion(user, id);
  if (!detail) notFound();

  // The author may edit only while it awaits approval; the owner may edit at any time.
  const allowed = user.isOwner || (detail.viewerIsAuthor && detail.approval === "PENDING");
  if (!allowed) notFound();

  const settings = await getSettings();
  const enabled = await getTypes({ enabledOnly: true });
  const types = detail.type && !enabled.some((t) => t.id === detail.type!.id) ? [...enabled, detail.type] : enabled;

  return (
    <div className="stack-lg">
      <div className="page-head">
        <h1 className="page-title">Edit suggestion</h1>
      </div>
      <SuggestionForm
        mode="edit"
        types={types}
        tags={await getTags()}
        maxTags={settings.maxTagsPerSuggestion}
        guidelines={toGuidelineItems(await getGuidelines())}
        needsAck={false}
        initial={{
          publicId: detail.publicId,
          title: detail.title,
          body: detail.body,
          typeId: detail.type?.id ?? null,
          tagIds: detail.tags.map((t) => t.id),
        }}
      />
    </div>
  );
}
