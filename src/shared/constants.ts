/**
 * Values shared by the server and the browser. Nothing in here may import
 * server-only code.
 */

/**
 * Colours are chosen from this fixed palette by name. Free-form hex values
 * from the database would need inline styles (and a looser CSP) and are one
 * more injection surface, so they are not supported.
 */
export const COLOR_KEYS = ["purple", "green", "blue", "teal", "amber", "orange", "red", "pink", "gray"] as const;
export type ColorKey = (typeof COLOR_KEYS)[number];

/** Icons offered for suggestion types. Rendered from a fixed set of inline SVGs. */
export const ICON_KEYS = [
  "sparkle",
  "wrench",
  "bug",
  "star",
  "heart",
  "globe",
  "sword",
  "pickaxe",
  "shield",
  "flag",
  "chat",
  "clock",
] as const;
export type IconKey = (typeof ICON_KEYS)[number];

export const LIMITS = {
  siteNameMax: 60,
  introMax: 1000,
  titleMin: 8,
  titleMax: 120,
  bodyMin: 20,
  bodyMax: 4000,
  commentMax: 1000,
  rejectionReasonMax: 500,
  blockReasonMax: 200,
  statusNameMax: 40,
  typeNameMax: 40,
  typeDescriptionMax: 200,
  tagNameMax: 32,
  guidelineTitleMax: 80,
  guidelineBodyMax: 2000,
  searchMax: 80,
  maxStatuses: 12,
  maxTypes: 12,
  maxTags: 60,
  maxGuidelines: 30,
  commentEditWindowMs: 15 * 60 * 1000,
} as const;

/** How long a cached Discord role/nickname check is trusted before a write re-checks it. */
export const IDENTITY_FRESH_MS = 5 * 60 * 1000;

export const PAGE_SIZE = 20;

/** The name a fresh install starts with (matches the database default). Under this name the site shows its logo. */
export const DEFAULT_SITE_NAME = "VoidSuggest";
