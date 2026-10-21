"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { ICON_KEYS, type ColorKey, type IconKey } from "@/shared/constants";
import type { TypeDto } from "@/shared/types";
import { api } from "./api-client";
import { ColorPicker } from "./ColorPicker";
import { Icon } from "./icons";

export type FieldDef =
  | { kind: "text"; key: string; label: string; max: number }
  | { kind: "textarea"; key: string; label: string; max: number; rows?: number }
  | { kind: "color"; key: string; label: string }
  | { kind: "icon"; key: string; label: string }
  | { kind: "switch"; key: string; label: string; hint?: string; lockedWhenOn?: string }
  | { kind: "types"; key: string; label: string; options: TypeDto[]; onlyWhenFalse: string };

type Draft = Record<string, unknown>;
export interface EntityRow extends Draft {
  id: string;
  /** Shown under the row's title, for example how many suggestions use it. Worked out on the server. */
  note?: string;
  /** If set, the row can't be deleted and this says why. Worked out on the server. */
  deleteBlock?: string;
}

interface Props {
  noun: string;
  base: string;
  items: EntityRow[];
  blank: Draft;
  fields: FieldDef[];
  max: number;
  /** Which field to use as the row's heading. */
  titleKey: string;
}

function pick(draft: Draft, fields: FieldDef[]): Draft {
  return Object.fromEntries(fields.map((f) => [f.key, draft[f.key]]));
}

function FieldInput({ field, draft, set, idPrefix }: { field: FieldDef; draft: Draft; set: (key: string, value: unknown) => void; idPrefix: string }) {
  const id = `${idPrefix}-${field.key}`;
  switch (field.kind) {
    case "text":
      return (
        <div className="field">
          <label htmlFor={id}>{field.label}</label>
          <input id={id} className="input input-sm" maxLength={field.max} value={String(draft[field.key] ?? "")} onChange={(e) => set(field.key, e.target.value)} />
        </div>
      );
    case "textarea":
      return (
        <div className="field" data-wide>
          <label htmlFor={id}>{field.label}</label>
          <textarea id={id} className="textarea" rows={field.rows ?? 3} maxLength={field.max} value={String(draft[field.key] ?? "")} onChange={(e) => set(field.key, e.target.value)} />
        </div>
      );
    case "color":
      return (
        <div className="field">
          <span className="field-label">{field.label}</span>
          <ColorPicker name={id} value={draft[field.key] as ColorKey} onChange={(c) => set(field.key, c)} />
        </div>
      );
    case "icon":
      return (
        <div className="field">
          <label htmlFor={id}>{field.label}</label>
          <div className="row">
            <Icon name={draft[field.key] as IconKey} />
            <select id={id} className="select input-sm" value={String(draft[field.key])} onChange={(e) => set(field.key, e.target.value)}>
              {ICON_KEYS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </div>
        </div>
      );
    case "switch": {
      const locked = Boolean(field.lockedWhenOn && draft[field.lockedWhenOn]);
      return (
        <label className="check" title={locked ? "Choose another one to change this" : undefined}>
          <input type="checkbox" checked={Boolean(draft[field.key])} disabled={locked} onChange={(e) => set(field.key, e.target.checked)} />
          <span>
            {field.label}
            {field.hint && <small className="hint">{field.hint}</small>}
          </span>
        </label>
      );
    }
    case "types": {
      if (draft[field.onlyWhenFalse]) return null;
      const selected = (draft[field.key] as string[]) ?? [];
      return (
        <fieldset className="field" data-wide>
          <legend className="field-label">{field.label}</legend>
          <div className="row">
            {field.options.map((t) => (
              <label key={t.id} className="check">
                <input
                  type="checkbox"
                  checked={selected.includes(t.id)}
                  onChange={(e) => set(field.key, e.target.checked ? [...selected, t.id] : selected.filter((x) => x !== t.id))}
                />
                <span>{t.name}</span>
              </label>
            ))}
          </div>
        </fieldset>
      );
    }
  }
}

function Fields({ fields, draft, set, idPrefix }: { fields: FieldDef[]; draft: Draft; set: (k: string, v: unknown) => void; idPrefix: string }) {
  const inputs = fields.filter((f) => f.kind !== "switch" && f.kind !== "types");
  const switches = fields.filter((f) => f.kind === "switch");
  const extras = fields.filter((f) => f.kind === "types");
  return (
    <>
      <div className="fields">
        {inputs.map((f) => (
          <FieldInput key={f.key} field={f} draft={draft} set={set} idPrefix={idPrefix} />
        ))}
      </div>
      {switches.length > 0 && (
        <div className="switches">
          {switches.map((f) => (
            <FieldInput key={f.key} field={f} draft={draft} set={set} idPrefix={idPrefix} />
          ))}
        </div>
      )}
      {extras.map((f) => (
        <FieldInput key={f.key} field={f} draft={draft} set={set} idPrefix={idPrefix} />
      ))}
    </>
  );
}

export function EntityEditor({ noun, base, items, blank, fields, max, titleKey }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [orderError, setOrderError] = useState<string | null>(null);
  const refresh = () => startTransition(() => router.refresh());

  async function move(index: number, direction: -1 | 1) {
    const ids = items.map((i) => i.id);
    const target = index + direction;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    setOrderError(null);
    const result = await api("POST", `${base}/reorder`, { ids });
    if (!result.ok) return setOrderError(result.message);
    refresh();
  }

  return (
    <div>
      {orderError && (
        <p role="alert" className="error-text">
          {orderError}
        </p>
      )}
      <div className="editor-list">
        {items.map((row, index) => (
          <Row
            key={`${row.id}-${JSON.stringify(pick(row, fields))}`}
            row={row}
            fields={fields}
            base={base}
            noun={noun}
            titleKey={titleKey}
            note={row.note ?? null}
            deleteBlock={row.deleteBlock ?? null}
            isFirst={index === 0}
            isLast={index === items.length - 1}
            onMove={(d) => move(index, d)}
            onChanged={refresh}
          />
        ))}
        {items.length === 0 && <p className="muted">No {noun}s yet.</p>}
      </div>
      {items.length < max ? (
        <NewRow base={base} noun={noun} blank={blank} fields={fields} onCreated={refresh} />
      ) : (
        <p className="hint">That's the most {noun}s you can have ({max}).</p>
      )}
    </div>
  );
}

function Row(props: {
  row: EntityRow;
  fields: FieldDef[];
  base: string;
  noun: string;
  titleKey: string;
  note: string | null;
  deleteBlock: string | null;
  isFirst: boolean;
  isLast: boolean;
  onMove: (d: -1 | 1) => void;
  onChanged: () => void;
}) {
  const { row, fields, base, noun, titleKey, note, deleteBlock } = props;
  const prefix = useId();
  const [draft, setDraft] = useState<Draft>(() => pick(row, fields));
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(pick(row, fields));

  async function save() {
    setBusy(true);
    setMessage(null);
    const result = await api("PUT", `${base}/${row.id}`, draft);
    setBusy(false);
    if (!result.ok) return setMessage({ tone: "bad", text: result.fieldErrors ? Object.values(result.fieldErrors).flat()[0] ?? result.message ?? "Couldn't save." : (result.message ?? "Couldn't save.") });
    setMessage({ tone: "ok", text: "Saved." });
    props.onChanged();
  }

  async function remove() {
    if (!window.confirm(`Delete the ${noun} “${String(row[titleKey])}”?`)) return;
    setBusy(true);
    const result = await api("DELETE", `${base}/${row.id}`);
    setBusy(false);
    if (!result.ok) return setMessage({ tone: "bad", text: result.message ?? "Couldn't delete." });
    props.onChanged();
  }

  return (
    <div className="editor-row">
      <div className="row-between">
        <strong>{String(row[titleKey])}</strong>
        <span className="row">
          {note && <span className="dim small">{note}</span>}
          <button type="button" className="btn btn-quiet" onClick={() => props.onMove(-1)} disabled={props.isFirst} aria-label={`Move ${String(row[titleKey])} up`}>
            <Icon name="up" />
          </button>
          <button type="button" className="btn btn-quiet" onClick={() => props.onMove(1)} disabled={props.isLast} aria-label={`Move ${String(row[titleKey])} down`}>
            <Icon name="down" />
          </button>
        </span>
      </div>
      <Fields fields={fields} draft={draft} set={(k, v) => setDraft((d) => ({ ...d, [k]: v }))} idPrefix={prefix} />
      <div className="actions">
        <button type="button" className="btn btn-sm" onClick={save} disabled={!dirty || busy}>
          Save
        </button>
        <button type="button" className="btn btn-danger btn-sm" onClick={remove} disabled={busy || Boolean(deleteBlock)} title={deleteBlock ?? undefined}>
          Delete
        </button>
        {deleteBlock && <span className="dim small">{deleteBlock}</span>}
        {message && (
          <span role="status" className={`status-msg ${message.tone}`}>
            {message.text}
          </span>
        )}
      </div>
    </div>
  );
}

function NewRow({ base, noun, blank, fields, onCreated }: { base: string; noun: string; blank: Draft; fields: FieldDef[]; onCreated: () => void }) {
  const prefix = useId();
  const [draft, setDraft] = useState<Draft>(blank);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>
        <Icon name="plus" /> Add a {noun}
      </button>
    );
  }

  async function create() {
    setBusy(true);
    setError(null);
    const result = await api("POST", base, pick(draft, fields));
    setBusy(false);
    if (!result.ok) return setError(result.fieldErrors ? (Object.values(result.fieldErrors).flat()[0] ?? result.message) : result.message);
    setDraft(blank);
    setOpen(false);
    onCreated();
  }

  return (
    <div className="editor-row">
      <strong>New {noun}</strong>
      <Fields fields={fields} draft={draft} set={(k, v) => setDraft((d) => ({ ...d, [k]: v }))} idPrefix={prefix} />
      <div className="actions">
        <button type="button" className="btn btn-sm" onClick={create} disabled={busy}>
          Add {noun}
        </button>
        <button type="button" className="btn btn-quiet" onClick={() => setOpen(false)}>
          Cancel
        </button>
        {error && (
          <span role="alert" className="error-text small">
            {error}
          </span>
        )}
      </div>
    </div>
  );
}
