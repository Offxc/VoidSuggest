import type { Metadata } from "next";
import { EntityEditor, type FieldDef } from "@/components/EntityEditor";
import { LIMITS } from "@/shared/constants";
import { requireOwner } from "@/server/current";
import { getStatuses, getUsage } from "@/server/queries";

export const metadata: Metadata = { title: "Statuses" };

const FIELDS: FieldDef[] = [
  { kind: "text", key: "name", label: "Name", max: LIMITS.statusNameMax },
  { kind: "color", key: "color", label: "Colour" },
  { kind: "switch", key: "votingOpen", label: "Voting is open", hint: "Votes use up a slot while a suggestion is here. Turn off for “Planned”, “Completed” and similar, so votes are returned." },
  { kind: "switch", key: "closesCommentsOnEntry", label: "Close comments when something moves here", hint: "For example on “Completed”." },
  { kind: "switch", key: "showOnRoadmap", label: "Show as a column on the roadmap" },
  { kind: "switch", key: "isDefault", label: "Default for new approvals", hint: "Where suggestions land when you approve them.", lockedWhenOn: "isDefault" },
];

export default async function StatusesPage() {
  await requireOwner("/admin/settings/statuses");
  const [statuses, usage] = await Promise.all([getStatuses(), getUsage()]);
  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Statuses</h1>
          <p>The lists a suggestion can move between. Add your own, rename them, and decide what each one does.</p>
        </div>
      </div>
      <div className="panel settings-section">
        <EntityEditor
          noun="status"
          base="/api/admin/statuses"
          titleKey="name"
          max={LIMITS.maxStatuses}
          fields={FIELDS}
          blank={{ name: "", color: "purple", votingOpen: false, closesCommentsOnEntry: false, showOnRoadmap: false, isDefault: false }}
          items={statuses.map((s) => {
            const n = usage.statuses[s.id] ?? 0;
            return {
              ...s,
              note: `${n} suggestion${n === 1 ? "" : "s"}${s.isDefault ? " · default" : ""}`,
              deleteBlock: s.isDefault
                ? "The default can't be deleted. Make another one the default first."
                : n > 0
                  ? "Move its suggestions elsewhere first."
                  : undefined,
            };
          })}
        />
      </div>
    </>
  );
}
