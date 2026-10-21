"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { api } from "./api-client";

interface Props {
  configured: boolean;
  notifyPending: boolean;
  notifyStatusChange: boolean;
}

export function NotificationsForm({ configured, notifyPending, notifyStatusChange }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [url, setUrl] = useState("");
  const [pending, setPending] = useState(notifyPending);
  const [status, setStatus] = useState(notifyStatusChange);
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => startTransition(() => router.refresh());

  async function saveWebhook(clear: boolean) {
    setBusy(true);
    setMessage(null);
    const result = await api("PUT", "/api/admin/settings/webhook", { url: clear ? "" : url });
    setBusy(false);
    if (!result.ok) return setMessage({ tone: "bad", text: result.message ?? "Couldn't save the webhook." });
    setUrl("");
    setMessage({ tone: "ok", text: clear ? "Webhook removed." : "Webhook saved." });
    refresh();
  }

  async function saveToggles() {
    setBusy(true);
    setMessage(null);
    const result = await api("PATCH", "/api/admin/settings", { notifyPending: pending, notifyStatusChange: status });
    setBusy(false);
    if (!result.ok) return setMessage({ tone: "bad", text: result.message ?? "Couldn't save." });
    setMessage({ tone: "ok", text: "Saved." });
    refresh();
  }

  async function sendTest() {
    setBusy(true);
    setMessage(null);
    const result = await api("POST", "/api/admin/settings/webhook/test");
    setBusy(false);
    setMessage(result.ok ? { tone: "ok", text: "Sent. Check your Discord channel." } : { tone: "bad", text: result.message ?? "The test didn't go through." });
  }

  return (
    <div className="stack-lg">
      <section className="panel settings-section" aria-labelledby="n-hook">
        <h2 id="n-hook">Discord channel</h2>
        <p className="hint">
          Post messages to a channel with a webhook: in Discord, open the channel's settings, then Integrations, then Webhooks, and copy the URL. It's
          stored encrypted and never shown again.
        </p>
        <p>
          Status: <strong>{configured ? "A webhook is saved" : "Not set up"}</strong>
        </p>
        <div className="field">
          <label htmlFor="webhook">{configured ? "Replace webhook URL" : "Webhook URL"}</label>
          <input id="webhook" className="input mono" type="password" autoComplete="off" placeholder="https://discord.com/api/webhooks/…" value={url} onChange={(e) => setUrl(e.target.value)} />
        </div>
        <div className="row">
          <button type="button" className="btn btn-sm" disabled={busy || url.trim() === ""} onClick={() => saveWebhook(false)}>
            Save webhook
          </button>
          {configured && (
            <>
              <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={sendTest}>
                Send a test message
              </button>
              <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => saveWebhook(true)}>
                Remove
              </button>
            </>
          )}
        </div>
      </section>

      <section className="panel settings-section" aria-labelledby="n-events">
        <h2 id="n-events">What to post</h2>
        <label className="toggle-row">
          <span>
            <strong>New suggestion waiting for approval</strong>
            <p>A short message with the title and a link to the queue.</p>
          </span>
          <input type="checkbox" checked={pending} onChange={(e) => setPending(e.target.checked)} />
        </label>
        <label className="toggle-row">
          <span>
            <strong>A suggestion changes status</strong>
            <p>For example, when something moves to Planned or Completed.</p>
          </span>
          <input type="checkbox" checked={status} onChange={(e) => setStatus(e.target.checked)} />
        </label>
        <div className="row">
          <button type="button" className="btn btn-sm" disabled={busy || (pending === notifyPending && status === notifyStatusChange)} onClick={saveToggles}>
            Save
          </button>
        </div>
      </section>

      {message && (
        <p role="status" className={`status-msg ${message.tone}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
