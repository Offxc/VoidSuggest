import { z } from "zod";
import { COLOR_KEYS, ICON_KEYS, LIMITS } from "./constants";
import { cleanBlock, cleanLine } from "./text";

/**
 * Request body schemas. Used by the API routes, and by forms in the browser
 * to give the same limits instant feedback. The server never trusts the
 * browser's validation; these run again there.
 */

const id = z.string().min(1).max(64);
const line = (min: number, max: number) =>
  z
    .string()
    .transform(cleanLine)
    .pipe(z.string().min(min, `At least ${min} characters`).max(max, `At most ${max} characters`));
const block = (min: number, max: number) =>
  z
    .string()
    .transform(cleanBlock)
    .pipe(z.string().min(min, `At least ${min} characters`).max(max, `At most ${max} characters`));

export const colorSchema = z.enum(COLOR_KEYS);
export const iconSchema = z.enum(ICON_KEYS);

// ── Suggestions ──────────────────────────────────────────────────────

export const createSuggestionSchema = z.object({
  title: line(LIMITS.titleMin, LIMITS.titleMax),
  body: block(LIMITS.bodyMin, LIMITS.bodyMax),
  typeId: id.nullable().optional(),
  tagIds: z.array(id).max(20).default([]),
  acknowledgeGuidelines: z.boolean().optional(),
});

export const editSuggestionSchema = z
  .object({
    title: line(LIMITS.titleMin, LIMITS.titleMax),
    body: block(LIMITS.bodyMin, LIMITS.bodyMax),
    typeId: id.nullable(),
    tagIds: z.array(id).max(20),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to change");

export const rejectSchema = z.object({
  reason: block(0, LIMITS.rejectionReasonMax).optional(),
});

export const moveStatusSchema = z.object({ statusId: id });

export const commentsModeSchema = z.object({ mode: z.enum(["OFF", "OPEN", "CLOSED"]) });

export const commentSchema = z.object({ body: block(1, LIMITS.commentMax) });

// ── Settings ─────────────────────────────────────────────────────────

const optionalUrl = (hosts?: string[]) =>
  z
    .string()
    .trim()
    .max(200)
    .refine((v) => {
      if (v === "") return true;
      try {
        const u = new URL(v);
        if (u.protocol !== "https:") return false;
        return hosts ? hosts.includes(u.hostname) : true;
      } catch {
        return false;
      }
    }, "Must be an https:// link");

export const settingsSchema = z
  .object({
    siteName: line(1, LIMITS.siteNameMax),
    introText: block(0, LIMITS.introMax),
    accentColor: colorSchema,
    discordInviteUrl: optionalUrl(["discord.gg", "discord.com", "www.discord.com"]),
    memberRoleId: z.string().regex(/^\d{5,25}$/, "Pick a role").nullable(),
    voteSlots: z.number().int().min(1).max(50).nullable(),
    minDaysInServer: z.number().int().min(0).max(365),
    submissionsOpen: z.boolean(),
    maxPendingPerUser: z.number().int().min(1).max(50),
    maxSubmissionsPerDay: z.number().int().min(1).max(100),
    maxTagsPerSuggestion: z.number().int().min(0).max(10),
    requireGuidelinesAck: z.boolean(),
    defaultCommentsMode: z.enum(["OFF", "OPEN"]),
    removeVotesOnLeave: z.boolean(),
    notifyPending: z.boolean(),
    notifyStatusChange: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "Nothing to change");

export const webhookSchema = z.object({
  url: z.string().trim().max(300),
});

// ── Statuses, types, tags, guidelines ────────────────────────────────

export const statusSchema = z.object({
  name: line(1, LIMITS.statusNameMax),
  color: colorSchema,
  votingOpen: z.boolean(),
  closesCommentsOnEntry: z.boolean(),
  showOnRoadmap: z.boolean(),
  isDefault: z.boolean().optional(),
});

export const typeSchema = z.object({
  name: line(1, LIMITS.typeNameMax),
  description: block(0, LIMITS.typeDescriptionMax),
  color: colorSchema,
  icon: iconSchema,
  enabled: z.boolean(),
});

export const tagSchema = z.object({
  name: line(1, LIMITS.tagNameMax),
  color: colorSchema,
});

export const guidelineSchema = z.object({
  title: line(1, LIMITS.guidelineTitleMax),
  body: block(1, LIMITS.guidelineBodyMax),
  appliesToAll: z.boolean(),
  typeIds: z.array(id).max(LIMITS.maxTypes).default([]),
});

export const reorderSchema = z.object({ ids: z.array(id).min(1).max(100) });

// ── Users ────────────────────────────────────────────────────────────

export const blockUserSchema = z.object({
  reason: block(0, LIMITS.blockReasonMax).optional(),
});

// ── Board query ──────────────────────────────────────────────────────

export const boardQuerySchema = z.object({
  status: z.string().max(48).optional(),
  tag: z.string().max(40).optional(),
  type: z.string().max(48).optional(),
  q: z
    .string()
    .max(LIMITS.searchMax)
    .optional()
    .transform((v) => (v ? cleanLine(v) : undefined)),
  sort: z.enum(["top", "new"]).default("top"),
  page: z.coerce.number().int().min(1).max(500).default(1),
});

export type BoardQuery = z.infer<typeof boardQuerySchema>;
