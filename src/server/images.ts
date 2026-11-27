import sharp from "sharp";
import { prisma, type User } from "./db";
import { audit } from "./audit";
import { scheduleBoardSync } from "./board";
import { participationBlock } from "./eligibility";
import { IMAGE_MAX_BYTES, IMAGE_MAX_PER_SUGGESTION, IMAGE_UPLOAD_TYPES as UPLOAD_TYPES } from "../shared/images";
import { badRequest, conflict, forbidden, notFound } from "./errors";
import { getSettings } from "./settings";

/**
 * Pictures on suggestions.
 *
 * The rule that makes this safe: **the file someone uploads is never stored
 * or served.** It is only ever read by an image library, and what is kept is a
 * fresh WebP the server makes from the pixels. That removes everything else a
 * file can carry: scripts or HTML hidden after a valid image (the classic
 * "polyglot"), location and camera data in the metadata, colour-profile
 * tricks, extra frames. Before that happens the upload has to clear:
 *
 *  - a size limit, enforced while it streams in (see `rawBody` in http.ts);
 *  - the first bytes matching PNG, JPEG or WebP (no SVG, no GIF, no anything
 *    else), and the image library agreeing with that;
 *  - a limit on the number of pixels, checked before decoding, so a small file
 *    that expands into gigabytes (a "decompression bomb") is refused;
 *  - not being animated.
 *
 * Pictures live in the database, so they are backed up with everything else,
 * are deleted with their suggestion, and there are no file paths to get wrong.
 */

export const IMAGE_LIMITS = {
  /** Largest upload accepted, in bytes. Phone photos are typically 2 to 6 MB. */
  maxBytes: IMAGE_MAX_BYTES,
  /** Largest picture accepted, in pixels (a 48 megapixel phone photo is fine). */
  maxPixels: 50_000_000,
  /** The stored picture is scaled down to fit inside this many pixels each way. */
  maxEdge: 1600,
  maxPerSuggestion: IMAGE_MAX_PER_SUGGESTION,
  quality: 80,
} as const;

export const IMAGE_UPLOAD_TYPES = UPLOAD_TYPES;

// Nothing is kept in the library's own caches: pictures are processed once.
sharp.cache(false);

/** Processing is the one expensive thing here, so only a couple run at once. */
const MAX_CONCURRENT = 2;
let active = 0;
const waiting: (() => void)[] = [];

async function withSlot<T>(work: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) await new Promise<void>((resolve) => waiting.push(resolve));
  active++;
  try {
    return await work();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

const unreadable = () => badRequest("That image couldn't be read. Try another PNG, JPEG or WebP file.", "image_invalid");

/** What the first bytes say the file is. This is the only thing "type" means here; the browser's label is not trusted. */
function sniff(bytes: Buffer): "jpeg" | "png" | "webp" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP") return "webp";
  return null;
}

export interface ProcessedImage {
  data: Buffer;
  width: number;
  height: number;
}

/** Turns an upload into the picture that will be stored, or says why it can't be used. */
export async function processImage(upload: Buffer): Promise<ProcessedImage> {
  if (upload.length === 0) throw badRequest("That file is empty.", "image_invalid");
  if (upload.length > IMAGE_LIMITS.maxBytes) throw badRequest("That file is too large.", "image_too_large");

  const kind = sniff(upload);
  if (!kind) throw badRequest("Please upload a PNG, JPEG or WebP image.", "image_format");

  return withSlot(async () => {
    try {
      const open = () => sharp(upload, { limitInputPixels: IMAGE_LIMITS.maxPixels, failOn: "error", animated: false });

      // Header only: what the library thinks it is, and how big, before anything is decoded.
      const meta = await open().metadata();
      if (meta.format !== kind) throw unreadable();
      if ((meta.pages ?? 1) > 1) throw badRequest("Animated images aren't supported. Please upload a still picture.", "image_animated");
      if (!meta.width || !meta.height || meta.width * meta.height > IMAGE_LIMITS.maxPixels) {
        throw badRequest("That image is too large in pixels. Try a smaller one.", "image_too_large");
      }

      const { data, info } = await open()
        .rotate() // apply the camera's orientation, since the metadata that said so is about to go
        .resize({ width: IMAGE_LIMITS.maxEdge, height: IMAGE_LIMITS.maxEdge, fit: "inside", withoutEnlargement: true })
        .toColourspace("srgb")
        .webp({ quality: IMAGE_LIMITS.quality, effort: 4 }) // no `withMetadata`: nothing from the original is carried over
        .toBuffer({ resolveWithObject: true });
      return { data, width: info.width, height: info.height };
    } catch (err) {
      if (err instanceof Error && err.name === "HttpError") throw err;
      // The library enforces the pixel limit itself, while reading the header.
      if (err instanceof Error && /pixel limit/i.test(err.message)) {
        throw badRequest("That image is too large in pixels. Try a smaller one.", "image_too_large");
      }
      // Anything the library objects to (damaged file, over the pixel limit, unsupported variant): one plain message.
      throw unreadable();
    }
  });
}

// ── Who may change a suggestion's pictures ───────────────────────────

interface Target {
  id: string;
  authorId: string;
  approval: "PENDING" | "APPROVED" | "REJECTED";
}

/**
 * The owner may at any time. The author only while the suggestion waits for
 * approval, exactly like editing its text. Everyone else is told it doesn't
 * exist (if it isn't public) or that it's locked (if it is).
 */
function assertMayChange(actor: User, s: Target, settings: Awaited<ReturnType<typeof getSettings>>): void {
  if (actor.isOwner) return;
  const isAuthor = s.authorId === actor.id;
  if (!isAuthor && s.approval !== "APPROVED") throw notFound("Suggestion not found.");
  if (!isAuthor || s.approval !== "PENDING") throw forbidden("Only suggestions waiting for approval can be changed.", "locked");
  const block = participationBlock(actor, settings, { tenure: false });
  if (block) throw forbidden(block.message, block.code);
}

async function findTarget(publicId: string): Promise<Target> {
  const found = await prisma.suggestion.findUnique({ where: { publicId }, select: { id: true, authorId: true, approval: true } });
  if (!found) throw notFound("Suggestion not found.");
  return found;
}

export interface StoredImage {
  id: string;
  width: number;
  height: number;
  position: number;
}

export async function addImage(actor: User, publicId: string, upload: Buffer, request?: Request): Promise<StoredImage> {
  const settings = await getSettings();
  // Cheap checks first, so a person who isn't allowed to upload costs nothing to turn away.
  assertMayChange(actor, await findTarget(publicId), settings);

  const processed = await processImage(upload);

  const stored = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Target[]>`
      SELECT "id", "authorId", "approval"::text AS "approval" FROM "Suggestion" WHERE "publicId" = ${publicId} FOR NO KEY UPDATE`;
    const target = rows[0];
    if (!target) throw notFound("Suggestion not found.");
    // Checked again now that it is locked: it may have been approved while the picture was being processed.
    assertMayChange(actor, target, settings);

    const taken = new Set((await tx.suggestionImage.findMany({ where: { suggestionId: target.id }, select: { position: true } })).map((i) => i.position));
    const position = Array.from({ length: IMAGE_LIMITS.maxPerSuggestion }, (_, i) => i).find((p) => !taken.has(p));
    if (position === undefined) {
      throw conflict("too_many_images", `A suggestion can have up to ${IMAGE_LIMITS.maxPerSuggestion} images. Remove one to add another.`);
    }
    return tx.suggestionImage.create({
      data: { suggestionId: target.id, position, width: processed.width, height: processed.height, data: new Uint8Array(processed.data) },
      select: { id: true, width: true, height: true, position: true },
    });
  });

  await audit({
    action: "image.upload",
    actor,
    targetType: "suggestion",
    targetId: publicId,
    details: { bytes: processed.data.length, width: processed.width, height: processed.height },
    request,
  });
  scheduleBoardSync();
  return stored;
}

export async function deleteImage(actor: User, publicId: string, imageId: string, request?: Request): Promise<void> {
  const settings = await getSettings();
  const target = await findTarget(publicId);
  assertMayChange(actor, target, settings);

  const removed = await prisma.suggestionImage.deleteMany({ where: { id: imageId, suggestionId: target.id } });
  if (removed.count === 0) throw notFound("Image not found.");
  await audit({ action: "image.delete", actor, targetType: "suggestion", targetId: publicId, request });
  scheduleBoardSync();
}

// ── Serving ──────────────────────────────────────────────────────────

export interface ServedImage {
  data: Buffer;
  /** Pictures on approved suggestions are public; the rest are private to the author and owner. */
  isPublic: boolean;
}

/**
 * The picture, if this viewer may see it. A picture on a suggestion that
 * isn't approved is visible only to its author and the owner, and everyone
 * else gets exactly the answer for a picture that doesn't exist.
 */
export async function getImageFor(imageId: string, viewer: Pick<User, "id" | "isOwner"> | null): Promise<ServedImage | null> {
  const row = await prisma.suggestionImage.findUnique({
    where: { id: imageId },
    select: { data: true, suggestion: { select: { approval: true, authorId: true } } },
  });
  if (!row) return null;
  const isPublic = row.suggestion.approval === "APPROVED";
  if (!isPublic && !(viewer && (viewer.isOwner || viewer.id === row.suggestion.authorId))) return null;
  return { data: Buffer.from(row.data), isPublic };
}

// ── Retention ────────────────────────────────────────────────────────

export interface PurgeResult {
  suggestions: number;
  images: number;
}

/**
 * Deletes the pictures of suggestions that have sat in a status for as long as
 * that status allows (the owner sets "delete images after N days" per status;
 * "Completed" starts at 30). The clock is when the suggestion moved into its
 * current status, so moving it somewhere else and back starts it again.
 *
 * Each affected suggestion gets a line on its public history, so people can
 * see why the pictures are gone.
 */
export async function purgeExpiredImages(): Promise<PurgeResult> {
  const affected = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ suggestionId: string; n: number }[]>`
      WITH doomed AS (
        SELECT s."id" AS "suggestionId"
        FROM "Suggestion" s
        JOIN "Status" st ON st."id" = s."statusId"
        WHERE s."approval" = 'APPROVED'
          AND st."imageRetentionDays" IS NOT NULL
          AND s."statusChangedAt" IS NOT NULL
          AND s."statusChangedAt" <= (now() AT TIME ZONE 'UTC') - (st."imageRetentionDays" * interval '1 day')
          AND EXISTS (SELECT 1 FROM "SuggestionImage" i WHERE i."suggestionId" = s."id")
      ), removed AS (
        DELETE FROM "SuggestionImage" i USING doomed d WHERE i."suggestionId" = d."suggestionId" RETURNING i."suggestionId"
      )
      SELECT "suggestionId", count(*)::int AS n FROM removed GROUP BY "suggestionId"`;
    if (rows.length > 0) {
      await tx.timelineEvent.createMany({ data: rows.map((r) => ({ suggestionId: r.suggestionId, kind: "IMAGES_REMOVED" as const })) });
    }
    return rows;
  });

  const result = { suggestions: affected.length, images: affected.reduce((sum, r) => sum + r.n, 0) };
  if (result.suggestions > 0) {
    await audit({ action: "image.expire", actor: { id: "system", displayName: "System" }, details: { ...result } });
    scheduleBoardSync();
  }
  return result;
}
