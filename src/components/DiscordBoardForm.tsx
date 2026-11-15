"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { api } from "./api-client";

export interface BoardState {
  enabled: boolean;
  channelId: string | null;
  roadmapChannelId: string | null;
  publicKeyConfigured: boolean;
  interactionsUrl: string;
  suggestedTopic: string;
  openCount: number;
  postedCount: number;
  run: { running: boolean; posted: number; updated: number; failed: number; error: string | null; finishedAt: string | null };
}

export function DiscordBoardForm({ initial }: { initial: BoardState }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [board, setBoard] = useState(initial);
  const [enabled, setEnabled] = useState(initial.enabled);
  const [channelId, setChannelId] = useState(initial.channelId ?? "");
  const [roadmapChannelId, setRoadmapChannelId] = useState(initial.roadmapChannelId ?? "");
  const [includeClosed, setIncludeClosed] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<"url" | "topic" | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  // While posts are going out, check on them every couple of seconds.
  useEffect(() => {
    if (!board.run.running) return;
    timer.current = setInterval(async () => {
      const result = await api<BoardState>("GET", "/api/admin/discord/board");
      if (result.ok && result.data) {
        setBoard(result.data);
        if (!result.data.run.running) startTransition(() => router.refresh());
      }
    }, 2000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [board.run.running, router]);

  const dirty = enabled !== board.enabled || channelId.trim() !== (board.channelId ?? "") || roadmapChannelId.trim() !== (board.roadmapChannelId ?? "");

  async function save() {
    setBusy(true);
    setMessage(null);
    const result = await api<BoardState>("PUT", "/api/admin/discord/board", {
      enabled,
      channelId: channelId.trim(),
      roadmapChannelId: roadmapChannelId.trim(),
    });
    setBusy(false);
    if (!result.ok || !result.data) return setMessage({ tone: "bad", text: result.message ?? "Couldn't save." });
    setBoard(result.data);
    setMessage({ tone: "ok", text: "Saved." });
    startTransition(() => router.refresh());
  }

  async function postAll() {
    setBusy(true);
    setMessage(null);
    const result = await api<BoardState>("POST", "/api/admin/discord/board/post-all", { includeClosed });
    setBusy(false);
    if (!result.ok || !result.data) return setMessage({ tone: "bad", text: result.message ?? "Couldn't start posting." });
    setBoard({ ...result.data, run: { ...result.data.run, running: true } });
  }

  async function copy(what: "url" | "topic") {
    try {
      await navigator.clipboard.writeText(what === "url" ? board.interactionsUrl : board.suggestedTopic);
      setCopied(what);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      /* The address is shown on screen to copy by hand. */
    }
  }

  const { run } = board;
  const canPost = board.enabled && !dirty && !run.running && !busy;

  return (
    <div className="stack-lg">
      <section className="panel settings-section" aria-labelledby="d-connect">
        <h2 id="d-connect">1. Connect the buttons</h2>
        <p className="hint">
          Discord sends button clicks to this site, and the site checks they really came from Discord. Two things are needed: the application's
          public key in the server's <span className="mono">.env</span>, and this address in the developer portal.
        </p>
        <p>
          Public key: <strong>{board.publicKeyConfigured ? "Set" : "Not set"}</strong>
          {!board.publicKeyConfigured && (
            <span className="hint">
              {" "}
              Add <span className="mono">DISCORD_PUBLIC_KEY</span> (General Information, then Public Key) and restart the site.
            </span>
          )}
        </p>
        <div className="field">
          <label htmlFor="endpoint">Interactions Endpoint URL</label>
          <div className="row">
            <input id="endpoint" className="input mono grow" readOnly value={board.interactionsUrl} onFocus={(e) => e.currentTarget.select()} />
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => copy("url")}>
              {copied === "url" ? "Copied" : "Copy"}
            </button>
          </div>
          <span className="hint">
            Paste it under General Information in the Discord developer portal. Discord tests it when you save, so do this after the site is running with the public key.
          </span>
        </div>
      </section>

      <section className="panel settings-section" aria-labelledby="d-channels">
        <h2 id="d-channels">2. Choose the channels</h2>
        <p className="hint">
          Turn on Developer Mode in Discord, right-click a channel and choose Copy Channel ID. The bot needs View Channel, Send Messages and
          Embed Links there. It's checked when you save.
        </p>
        <label className="toggle-row">
          <span>
            <strong>Post suggestions to Discord</strong>
            <p>New approvals are posted on their own. Players vote with the button, using the same vote slots as on the site.</p>
          </span>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        </label>
        <div className="field">
          <label htmlFor="channel">Channel for suggestions</label>
          <input id="channel" className="input mono" inputMode="numeric" autoComplete="off" placeholder="e.g. 123456789012345678" value={channelId} onChange={(e) => setChannelId(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="roadmap">Channel for the stages overview (optional)</label>
          <input id="roadmap" className="input mono" inputMode="numeric" autoComplete="off" placeholder="e.g. 123456789012345678" value={roadmapChannelId} onChange={(e) => setRoadmapChannelId(e.target.value)} />
          <span className="hint">
            One message that lists what's planned, in progress and done, and updates itself. A read-only channel works well.
          </span>
        </div>
        <div className="field">
          <label htmlFor="topic">Say where ideas go</label>
          <div className="row">
            <input id="topic" className="input grow" readOnly value={board.suggestedTopic} onFocus={(e) => e.currentTarget.select()} />
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => copy("topic")}>
              {copied === "topic" ? "Copied" : "Copy"}
            </button>
          </div>
          <span className="hint">
            Ideas can only be submitted on the site. Every post has a button for it, and you can also paste this into the channel's topic
            (the bot can't set that itself).
          </span>
        </div>
        <div className="row">
          <button type="button" className="btn btn-sm" disabled={busy || !dirty} onClick={save}>
            {busy ? "Checking…" : "Save"}
          </button>
        </div>
      </section>

      <section className="panel settings-section" aria-labelledby="d-post">
        <h2 id="d-post">3. Post what's already there</h2>
        <p className="hint">
          Suggestions approved from now on are posted automatically. To put the ones you already have in the channel, post them here. It
          takes a few seconds per ten suggestions, and it's safe to press again: anything already posted is skipped.
        </p>
        <p>
          <strong>{board.openCount}</strong> open for voting, <strong>{board.postedCount}</strong> posted.
        </p>
        <label className="toggle-row">
          <span>
            <strong>Include suggestions that are no longer open for voting</strong>
            <p>Planned, completed and so on. They're posted with their stage and a locked vote button.</p>
          </span>
          <input type="checkbox" checked={includeClosed} onChange={(e) => setIncludeClosed(e.target.checked)} />
        </label>
        <div className="row">
          <button type="button" className="btn btn-sm" disabled={!canPost} onClick={postAll}>
            {run.running ? "Posting…" : "Post all current suggestions"}
          </button>
          {dirty && <span className="hint">Save your changes first.</span>}
        </div>
        {(run.running || run.finishedAt) && (
          <p role="status" className="hint">
            {run.running ? "Working: " : "Last run: "}
            {run.posted} posted, {run.updated} updated{run.failed > 0 ? `, ${run.failed} failed` : ""}.
          </p>
        )}
        {run.error && (
          <p role="alert" className="status-msg bad">
            {run.error}
          </p>
        )}
      </section>

      <section className="panel settings-section" aria-labelledby="d-how">
        <h2 id="d-how">How it behaves</h2>
        <ul className="hint">
          <li>Each post shows its stage and vote count, and keeps itself up to date as votes come in and you move it between stages.</li>
          <li>Voting is locked in exactly the stages where the site locks it: the button turns into a disabled "Voting closed".</li>
          <li>Clicking Vote shows the person how many votes they have left and asks them to confirm. If they have none left, it says so.</li>
          <li>The channel only gets a new message when there's a new suggestion. Votes, stage changes and edits change the existing post.</li>
          <li>If someone deletes a post in Discord it stays deleted, until you post everything again.</li>
        </ul>
      </section>

      {message && (
        <p role="status" className={`status-msg ${message.tone}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
