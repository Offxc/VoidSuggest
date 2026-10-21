import type { Metadata } from "next";
import { EntityEditor, type FieldDef } from "@/components/EntityEditor";
import { LIMITS } from "@/shared/constants";
import { requireOwner } from "@/server/current";
import { getTypes, getUsage } from "@/server/queries";

export const metadata: Metadata = { title: "Types" };

const FIELDS: FieldDef[] = [
  { kind: "text", key: "name", label: "Name", max: LIMITS.typeNameMax },
  { kind: "icon", key: "icon", label: "Icon" },
  { kind: "color", key: "color", label: "Colour" },
  { kind: "textarea", key: "description", label: "Short description (shown on the form)", max: LIMITS.typeDescriptionMax, rows: 2 },
  { kind: "switch", key: "enabled", label: "Available on the form", hint: "Turn off to retire it. Existing suggestions keep their type." },
];

export default async function TypesPage() {
  await requireOwner("/admin/settings/types");
  const [types, usage] = await Promise.all([getTypes(), getUsage()]);
  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Types</h1>
          <p>
            What kind of suggestion this is, for example a feature or an update. If none are turned on, the form skips the question.
          </p>
        </div>
      </div>
      <div className="panel settings-section">
        <EntityEditor
          noun="type"
          base="/api/admin/types"
          titleKey="name"
          max={LIMITS.maxTypes}
          fields={FIELDS}
          blank={{ name: "", description: "", color: "purple", icon: "sparkle", enabled: true }}
          items={types.map((t) => {
            const n = usage.types[t.id] ?? 0;
            return {
              ...t,
              description: t.description ?? "",
              note: `${n} suggestion${n === 1 ? "" : "s"}`,
              deleteBlock: n > 0 ? "In use. Turn it off instead." : undefined,
            };
          })}
        />
      </div>
    </>
  );
}
