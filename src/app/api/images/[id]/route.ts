import { defineApi } from "@/server/http";
import { getImageFor } from "@/server/images";
import { rowIdParam } from "@/server/params";
import { notFound } from "@/server/errors";
import { readCookie, sessionCookieName, userFromToken } from "@/server/session";

/**
 * Serves a stored picture. The address ends in `.webp` (Discord likes to see a
 * file type); only the id before it matters.
 *
 * Pictures on approved suggestions are public. A picture on a suggestion that
 * isn't approved yet is for its author and the owner only, and anyone else is
 * told it doesn't exist, the same as for a made-up id.
 */
export const GET = defineApi({
  auth: "public",
  rate: { name: "image-read", limit: 1200, windowMs: 60_000 },
  handler: async ({ req, params }) => {
    const match = /^([a-z0-9]{20,32})\.webp$/.exec(params.id ?? "");
    if (!match) throw notFound();
    const id = rowIdParam({ id: match[1]! });

    const viewer = await userFromToken(readCookie(req.headers, sessionCookieName()));
    const image = await getImageFor(id, viewer);
    if (!image) throw notFound();

    // A picture never changes once stored, so its id is a perfect validator.
    const etag = `"${id}"`;
    const headers: Record<string, string> = {
      ETag: etag,
      "Content-Type": "image/webp",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": 'inline; filename="image.webp"',
      // An hour is short enough that a deleted picture soon stops being served from anyone's cache.
      "Cache-Control": image.isPublic ? "public, max-age=3600" : "private, no-store",
    };
    if (image.isPublic && req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
    return new Response(new Uint8Array(image.data), { status: 200, headers: { ...headers, "Content-Length": String(image.data.length) } });
  },
});
