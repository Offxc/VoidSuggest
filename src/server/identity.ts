import { prisma, type Settings, type User } from "./db";
import { IDENTITY_FRESH_MS } from "../shared/constants";
import { DiscordError, fetchGuildMember, listGuildMembers, type GuildMember } from "./discord";
import { unavailable } from "./errors";
import { getSettings } from "./settings";
import { removeVotesForUser } from "./votes";

/**
 * Keeps each person's Discord details (server nickname, avatar, whether they
 * hold the Member role) in step with Discord:
 *  - at sign-in,
 *  - before any write, if the stored copy is older than a few minutes,
 *  - and by a background sweep over the whole server, so names shown next to
 *    old comments from people who haven't visited lately stay current.
 */

export function holdsMemberRole(member: Pick<GuildMember, "roles"> | null, settings: Pick<Settings, "memberRoleId">): boolean {
  return Boolean(member && settings.memberRoleId && member.roles.includes(settings.memberRoleId));
}

/** Columns that mirror Discord, ready to write. */
export function identityColumns(member: GuildMember, settings: Pick<Settings, "memberRoleId">) {
  return {
    username: member.username,
    globalName: member.globalName,
    nick: member.nick,
    displayName: member.displayName,
    avatarHash: member.avatarHash,
    guildAvatarHash: member.guildAvatarHash,
    joinedGuildAt: member.joinedAt,
    leftGuildAt: null,
    isMember: holdsMemberRole(member, settings),
    lastSyncedAt: new Date(),
  };
}

/**
 * Applies what Discord says about someone (or that they're gone, for `null`).
 * If they have just stopped being a member, their votes on open suggestions
 * are withdrawn when the owner has that switched on.
 */
export async function applyMembership(userId: string, member: GuildMember | null): Promise<User> {
  const settings = await getSettings();
  return prisma.$transaction(async (tx) => {
    const before = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    const data = member
      ? identityColumns(member, settings)
      : { isMember: false, leftGuildAt: before.leftGuildAt ?? new Date(), lastSyncedAt: new Date() };
    const after = await tx.user.update({ where: { id: userId }, data });
    if (before.isMember && !after.isMember && settings.removeVotesOnLeave) {
      await removeVotesForUser(tx, userId, { onlyOpen: true });
    }
    return after;
  });
}

/**
 * Brings a user's stored Discord details up to date if they are stale. Writes
 * fail closed: when Discord can't be asked, someone who might have lost the
 * Member role is not let through on old information.
 */
export async function ensureFresh(user: User, now = Date.now()): Promise<User> {
  const age = user.lastSyncedAt ? now - user.lastSyncedAt.getTime() : Infinity;
  if (age < IDENTITY_FRESH_MS) return user;
  try {
    return await applyMembership(user.id, await fetchGuildMember(user.discordId));
  } catch (err) {
    if (user.isOwner) return user; // The owner never depends on the Member role.
    if (err instanceof DiscordError) throw unavailable();
    throw err;
  }
}

let sweeping = false;

export interface SweepResult {
  checked: number;
  updated: number;
  left: number;
}

/**
 * Refreshes every known person from the full server member list. If listing
 * fails part-way nobody is marked as having left, since a missing page would
 * look the same as a missing person.
 */
export async function sweepMembers(): Promise<SweepResult | null> {
  if (sweeping) return null;
  sweeping = true;
  try {
    const settings = await getSettings();
    const known = new Map((await prisma.user.findMany()).map((u) => [u.discordId, u]));
    const seen = new Set<string>();
    let updated = 0;

    for await (const page of listGuildMembers()) {
      const unchanged: string[] = [];
      for (const member of page) {
        const user = known.get(member.discordId);
        if (!user) continue;
        seen.add(member.discordId);

        const next = identityColumns(member, settings);
        const changed =
          user.displayName !== next.displayName ||
          user.nick !== next.nick ||
          user.globalName !== next.globalName ||
          user.username !== next.username ||
          user.avatarHash !== next.avatarHash ||
          user.guildAvatarHash !== next.guildAvatarHash ||
          user.isMember !== next.isMember ||
          user.leftGuildAt !== null ||
          user.joinedGuildAt?.getTime() !== next.joinedGuildAt?.getTime();

        if (changed) {
          await applyMembership(user.id, member);
          updated++;
        } else {
          unchanged.push(user.id);
        }
      }
      if (unchanged.length > 0) {
        await prisma.user.updateMany({ where: { id: { in: unchanged } }, data: { lastSyncedAt: new Date() } });
      }
    }

    let left = 0;
    for (const user of known.values()) {
      if (seen.has(user.discordId) || user.isOwner || (user.leftGuildAt && !user.isMember)) continue;
      await applyMembership(user.id, null);
      left++;
    }
    return { checked: seen.size, updated, left };
  } finally {
    sweeping = false;
  }
}
