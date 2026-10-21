import { prisma, type User } from "./db";
import { LIMITS } from "../shared/constants";
import { audit } from "./audit";
import { participationBlock } from "./eligibility";
import { conflict, forbidden, notFound } from "./errors";
import { getSettings } from "./settings";

/**
 * Comments exist only on suggestions where the owner has switched them on.
 * OPEN lets members comment; CLOSED keeps what was said but accepts nothing
 * new. Deleting leaves a "removed" placeholder rather than renumbering.
 */

export async function addComment(actor: User, publicId: string, body: string): Promise<{ id: string }> {
  const settings = await getSettings();
  const block = participationBlock(actor, settings);
  if (block) throw forbidden(block.message, block.code);

  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string; approval: string; commentsMode: string }[]>`
      SELECT "id", "approval"::text AS "approval", "commentsMode"::text AS "commentsMode"
      FROM "Suggestion" WHERE "publicId" = ${publicId} FOR NO KEY UPDATE`;
    const s = rows[0];
    if (!s || s.approval !== "APPROVED") throw notFound("Suggestion not found.");
    if (s.commentsMode === "OFF") throw conflict("comments_off", "Comments aren't enabled on this suggestion.");
    if (s.commentsMode === "CLOSED") throw conflict("comments_closed", "Comments are closed on this suggestion.");

    const comment = await tx.comment.create({ data: { suggestionId: s.id, authorId: actor.id, body } });
    await tx.suggestion.update({ where: { id: s.id }, data: { commentCount: { increment: 1 } } });
    return { id: comment.id };
  });
}

export async function editComment(actor: User, commentId: string, body: string, now = Date.now()): Promise<void> {
  const settings = await getSettings();
  const block = participationBlock(actor, settings, { tenure: false });
  if (block) throw forbidden(block.message, block.code);

  const comment = await prisma.comment.findUnique({ where: { id: commentId }, include: { suggestion: true } });
  if (!comment || comment.deletedAt || comment.authorId !== actor.id) throw notFound("Comment not found.");
  if (comment.suggestion.commentsMode !== "OPEN") throw conflict("comments_closed", "Comments are closed on this suggestion.");
  if (now - comment.createdAt.getTime() > LIMITS.commentEditWindowMs) {
    throw forbidden("Comments can only be edited for a few minutes after posting.", "edit_window_passed");
  }
  await prisma.comment.update({ where: { id: commentId }, data: { body, editedAt: new Date() } });
}

export async function deleteComment(actor: User, commentId: string, request?: Request): Promise<void> {
  const removedOthers = await prisma.$transaction(async (tx) => {
    const comment = await tx.comment.findUnique({ where: { id: commentId } });
    if (!comment) throw notFound("Comment not found.");
    const own = comment.authorId === actor.id;
    if (!own && !actor.isOwner) throw notFound("Comment not found.");
    if (comment.deletedAt) return false;

    await tx.$queryRaw`SELECT "id" FROM "Suggestion" WHERE "id" = ${comment.suggestionId} FOR NO KEY UPDATE`;
    await tx.comment.update({ where: { id: commentId }, data: { deletedAt: new Date(), deletedById: actor.id } });
    await tx.suggestion.update({ where: { id: comment.suggestionId }, data: { commentCount: { decrement: 1 } } });
    return !own;
  });
  if (removedOthers) {
    await audit({ action: "comment.delete", actor, targetType: "comment", targetId: commentId, request });
  }
}
