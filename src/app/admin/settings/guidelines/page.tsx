import type { Metadata } from "next";
import { EntityEditor, type FieldDef } from "@/components/EntityEditor";
import { LIMITS } from "@/shared/constants";
import { requireOwner } from "@/server/current";
import { getGuidelines, getTypes } from "@/server/queries";

export const metadata: Metadata = { title: "Guidelines" };

export default async function GuidelinesSettingsPage() {
  await requireOwner("/admin/settings/guidelines");
  const [guidelines, types] = await Promise.all([getGuidelines(), getTypes()]);
  const fields: FieldDef[] = [
    { kind: "text", key: "title", label: "Title", max: LIMITS.guidelineTitleMax },
    { kind: "textarea", key: "body", label: "Text (basic formatting works)", max: LIMITS.guidelineBodyMax, rows: 3 },
    { kind: "switch", key: "appliesToAll", label: "Applies to every type of suggestion" },
    { kind: "types", key: "typeIds", label: "Only for these types", options: types, onlyWhenFalse: "appliesToAll" },
  ];
  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Guidelines</h1>
          <p>
            Shown beside the suggestion form and on the Guidelines page. Changing the wording asks people to confirm them again, if you have that switched on in
            General settings.
          </p>
        </div>
      </div>
      <div className="panel settings-section">
        <EntityEditor
          noun="guideline"
          base="/api/admin/guidelines"
          titleKey="title"
          max={LIMITS.maxGuidelines}
          fields={fields}
          blank={{ title: "", body: "", appliesToAll: true, typeIds: [] }}
          items={guidelines.map((g) => ({ ...g }))}
        />
      </div>
    </>
  );
}
