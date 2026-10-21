"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { LIMITS, type ColorKey } from "@/shared/constants";
import { api } from "./api-client";
import { ColorPicker } from "./ColorPicker";

export interface SettingsValues {
  siteName: string;
  introText: string;
  accentColor: ColorKey;
  discordInviteUrl: string;
  memberRoleId: string | null;
  voteSlots: number | null;
  minDaysInServer: number;
  submissionsOpen: boolean;
  maxPendingPerUser: number;
  maxSubmissionsPerDay: number;
  maxTagsPerSuggestion: number;
  requireGuidelinesAck: boolean;
  defaultCommentsMode: "OFF" | "OPEN";
  removeVotesOnLeave: boolean;
}

interface Role {
  id: string;
  name: string;
}

function Switch({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle-row">
      <span>
        <strong>{label}</strong>
        {hint && <p>{hint}</p>}
      </span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

function NumberField({ id, label, hint, value, min, max, onChange }: { id: string; label: string; hint?: string; value: number; min: number; max: number; onChange: (n: number) => void }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} className="input" type="number" inputMode="numeric" min={min} max={max} value={Number.isNaN(value) ? "" : value} onChange={(e) => onChange(e.target.value === "" ? Number.NaN : Number(e.target.value))} />
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

export function SettingsForm({ initial }: { initial: SettingsValues }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [v, setV] = useState<SettingsValues>(initial);
  const [roles, setRoles] = useState<Role[] | null>(null);
  const [rolesError, setRolesError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof SettingsValues>(key: K, value: SettingsValues[K]) => setV((s) => ({ ...s, [key]: value }));

  useEffect(() => {
    let live = true;
    api<{ roles: Role[] }>("GET", "/api/admin/discord-roles").then((r) => {
      if (!live) return;
      if (r.ok && r.data) setRoles(r.data.roles);
      else setRolesError(r.message);
    });
    return () => {
      live = false;
    };
  }, []);

  const dirty = JSON.stringify(v) !== JSON.stringify(initial);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const result = await api("PATCH", "/api/admin/settings", v);
    setBusy(false);
    if (!result.ok) {
      const first = result.fieldErrors ? Object.entries(result.fieldErrors).map(([k, m]) => `${k}: ${m[0]}`)[0] : null;
      return setMessage({ tone: "bad", text: first ?? result.message ?? "Couldn't save." });
    }
    setMessage({ tone: "ok", text: "Saved." });
    startTransition(() => router.refresh());
  }

  const unlimited = v.voteSlots === null;

  return (
    <form onSubmit={save} className="stack-lg">
      <section className="panel settings-section" aria-labelledby="s-site">
        <h2 id="s-site">Site</h2>
        <p className="hint">How the site presents itself.</p>
        <div className="field">
          <label htmlFor="siteName">Site name</label>
          <input id="siteName" className="input" value={v.siteName} maxLength={LIMITS.siteNameMax} onChange={(e) => set("siteName", e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="introText">Introduction</label>
          <textarea id="introText" className="textarea" rows={3} maxLength={LIMITS.introMax} value={v.introText} onChange={(e) => set("introText", e.target.value)} />
          <span className="hint">Shown at the top of the board. Basic formatting works. Leave blank for the default text.</span>
        </div>
        <div className="field">
          <span className="field-label">Accent colour</span>
          <ColorPicker name="accent" value={v.accentColor} onChange={(c) => set("accentColor", c)} />
        </div>
        <div className="field">
          <label htmlFor="invite">Discord invite link</label>
          <input id="invite" className="input" type="url" placeholder="https://discord.gg/…" value={v.discordInviteUrl} maxLength={200} onChange={(e) => set("discordInviteUrl", e.target.value)} />
          <span className="hint">Shown to people who sign in without the Member role.</span>
        </div>
      </section>

      <section className="panel settings-section" aria-labelledby="s-access">
        <h2 id="s-access">Who can take part</h2>
        <p className="hint">Anyone can read the board. Members can suggest, vote and comment. Only you can sign in until a Member role is chosen.</p>
        <div className="field">
          <label htmlFor="memberRole">Member role</label>
          {roles ? (
            <select id="memberRole" className="select" value={v.memberRoleId ?? ""} onChange={(e) => set("memberRoleId", e.target.value || null)}>
              <option value="">— not chosen yet —</option>
              {v.memberRoleId && !roles.some((r) => r.id === v.memberRoleId) && <option value={v.memberRoleId}>Unknown role ({v.memberRoleId})</option>}
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          ) : rolesError ? (
            <>
              <input id="memberRole" className="input mono" inputMode="numeric" placeholder="Role ID" value={v.memberRoleId ?? ""} onChange={(e) => set("memberRoleId", e.target.value.trim() || null)} />
              <span className="error-text">Couldn't load the server's roles ({rolesError}). You can paste the role's ID instead.</span>
            </>
          ) : (
            <select id="memberRole" className="select" disabled>
              <option>Loading roles…</option>
            </select>
          )}
        </div>
        <NumberField
          id="minDays"
          label="Days in the server before taking part"
          hint="0 turns it off. A few days makes it harder for brand-new accounts to pile on votes."
          value={v.minDaysInServer}
          min={0}
          max={365}
          onChange={(n) => set("minDaysInServer", n)}
        />
        <Switch label="Remove votes when someone leaves or loses the role" hint="Their votes on open suggestions are withdrawn at the next check, so counts reflect your current community." checked={v.removeVotesOnLeave} onChange={(x) => set("removeVotesOnLeave", x)} />
      </section>

      <section className="panel settings-section" aria-labelledby="s-votes">
        <h2 id="s-votes">Voting</h2>
        <p className="hint">
          Each member has a limited number of votes on open suggestions. That makes people choose what they want most, instead of voting for everything.
          A vote comes back when its suggestion moves to a status where voting is closed.
        </p>
        <div className="field">
          <label htmlFor="slots">Votes per member</label>
          <div className="row">
            <input
              id="slots"
              className="input"
              type="number"
              min={1}
              max={50}
              disabled={unlimited}
              value={unlimited ? "" : (v.voteSlots ?? 5)}
              onChange={(e) => set("voteSlots", e.target.value === "" ? 5 : Number(e.target.value))}
            />
            <label className="check">
              <input type="checkbox" checked={unlimited} onChange={(e) => set("voteSlots", e.target.checked ? null : 5)} />
              <span>Unlimited</span>
            </label>
          </div>
          <span className="hint">Lowering this never removes existing votes; people just can't add more until they're under the new limit.</span>
        </div>
      </section>

      <section className="panel settings-section" aria-labelledby="s-submit">
        <h2 id="s-submit">Suggestions</h2>
        <p className="hint">Your own suggestions skip the queue and these limits.</p>
        <Switch label="Accept new suggestions" hint="Turn off to pause submissions, for example while you catch up on the queue." checked={v.submissionsOpen} onChange={(x) => set("submissionsOpen", x)} />
        <div className="editor-row-grid">
          <NumberField id="maxPending" label="Waiting at once, per person" value={v.maxPendingPerUser} min={1} max={50} onChange={(n) => set("maxPendingPerUser", n)} />
          <NumberField id="maxDay" label="Per person, per day" value={v.maxSubmissionsPerDay} min={1} max={100} onChange={(n) => set("maxSubmissionsPerDay", n)} />
          <NumberField id="maxTags" label="Tags per suggestion" hint="0 turns tags off." value={v.maxTagsPerSuggestion} min={0} max={10} onChange={(n) => set("maxTagsPerSuggestion", n)} />
        </div>
        <Switch label="Ask people to confirm they've read the guidelines" hint="Asked once, and again whenever you change a guideline." checked={v.requireGuidelinesAck} onChange={(x) => set("requireGuidelinesAck", x)} />
      </section>

      <section className="panel settings-section" aria-labelledby="s-comments">
        <h2 id="s-comments">Comments</h2>
        <p className="hint">You choose per suggestion, on its page. Whether comments close by themselves is set per status.</p>
        <div className="field">
          <label htmlFor="defaultComments">When a suggestion is approved, comments start…</label>
          <select id="defaultComments" className="select" value={v.defaultCommentsMode} onChange={(e) => set("defaultCommentsMode", e.target.value as "OFF" | "OPEN")}>
            <option value="OFF">Off (you turn them on where you want them)</option>
            <option value="OPEN">Open</option>
          </select>
        </div>
      </section>

      <div className="row">
        <button type="submit" className={`btn ${busy ? "is-busy" : ""}`} disabled={!dirty || busy}>
          Save settings
        </button>
        {message && (
          <span role="status" className={`status-msg ${message.tone}`}>
            {message.text}
          </span>
        )}
      </div>
    </form>
  );
}
