import type { Metadata } from "next";
import { Markdown } from "@/components/Markdown";
import { getGuidelines, getTypes } from "@/server/queries";

export const metadata: Metadata = { title: "Guidelines" };

export default async function GuidelinesPage() {
  const [guidelines, types] = await Promise.all([getGuidelines(), getTypes()]);
  const typeName = new Map(types.map((t) => [t.id, t.name]));

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div>
          <h1 className="page-title">Guidelines</h1>
          <p>A few things that help suggestions get noticed, and approved, quickly.</p>
        </div>
      </div>
      {guidelines.length === 0 ? (
        <div className="panel empty">
          <span className="pixel">No guidelines yet</span>
          Just be kind and be clear.
        </div>
      ) : (
        <ol className="guidelines">
          {guidelines.map((g) => (
            <li key={g.id}>
              <div className="grow">
                <h3>{g.title}</h3>
                {!g.appliesToAll && (
                  <p className="small dim">For: {g.typeIds.map((id) => typeName.get(id)).filter(Boolean).join(", ")}</p>
                )}
                <Markdown>{g.body}</Markdown>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
