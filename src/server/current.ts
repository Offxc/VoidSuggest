import { cache } from "react";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { ViewerDto } from "@/shared/types";
import type { User } from "./db";
import { avatarUrl } from "./discord";
import { participationBlock } from "./eligibility";
import { unreadCount } from "./notices";
import { sessionCookieName, userFromToken } from "./session";
import { getSettings } from "./settings";
import { getVoteBudget } from "./votes";

/** The signed-in user for this request, if any. Used by pages; API routes read the cookie themselves. */
export const getUser = cache(async (): Promise<User | null> => {
  const jar = await cookies();
  return userFromToken(jar.get(sessionCookieName())?.value);
});

/** What the header and board need to know about the person looking at the page. */
export const getViewer = cache(async (): Promise<ViewerDto | null> => {
  const user = await getUser();
  if (!user) return null;
  const settings = await getSettings();
  const block = participationBlock(user, settings);
  const [unread, budget] = await Promise.all([unreadCount(user.id), block ? null : getVoteBudget(user.id)]);
  return {
    id: user.id,
    name: user.displayName,
    avatarUrl: avatarUrl(user),
    isOwner: user.isOwner,
    participationMessage: block?.message ?? null,
    unreadNotices: unread,
    budget,
  };
});

export function loginUrl(returnTo: string): string {
  return `/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`;
}

/** Pages that need someone signed in. */
export async function requireUser(returnTo: string): Promise<User> {
  const user = await getUser();
  if (!user) redirect(loginUrl(returnTo));
  return user;
}

/** Owner-only pages. Everyone else sees an ordinary "not found", so the admin area doesn't advertise itself. */
export async function requireOwner(returnTo: string): Promise<User> {
  const user = await requireUser(returnTo);
  if (!user.isOwner) notFound();
  return user;
}
