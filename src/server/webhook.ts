import { audit } from "./audit";
import { decryptSecret } from "./crypto";
import { DiscordError, sendWebhook, type WebhookEmbed } from "./discord";
import { excerptOf } from "./dto";
import { getEnv } from "./env";
import { getSettings } from "./settings";

/**
 * Optional Discord channel notifications. Best effort: a failed notification
 * is recorded in the audit log and never affects the action that caused it.
 *
 * User-written text only ever appears in plain embed fields (never as a
 * clickable masked link), and every message is sent with mentions disabled.
 */

const PURPLE = 0x8164e3;
const BLUE = 0x4cc2ff;

function plain(text: string, max: number): string {
  // Insert a zero-width space after "@" so it reads as text even in a client that ignores allowed_mentions.
  return excerptOf(text, max).replace(/@/g, "@\u200b");
}

async function deliver(kind: "pending" | "status", embed: WebhookEmbed): Promise<void> {
  try {
    const settings = await getSettings();
    if (!settings.webhookUrlEnc) return;
    if (kind === "pending" ? !settings.notifyPending : !settings.notifyStatusChange) return;
    const url = decryptSecret(settings.webhookUrlEnc);
    if (!url) throw new DiscordError("Stored webhook could not be read", 0);
    await sendWebhook(url, settings.siteName, embed);
  } catch (err) {
    await audit({
      action: "webhook.send",
      outcome: "FAILURE",
      details: { kind, discordStatus: err instanceof DiscordError ? err.status : undefined },
    });
  }
}

function link(publicId: string): string {
  return `${getEnv().siteOrigin}/s/${publicId}`;
}

export function announcePending(s: { publicId: string; title: string; body: string; authorName: string; typeName: string | null }): Promise<void> {
  return deliver("pending", {
    title: "New suggestion waiting for approval",
    url: `${getEnv().siteOrigin}/admin`,
    description: `**${plain(s.title, 120)}**\n${plain(s.body, 300)}`,
    color: PURPLE,
    fields: [
      { name: "From", value: plain(s.authorName, 64), inline: true },
      ...(s.typeName ? [{ name: "Type", value: plain(s.typeName, 40), inline: true }] : []),
    ],
  });
}

export function announceStatusChange(s: { publicId: string; title: string; toStatus: string }): Promise<void> {
  return deliver("status", {
    title: `Moved to ${plain(s.toStatus, 40)}`,
    url: link(s.publicId),
    description: plain(s.title, 200),
    color: BLUE,
  });
}

/** Sends a test message regardless of the per-event switches. Throws on failure so the owner sees why. */
export async function sendTestMessage(): Promise<void> {
  const settings = await getSettings();
  if (!settings.webhookUrlEnc) throw new DiscordError("No webhook is set", 400);
  const url = decryptSecret(settings.webhookUrlEnc);
  if (!url) throw new DiscordError("The stored webhook could not be read; enter it again", 400);
  await sendWebhook(url, settings.siteName, {
    title: "Test message",
    description: "Notifications from this site will appear in this channel.",
    color: PURPLE,
  });
}
