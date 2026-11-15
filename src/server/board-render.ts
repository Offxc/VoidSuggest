import { createHash } from "node:crypto";
import type { ColorKey } from "../shared/constants";
import { excerptOf } from "./dto";
import type { MessagePayload } from "./discord";

/**
 * What the Discord board looks like. Pure functions: data in, message out, so
 * the wording and the safety rules can be tested without Discord.
 *
 * Everything people typed is treated as untrusted text. It never pings anyone,
 * never becomes a link to somewhere we didn't choose, and never turns into
 * Discord formatting.
 */

const ZWSP = String.fromCodePoint(0x200b);

/** Embed colours for the site's fixed palette. */
const COLOR_HEX: Record<ColorKey, number> = {
  purple: 0x8164e3,
  green: 0x4ade80,
  blue: 0x4cc2ff,
  teal: 0x2dd4bf,
  amber: 0xf5c453,
  orange: 0xf59e42,
  red: 0xf87171,
  pink: 0xf472b6,
  gray: 0x9ca3af,
};

const DOT = {
  purple: String.fromCodePoint(0x1f7e3),
  green: String.fromCodePoint(0x1f7e2),
  blue: String.fromCodePoint(0x1f535),
  amber: String.fromCodePoint(0x1f7e1),
  orange: String.fromCodePoint(0x1f7e0),
  red: String.fromCodePoint(0x1f534),
  gray: String.fromCodePoint(0x26aa),
};
const COLOR_DOT: Record<ColorKey, string> = {
  purple: DOT.purple,
  green: DOT.green,
  blue: DOT.blue,
  teal: DOT.blue,
  amber: DOT.amber,
  orange: DOT.orange,
  red: DOT.red,
  pink: DOT.purple,
  gray: DOT.gray,
};

const UP_ARROW = String.fromCodePoint(0x2b06, 0xfe0f);
const LOCK = String.fromCodePoint(0x1f512);

export const stageDot = (color: ColorKey): string => COLOR_DOT[color];

/** Drops control characters and keeps a mention from being a mention. For places that don't render formatting (titles, footers). */
export function plain(text: string, max: number): string {
  const flat = text.replace(/[\x00-\x1f\x7f]+/g, " ").replace(/\s+/g, " ").trim();
  const short = flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
  return short.replace(/@/g, `@${ZWSP}`).replace(/</g, `<${ZWSP}`);
}

/** As `plain`, and also stops Discord formatting and links from taking effect. For places that do render it. */
export function formatted(text: string, max: number): string {
  return plain(text, max).replace(/([\\*_~`|>[\]()#])/g, "\\$1");
}

function textLength(embeds: { title: string; description: string }[]): number {
  return embeds.reduce((total, e) => total + e.title.length + e.description.length, 0);
}

function hashOf(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export interface Rendered {
  payload: MessagePayload;
  /** Changes whenever what people see would change. */
  hash: string;
}

// ── One suggestion ───────────────────────────────────────────────────

export interface PostInput {
  publicId: string;
  title: string;
  body: string;
  voteCount: number;
  authorName: string;
  typeName: string | null;
  tags: string[];
  status: { name: string; color: ColorKey; votingOpen: boolean };
  approvedAt: Date | null;
  siteOrigin: string;
}

/**
 * Ideas can only be submitted on the site, so every post says where. The link
 * goes to the form, which asks people to sign in first if they haven't.
 */
function suggestButton(siteOrigin: string) {
  return { type: 2, style: 5, label: "Suggest an idea", url: `${siteOrigin}/new` };
}

/** The line the owner can put in the channel's topic, so the channel itself says where to send ideas. */
export function suggestedTopic(siteOrigin: string): string {
  return `Suggest an idea at ${new URL(siteOrigin).host}. Vote with the button under each post.`;
}

/** The custom ids on the buttons. Parsed back by the interactions handler. */
export const voteButtonId = (publicId: string): string => `v:a:${publicId}`;

export function renderPost(input: PostInput): Rendered {
  const url = `${input.siteOrigin}/s/${input.publicId}`;
  const open = input.status.votingOpen;

  const footer = [`Suggested by ${plain(input.authorName, 64)}`, ...input.tags.slice(0, 4).map((t) => plain(t, 32))].join(" · ");

  const payload: MessagePayload = {
    embeds: [
      {
        title: plain(input.title, 256),
        url,
        description: formatted(excerptOf(input.body, 400), 400),
        color: COLOR_HEX[input.status.color],
        fields: [
          { name: "Stage", value: `${COLOR_DOT[input.status.color]} ${formatted(input.status.name, 40)}`, inline: true },
          { name: "Votes", value: String(input.voteCount), inline: true },
          ...(input.typeName ? [{ name: "Type", value: formatted(input.typeName, 40), inline: true }] : []),
        ],
        footer: { text: footer },
        ...(input.approvedAt ? { timestamp: input.approvedAt.toISOString() } : {}),
      },
    ],
    components: [
      {
        type: 1,
        components: [
          open
            ? { type: 2, style: 1, label: "Vote", emoji: { name: UP_ARROW }, custom_id: voteButtonId(input.publicId) }
            : { type: 2, style: 2, label: "Voting closed", emoji: { name: LOCK }, custom_id: voteButtonId(input.publicId), disabled: true },
          { type: 2, style: 5, label: "View on site", url },
          suggestButton(input.siteOrigin),
        ],
      },
    ],
    allowed_mentions: { parse: [] },
  };
  return { payload, hash: hashOf(payload) };
}

// ── The stages overview ──────────────────────────────────────────────

export interface RoadmapInput {
  siteOrigin: string;
  /** Where people vote, so the overview can point at it. */
  boardChannelId: string | null;
  columns: {
    status: { name: string; color: ColorKey };
    total: number;
    items: { publicId: string; title: string; voteCount: number }[];
  }[];
}

const MAX_STAGE_LINES = 12;
const MAX_EMBEDS = 10;
/** Discord rejects a message whose embeds hold more than 6000 characters in total; stay clear of it. */
const EMBED_TEXT_BUDGET = 5600;

export function renderRoadmap(input: RoadmapInput): Rendered {
  const stages = input.columns.slice(0, MAX_EMBEDS);

  const build = (maxLines: number) =>
    stages.map((column) => {
      const lines = column.items.slice(0, maxLines).map((item) => {
        const votes = `${item.voteCount} vote${item.voteCount === 1 ? "" : "s"}`;
        return `• [${formatted(item.title, 60)}](${input.siteOrigin}/s/${item.publicId}) · ${votes}`;
      });
      const hidden = column.total - lines.length;
      if (hidden > 0) lines.push(`…and ${hidden} more on the site`);
      return {
        title: `${COLOR_DOT[column.status.color]} ${plain(column.status.name, 60)} · ${column.total}`,
        description: lines.length > 0 ? lines.join("\n") : "*Nothing here yet.*",
        color: COLOR_HEX[column.status.color],
      };
    });

  // Show fewer ideas per stage until the whole message fits.
  let embeds = build(MAX_STAGE_LINES);
  for (let cap = MAX_STAGE_LINES - 1; cap >= 1 && textLength(embeds) > EMBED_TEXT_BUDGET; cap--) embeds = build(cap);

  const where = input.boardChannelId && /^\d{5,25}$/.test(input.boardChannelId) ? ` Vote on new ideas in <#${input.boardChannelId}>.` : "";
  const payload: MessagePayload = {
    // The address is in angle brackets so Discord doesn't turn it into a big preview.
    content: `**Roadmap**\nWhere every idea stands.${where}\nGot an idea? Suggest it at <${input.siteOrigin}/new>.`,
    embeds,
    components: [
      {
        type: 1,
        components: [
          { type: 2, style: 5, label: "Open the roadmap", url: `${input.siteOrigin}/roadmap` },
          suggestButton(input.siteOrigin),
        ],
      },
    ],
    allowed_mentions: { parse: [] },
  };
  return { payload, hash: hashOf(payload) };
}
