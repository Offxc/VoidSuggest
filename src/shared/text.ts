/**
 * Text clean-up applied to everything a user can type, before it is stored.
 * The goal is to remove characters that serve no honest purpose in a short
 * piece of prose and a lot of dishonest ones: control characters, and the
 * zero-width and bidirectional override characters used to spoof names and
 * hide text.
 */

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
const INVISIBLE = /[\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff\u00ad]/g;

/** Single-line text such as titles and names. */
export function cleanLine(input: string): string {
  return input
    .normalize("NFC")
    .replace(CONTROL, "")
    .replace(INVISIBLE, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Multi-line prose. Keeps line breaks, collapses runs of blank lines. */
export function cleanBlock(input: string): string {
  return input
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(CONTROL, "")
    .replace(INVISIBLE, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function slugify(input: string, max = 40): string {
  const slug = input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
  return slug || "item";
}

/** Escapes LIKE wildcards so user input is matched literally. */
export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (c) => `\\${c}`);
}
