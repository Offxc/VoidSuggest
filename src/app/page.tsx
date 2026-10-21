import Link from "next/link";
import { BudgetChip } from "@/components/BudgetChip";
import { Markdown } from "@/components/Markdown";
import { NewSuggestionButton } from "@/components/NewSuggestionButton";
import { ParticipationNotice } from "@/components/ParticipationNotice";
import { SuggestionCard } from "@/components/SuggestionCard";
import { boardQuerySchema } from "@/shared/schemas";
import { getUser, getViewer, loginUrl } from "@/server/current";
import { toSite } from "@/server/dto";
import { getBoard } from "@/server/queries";
import { getSettings } from "@/server/settings";

type SearchParams = Record<string, string | string[] | undefined>;

function firstValues(sp: SearchParams): Record<string, string> {
  return Object.fromEntries(Object.entries(sp).flatMap(([k, v]) => (v === undefined ? [] : [[k, Array.isArray(v) ? (v[0] ?? "") : v]])));
}

export default async function BoardPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const raw = firstValues(await searchParams);
  const query = boardQuerySchema.safeParse(raw).data ?? boardQuerySchema.parse({});

  const [user, viewer, settings] = await Promise.all([getUser(), getViewer(), getSettings()]);
  const site = toSite(settings);
  const board = await getBoard(user, query);

  const tabs = board.statuses.filter((s) => s.isDefault || s.count > 0 || s.id === board.current?.id);
  const here = new URLSearchParams(raw);
  const pageHref = (page: number) => {
    const next = new URLSearchParams(here);
    next.set("page", String(page));
    return `/?${next.toString()}`;
  };
  const filtered = Boolean(query.q || query.tag || query.type);
  const loginHref = loginUrl("/");

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div>
          <h1 className="page-title">Suggestions</h1>
          {site.introText ? (
            <Markdown className="prose muted">{site.introText}</Markdown>
          ) : (
            <p>Tell us what you'd like to see, and vote for the ideas that matter most to you.</p>
          )}
          {site.voteSlots !== null && (
            <p className="small dim">
              Everyone gets {site.voteSlots} vote{site.voteSlots === 1 ? "" : "s"} at a time, so spend them on what you want most. You
              get a vote back when something you voted for moves on.
            </p>
          )}
        </div>
        <div className="row">
          {viewer?.budget && <BudgetChip budget={viewer.budget} />}
          <NewSuggestionButton viewer={viewer} site={site} />
        </div>
      </div>

      <ParticipationNotice viewer={viewer} site={site} />

      <div>
        <nav className="status-tabs" aria-label="Status">
          {tabs.map((s) => (
            <Link key={s.id} href={s.isDefault ? "/" : `/?status=${s.slug}`} className="status-tab" aria-current={s.id === board.current?.id ? "page" : undefined}>
              {s.name} <span className="count">{s.count}</span>
            </Link>
          ))}
        </nav>

        <form className="toolbar" method="get" action="/" role="search">
          {board.current && !board.current.isDefault && <input type="hidden" name="status" value={board.current.slug} />}
          <label className="sr-only" htmlFor="q">
            Search suggestions
          </label>
          <input id="q" name="q" className="input search" type="search" placeholder="Search suggestions" defaultValue={query.q ?? ""} maxLength={80} />
          {board.types.length > 0 && (
            <>
              <label className="sr-only" htmlFor="type">
                Type
              </label>
              <select id="type" name="type" className="select" defaultValue={query.type ?? ""}>
                <option value="">All types</option>
                {board.types.map((t) => (
                  <option key={t.id} value={t.slug}>
                    {t.name}
                  </option>
                ))}
              </select>
            </>
          )}
          {board.tags.length > 0 && (
            <>
              <label className="sr-only" htmlFor="tag">
                Tag
              </label>
              <select id="tag" name="tag" className="select" defaultValue={query.tag ?? ""}>
                <option value="">All tags</option>
                {board.tags.map((t) => (
                  <option key={t.id} value={t.slug}>
                    {t.name}
                  </option>
                ))}
              </select>
            </>
          )}
          <label className="sr-only" htmlFor="sort">
            Sort by
          </label>
          <select id="sort" name="sort" className="select" defaultValue={query.sort}>
            <option value="top">Most voted</option>
            <option value="new">Newest</option>
          </select>
          <button type="submit" className="btn btn-ghost btn-sm">
            Apply
          </button>
          {filtered && (
            <Link href={board.current && !board.current.isDefault ? `/?status=${board.current.slug}` : "/"} className="btn btn-quiet">
              Clear
            </Link>
          )}
        </form>

        {board.items.length === 0 ? (
          <div className="panel empty">
            <span className="pixel">{filtered ? "No matches" : "Nothing here yet"}</span>
            {filtered ? "Try a different search, or clear the filters." : board.current?.isDefault ? "Be the first to suggest something." : "Nothing has been moved here yet."}
          </div>
        ) : (
          <div className="s-list">
            {board.items.map((item) => (
              <SuggestionCard key={item.publicId} item={item} viewer={viewer} loginHref={loginHref} hideStatus />
            ))}
          </div>
        )}

        {board.pageCount > 1 && (
          <nav className="pager" aria-label="Pages">
            {board.page > 1 ? (
              <Link className="btn btn-ghost btn-sm" href={pageHref(board.page - 1)}>
                Previous
              </Link>
            ) : (
              <span />
            )}
            <span>
              Page {board.page} of {board.pageCount}
            </span>
            {board.page < board.pageCount ? (
              <Link className="btn btn-ghost btn-sm" href={pageHref(board.page + 1)}>
                Next
              </Link>
            ) : (
              <span />
            )}
          </nav>
        )}
      </div>
    </div>
  );
}
