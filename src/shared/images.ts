/**
 * What the upload form and the server both need to know about pictures. Kept
 * free of server code so the browser can use it.
 */

export const IMAGE_UPLOAD_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const IMAGE_MAX_PER_SUGGESTION = 4;

/** "Images are deleted 30 days after it reaches Completed.", from whatever the owner has set. Null if nothing is deleted. */
export function retentionNote(statuses: { name: string; imageRetentionDays: number | null }[]): string | null {
  const rules = statuses.filter((s) => s.imageRetentionDays !== null);
  if (rules.length === 0) return null;
  const parts = rules.map((s) => `${s.imageRetentionDays} day${s.imageRetentionDays === 1 ? "" : "s"} after a suggestion reaches ${s.name}`);
  return `Images are deleted ${parts.join(", or ")}.`;
}
