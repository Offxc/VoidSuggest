import type { Metadata } from "next";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { Person } from "@/components/Person";
import { TypePill } from "@/components/Pills";
import { getUser } from "@/server/current";
import { getRoadmap } from "@/server/queries";

export const metadata: Metadata = { title: "Roadmap" };

export default async function RoadmapPage() {
  const user = await getUser();
  const columns = await getRoadmap(user);

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div>
          <h1 className="page-title">Roadmap</h1>
          <p>What's planned, what's being worked on, and what's done. Within each column, the most voted ideas come first.</p>
        </div>
      </div>

      {columns.length === 0 ? (
        <div className="panel empty">
          <span className="pixel">No roadmap yet</span>
          Nothing has been planned.
        </div>
      ) : (
        <div className="roadmap">
          {columns.map(({ status, items, total }) => (
            <section key={status.id} className={`roadmap-col tone-${status.color}`} aria-labelledby={`col-${status.slug}`}>
              <div className="roadmap-head">
                <h2 id={`col-${status.slug}`}>{status.name}</h2>
                <span className="pill tone-gray">{total}</span>
              </div>
              <div className="roadmap-body">
                {items.length === 0 && <p className="dim small">Nothing here yet.</p>}
                {items.map((item) => (
                  <Link key={item.publicId} href={`/s/${item.publicId}`} className="r-item">
                    <strong>{item.title}</strong>
                    <div className="s-meta">
                      {item.type && <TypePill type={item.type} />}
                      <span title="Votes">
                        <Icon name="up" /> {item.voteCount}
                      </span>
                      <Person person={item.author} small />
                    </div>
                  </Link>
                ))}
                {total > items.length && <p className="dim small">and {total - items.length} more</p>}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
