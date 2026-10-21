import type { Settings, User } from "./db";

/**
 * Who may take part (submit, vote, comment). Anyone can read; this is only
 * about writing. The owner is always allowed.
 */
export interface Block {
  code: "blocked" | "not_configured" | "not_member" | "too_new";
  message: string;
}

export function participationBlock(
  user: Pick<User, "blockedAt" | "isOwner" | "isMember" | "joinedGuildAt">,
  settings: Pick<Settings, "memberRoleId" | "minDaysInServer">,
  options: { tenure?: boolean } = {},
  now = Date.now(),
): Block | null {
  if (user.blockedAt) {
    return { code: "blocked", message: "Your account is not able to take part." };
  }
  if (user.isOwner) return null;
  if (!settings.memberRoleId) {
    return { code: "not_configured", message: "This site hasn't finished being set up yet." };
  }
  if (!user.isMember) {
    return { code: "not_member", message: "You need the Member role in the Discord server to do this." };
  }
  if ((options.tenure ?? true) && settings.minDaysInServer > 0) {
    const joined = user.joinedGuildAt;
    const days = joined ? (now - joined.getTime()) / 86_400_000 : 0;
    if (!joined || days < settings.minDaysInServer) {
      const left = Math.max(1, Math.ceil(settings.minDaysInServer - days));
      return {
        code: "too_new",
        message: `You can take part after ${left} more day${left === 1 ? "" : "s"} in the server.`,
      };
    }
  }
  return null;
}
