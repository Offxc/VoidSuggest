"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { LIMITS } from "@/shared/constants";
import type { TagDto, TypeDto } from "@/shared/types";
import { api } from "./api-client";
import { Icon } from "./icons";

export interface GuidelineItem {
  id: string;
  appliesToAll: boolean;
  typeIds: string[];
  /** Rendered on the server so the browser never needs the markdown renderer. */
  node: React.ReactNode;
}

interface Props {
  mode: "create" | "edit";
  types: TypeDto[];
  tags: TagDto[];
  maxTags: number;
  guidelines: GuidelineItem[];
  needsAck: boolean;
  initial?: { publicId: string; title: string; body: string; typeId: string | null; tagIds: string[] };
}

interface Hit {
  publicId: string;
  title: string;
  voteCount: number;
  statusName: string;
}

export function SuggestionForm({ mode, types, tags, maxTags, guidelines, needsAck, initial }: Props) {
  const router = useRouter();
  const [typeId, setTypeId] = useState<string | null>(initial?.typeId ?? (types.length === 1 ? (types[0]?.id ?? null) : null));
  const [title, setTitle] = useState(initial?.title ?? "");
  const [body, setBody] = useState(initial?.body ?? "");
  const [tagIds, setTagIds] = useState<string[]>(initial?.tagIds ?? []);
  const [ack, setAck] = useState(false);
  const [hits, setHits] = useState<Hit[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string[]>>({});
  const lookup = useRef(0);

  // Look for existing suggestions that resemble the title, to cut down on duplicates.
  useEffect(() => {
    if (mode !== "create" || title.trim().length < LIMITS.titleMin) return;
    const ticket = ++lookup.current;
    const timer = setTimeout(async () => {
      const result = await api<{ items: Hit[] }>("GET", `/api/suggestions/similar?q=${encodeURIComponent(title.trim())}`);
      if (ticket === lookup.current && result.ok && result.data) setHits(result.data.items);
    }, 450);
    return () => clearTimeout(timer);
  }, [title, mode]);

  const visibleGuidelines = useMemo(
    () => guidelines.filter((g) => g.appliesToAll || (typeId !== null && g.typeIds.includes(typeId))),
    [guidelines, typeId],
  );

  function toggleTag(id: string) {
    setTagIds((current) => (current.includes(id) ? current.filter((t) => t !== id) : current.length < maxTags ? [...current, id] : current));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFields({});
    const result =
      mode === "create"
        ? await api<{ publicId: string }>("POST", "/api/suggestions", {
            title,
            body,
            typeId,
            tagIds,
            ...(needsAck ? { acknowledgeGuidelines: ack } : {}),
          })
        : await api("PATCH", `/api/suggestions/${initial!.publicId}`, { title, body, typeId, tagIds });
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      setFields(result.fieldErrors ?? {});
      return;
    }
    const target = mode === "create" ? (result.data as { publicId: string }).publicId : initial!.publicId;
    router.push(`/s/${target}`);
    router.refresh();
  }

  const titleLen = title.trim().length;
  const bodyLen = body.trim().length;
  const shownHits = mode === "create" && titleLen >= LIMITS.titleMin ? hits : [];
  const ready =
    titleLen >= LIMITS.titleMin &&
    titleLen <= LIMITS.titleMax &&
    bodyLen >= LIMITS.bodyMin &&
    bodyLen <= LIMITS.bodyMax &&
    (types.length === 0 || typeId !== null) &&
    (!needsAck || ack);

  return (
    <form onSubmit={submit} className="form-grid" noValidate>
      <div className="panel panel-pad">
        {types.length > 0 && (
          <fieldset className="field">
            <legend className="field-label">What kind of suggestion is it?</legend>
            <div className="choice-grid">
              {types.map((t) => (
                <label key={t.id} className="choice">
                  <input type="radio" name="type" value={t.id} checked={typeId === t.id} onChange={() => setTypeId(t.id)} />
                  <span>
                    <strong>
                      <Icon name={t.icon} /> {t.name}
                    </strong>
                    {t.description && <small>{t.description}</small>}
                  </span>
                </label>
              ))}
            </div>
            {fields.typeId && <p className="error-text">{fields.typeId[0]}</p>}
          </fieldset>
        )}

        <div className="field">
          <label htmlFor="title">Title</label>
          <input
            id="title"
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={LIMITS.titleMax}
            placeholder="A short, clear summary"
            autoComplete="off"
            required
          />
          <div className={`counter ${titleLen > LIMITS.titleMax ? "over" : ""}`}>
            {titleLen}/{LIMITS.titleMax}
          </div>
          {fields.title && <p className="error-text">{fields.title[0]}</p>}
        </div>

        {shownHits.length > 0 && (
          <div className="similar field" role="region" aria-label="Similar suggestions">
            <div className="similar-head">Is it one of these? Vote for it instead of posting a duplicate.</div>
            {shownHits.map((h) => (
              <a key={h.publicId} href={`/s/${h.publicId}`} target="_blank" rel="noopener noreferrer">
                <span>{h.title}</span>
                <span className="dim small">
                  {h.statusName} · {h.voteCount} vote{h.voteCount === 1 ? "" : "s"}
                </span>
              </a>
            ))}
          </div>
        )}

        <div className="field">
          <label htmlFor="body">Details</label>
          <textarea
            id="body"
            className="textarea"
            rows={9}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={LIMITS.bodyMax}
            placeholder="What would you like to happen, and why would it help?"
            required
          />
          <div className={`counter ${bodyLen > LIMITS.bodyMax ? "over" : ""}`}>
            {bodyLen}/{LIMITS.bodyMax}
          </div>
          <p className="hint">You can use **bold**, *italic*, lists and `code`. Links are fine; images and raw HTML aren't shown.</p>
          {fields.body && <p className="error-text">{fields.body[0]}</p>}
        </div>

        {tags.length > 0 && maxTags > 0 && (
          <fieldset className="field">
            <legend className="field-label">
              Tags <span className="dim">(up to {maxTags})</span>
            </legend>
            <div className="tag-picker">
              {tags.map((t) => {
                const checked = tagIds.includes(t.id);
                return (
                  <label key={t.id} className={`tag-option tone-${t.color}`}>
                    <input type="checkbox" checked={checked} disabled={!checked && tagIds.length >= maxTags} onChange={() => toggleTag(t.id)} />
                    <span className="pill">{t.name}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        )}

        {needsAck && (
          <label className="check field">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
            <span>I've read the guidelines and my suggestion follows them.</span>
          </label>
        )}

        {error && (
          <p role="alert" className="notice-bar bad">
            {error}
          </p>
        )}

        <div className="row">
          <button type="submit" className={`btn ${busy ? "is-busy" : ""}`} disabled={busy || !ready}>
            {mode === "create" ? "Submit for approval" : "Save changes"}
          </button>
          <Link href={mode === "edit" ? `/s/${initial!.publicId}` : "/"} className="btn btn-quiet">
            Cancel
          </Link>
        </div>
        {mode === "create" && <p className="hint">Suggestions are checked before they appear on the board, so yours won't show up straight away.</p>}
      </div>

      {visibleGuidelines.length > 0 && (
        <aside className="form-aside panel" aria-label="Guidelines">
          <h2>Before you post</h2>
          <ol className="guidelines">
            {visibleGuidelines.map((g) => (
              <li key={g.id}>
                <div className="grow">{g.node}</div>
              </li>
            ))}
          </ol>
        </aside>
      )}
    </form>
  );
}
