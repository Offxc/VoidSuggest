import type { Metadata } from "next";
import { EntityEditor, type FieldDef } from "@/components/EntityEditor";
import { LIMITS } from "@/shared/constants";
import { requireOwner } from "@/server/current";
import { getTags, getUsage } from "@/server/queries";

export const metadata: Metadata = { title: "Tags" };

const FIELDS: FieldDef[] = [
  { kind: "text", key: "name", label: "Name", max: LIMITS.tagNameMax },
  { kind: "color", key: "color", label: "Colour" },
];

export default async function TagsPage() {
  await requireOwner("/admin/settings/tags");
  const [tags, usage] = await Promise.all([getTags(), getUsage()]);
  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Tags</h1>
          <p>Topics people can attach to a suggestion, such as “Economy” or “Events”. Players choose from your list; they can't invent their own.</p>
        </div>
      </div>
      <div className="panel settings-section">
        <EntityEditor
          noun="tag"
          base="/api/admin/tags"
          titleKey="name"
          max={LIMITS.maxTags}
          fields={FIELDS}
          blank={{ name: "", color: "purple" }}
          items={tags.map((t) => {
            const n = usage.tags[t.id] ?? 0;
            return { ...t, note: `${n} suggestion${n === 1 ? "" : "s"}` };
          })}
        />
      </div>
    </>
  );
}
