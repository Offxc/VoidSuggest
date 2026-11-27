"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { LIMITS } from "@/shared/constants";
import { IMAGE_MAX_BYTES, IMAGE_MAX_PER_SUGGESTION, IMAGE_UPLOAD_TYPES } from "@/shared/images";
import type { SuggestionImageDto, TagDto, TypeDto } from "@/shared/types";
import { api, apiUpload } from "./api-client";
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
  /** Pictures the suggestion already has (editing). */
  existingImages?: SuggestionImageDto[];
  /** When and whether pictures are deleted, in the owner's words. */
  imageNote?: string | null;
  initial?: { publicId: string; title: string; body: string; typeId: string | null; tagIds: string[] };
}

interface Hit {
  publicId: string;
  title: string;
  voteCount: number;
  statusName: string;
}

interface QueuedImage {
  file: File;
  preview: string;
}

export function SuggestionForm({ mode, types, tags, maxTags, guidelines, needsAck, existingImages = [], imageNote = null, initial }: Props) {
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

  // Pictures: ones it already has, and ones chosen but not sent yet.
  const [images, setImages] = useState<SuggestionImageDto[]>(existingImages);
  const [queued, setQueued] = useState<QueuedImage[]>([]);
  const [imageProblem, setImageProblem] = useState<string | null>(null);
  // Set when the suggestion was saved but some pictures didn't go through, so the form can't be sent twice.
  const [saved, setSaved] = useState<{ publicId: string; problems: string[] } | null>(null);
  const previews = useRef<string[]>([]);
  const imageRoom = IMAGE_MAX_PER_SUGGESTION - images.length - queued.length;

  // Previews are made in the browser, so give the memory back when the form goes away.
  useEffect(
    () => () => {
      for (const url of previews.current) URL.revokeObjectURL(url);
    },
    [],
  );

  function choose(list: FileList | null) {
    if (!list) return;
    setImageProblem(null);
    const accepted: QueuedImage[] = [];
    const problems: string[] = [];
    for (const file of Array.from(list)) {
      if (!(IMAGE_UPLOAD_TYPES as readonly string[]).includes(file.type)) problems.push(`${file.name} isn't a PNG, JPEG or WebP image.`);
      else if (file.size > IMAGE_MAX_BYTES) problems.push(`${file.name} is over ${IMAGE_MAX_BYTES / (1024 * 1024)} MB.`);
      else if (accepted.length >= imageRoom) problems.push(`Only ${IMAGE_MAX_PER_SUGGESTION} images fit on a suggestion.`);
      else {
        const preview = URL.createObjectURL(file);
        previews.current.push(preview);
        accepted.push({ file, preview });
      }
    }
    if (accepted.length > 0) setQueued((q) => [...q, ...accepted]);
    if (problems.length > 0) setImageProblem([...new Set(problems)].join(" "));
  }

  function unqueue(preview: string) {
    URL.revokeObjectURL(preview);
    previews.current = previews.current.filter((p) => p !== preview);
    setQueued((q) => q.filter((x) => x.preview !== preview));
  }

  async function removeExisting(image: SuggestionImageDto) {
    setImageProblem(null);
    const result = await api("DELETE", `/api/suggestions/${initial!.publicId}/images/${image.id}`);
    if (!result.ok) return setImageProblem(result.message ?? "Couldn't remove that image.");
    setImages((list) => list.filter((i) => i.id !== image.id));
  }

  /** Sends the chosen pictures one at a time. Returns what went wrong, if anything. */
  async function sendImages(publicId: string): Promise<string[]> {
    const problems: string[] = [];
    for (const item of queued) {
      const result = await apiUpload<SuggestionImageDto>(`/api/suggestions/${publicId}/images`, item.file);
      if (result.ok) unqueue(item.preview);
      else problems.push(`${item.file.name}: ${result.message ?? "couldn't be uploaded."}`);
    }
    return problems;
  }

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
    if (!result.ok) {
      setBusy(false);
      setError(result.message);
      setFields(result.fieldErrors ?? {});
      return;
    }
    const target = mode === "create" ? (result.data as { publicId: string }).publicId : initial!.publicId;
    const problems = queued.length > 0 ? await sendImages(target) : [];
    setBusy(false);
    if (problems.length > 0) {
      // The text is saved. Stay here and say what didn't go through, rather than lose track of it.
      setSaved({ publicId: target, problems });
      return;
    }
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
    (!needsAck || ack) &&
    saved === null;

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
          <p className="hint">You can use **bold**, *italic*, lists and `code`. Links are fine; raw HTML isn't shown. Add pictures with the box below instead of in the text.</p>
          {fields.body && <p className="error-text">{fields.body[0]}</p>}
        </div>

        <fieldset className="field">
          <legend className="field-label">
            Images <span className="dim">(optional, up to {IMAGE_MAX_PER_SUGGESTION})</span>
          </legend>
          {(images.length > 0 || queued.length > 0) && (
            <div className="image-grid">
              {images.map((img) => (
                <figure key={img.id} className="thumb">
                  <img src={img.url} width={img.width} height={img.height} alt="An image already on this suggestion" />
                  <button type="button" className="btn btn-quiet btn-sm" onClick={() => removeExisting(img)}>
                    Remove
                  </button>
                </figure>
              ))}
              {queued.map((q) => (
                <figure key={q.preview} className="thumb">
                  <img src={q.preview} alt={`Preview of ${q.file.name}`} />
                  <button type="button" className="btn btn-quiet btn-sm" onClick={() => unqueue(q.preview)}>
                    Remove
                  </button>
                </figure>
              ))}
            </div>
          )}
          {imageRoom > 0 && (
            <input
              id="images"
              className="input"
              type="file"
              accept={IMAGE_UPLOAD_TYPES.join(",")}
              multiple
              onChange={(e) => {
                choose(e.target.files);
                e.target.value = "";
              }}
              aria-label="Add images"
            />
          )}
          {imageProblem && (
            <p role="alert" className="error-text">
              {imageProblem}
            </p>
          )}
          <p className="hint">
            PNG, JPEG or WebP, up to {IMAGE_MAX_BYTES / (1024 * 1024)} MB each. The site saves its own copy, which removes any location or camera details.
            Until it's approved, only you and the owner can see them.{imageNote ? ` ${imageNote}` : ""}
          </p>
        </fieldset>

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

        {saved && (
          <div role="alert" className="notice-bar warn">
            <p>
              <strong>{mode === "create" ? "Your suggestion was submitted" : "Your changes were saved"}, but some images didn't upload:</strong>
            </p>
            <ul>
              {saved.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
            <p>
              <Link href={`/s/${saved.publicId}`}>Open the suggestion</Link>, or <Link href={`/s/${saved.publicId}/edit`}>edit it</Link> to add the images again.
            </p>
          </div>
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
