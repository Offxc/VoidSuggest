import { Prisma, prisma, type User } from "./db";
import { DiscordError, fetchGuildMember, fetchUserProfile } from "./discord";
import { getEnv } from "./env";
import { holdsMemberRole, identityColumns } from "./identity";
import { getSettings } from "./settings";
import { removeVotesForUser } from "./votes";

/**
 * Decides whether a Discord account may sign in, and records the sign-in.
 *
 * Who gets in:
 *  - the owner, always;
 *  - the very first account on a fresh install, which becomes the owner
 *    (unless OWNER_DISCORD_ID is set, in which case only that account can);
 *  - anyone holding the configured Member role in the Discord server.
 * Everyone else is refused before any session or user record is created.
 */

export type SignInResult =
  | { ok: true; user: User; claimedOwnership: boolean }
  | { ok: false; reason: "not_member" | "blocked" };

export async function signInWithDiscordId(discordId: string): Promise<SignInResult> {
  const env = getEnv();
  const settings = await getSettings();
  const member = await fetchGuildMember(discordId);
  const isMember = holdsMemberRole(member, settings);
  // Fetched up front, outside the transaction: only used for an owner who
  // isn't in the server, where there is no member record to read a name from.
  const fallbackProfile = member ? null : await fetchUserProfile(discordId).catch(() => null);

  // Two attempts: if two first-ever sign-ins race for ownership, the loser
  // trips the one-owner database index and tries again as an ordinary user.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await prisma.$transaction(async (tx): Promise<SignInResult> => {
        const existing = await tx.user.findUnique({ where: { discordId } });
        if (existing?.blockedAt) return { ok: false, reason: "blocked" };

        const ownerExists = existing?.isOwner ? true : (await tx.user.count({ where: { isOwner: true } })) > 0;
        const mayClaim = attempt === 0 && !ownerExists && (!env.OWNER_DISCORD_ID || env.OWNER_DISCORD_ID === discordId);
        const isOwner = Boolean(existing?.isOwner) || mayClaim;

        if (!isOwner && !isMember) {
          // Someone who used to be a member and no longer is: record that, and
          // withdraw their votes if the owner wants that.
          if (existing) {
            const wasMember = existing.isMember;
            await tx.user.update({
              where: { id: existing.id },
              data: { isMember: false, lastSyncedAt: new Date() },
            });
            if (wasMember && settings.removeVotesOnLeave) await removeVotesForUser(tx, existing.id, { onlyOpen: true });
          }
          return { ok: false, reason: "not_member" };
        }

        const identity = member ?? fallbackProfile;
        if (!identity) throw new DiscordError("Could not read your Discord account", 502);
        const columns = identityColumns(identity, settings);

        if (existing) {
          const user = await tx.user.update({
            where: { id: existing.id },
            data: { ...columns, lastLoginAt: new Date() },
          });
          return { ok: true, user, claimedOwnership: false };
        }
        const user = await tx.user.create({
          data: { discordId, ...columns, isOwner: mayClaim, lastLoginAt: new Date() },
        });
        return { ok: true, user, claimedOwnership: mayClaim };
      });
    } catch (err) {
      const raced = err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
      if (!raced || attempt === 1) throw err;
    }
  }
  throw new Error("unreachable");
}
