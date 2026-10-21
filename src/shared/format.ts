/** Human-friendly time for lists: "just now", "5 minutes ago", "3 days ago", then a date. */
export function timeAgo(iso: string, now = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 45) return "just now";
  const [m, h, d] = [60, 3600, 86400];
  if (seconds < h) return plural(Math.round(seconds / m), "minute");
  if (seconds < d) return plural(Math.round(seconds / h), "hour");
  if (seconds < 7 * d) return plural(Math.round(seconds / d), "day");
  return formatDate(iso);
}

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"} ago`;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC`;
}
