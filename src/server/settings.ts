import { prisma, type Settings } from "./db";

/** The single settings row. Created on first use if somehow missing. Always read fresh. */
export async function getSettings(): Promise<Settings> {
  const existing = await prisma.settings.findUnique({ where: { id: 1 } });
  if (existing) return existing;
  await prisma.$executeRaw`INSERT INTO "Settings" ("id", "updatedAt") VALUES (1, now()) ON CONFLICT ("id") DO NOTHING`;
  return prisma.settings.findUniqueOrThrow({ where: { id: 1 } });
}

/**
 * Creates the starter statuses, types and guidelines once. A `seededAt`
 * marker makes sure something the owner later deletes is not recreated on
 * the next boot.
 */
export async function ensureDefaults(): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`INSERT INTO "Settings" ("id", "updatedAt") VALUES (1, now()) ON CONFLICT ("id") DO NOTHING`;
    // Lock the row so two instances booting together seed only once.
    const rows = await tx.$queryRaw<{ seededAt: Date | null }[]>`SELECT "seededAt" FROM "Settings" WHERE "id" = 1 FOR UPDATE`;
    if (rows[0]?.seededAt) return;

    await tx.status.createMany({
      data: [
        { name: "Suggestions", slug: "suggestions", color: "purple", sortOrder: 0, isDefault: true, votingOpen: true },
        { name: "Planned", slug: "planned", color: "blue", sortOrder: 1, showOnRoadmap: true },
        { name: "In Progress", slug: "in-progress", color: "amber", sortOrder: 2, showOnRoadmap: true },
        {
          name: "Completed",
          slug: "completed",
          color: "green",
          sortOrder: 3,
          showOnRoadmap: true,
          closesCommentsOnEntry: true,
        },
        { name: "Declined", slug: "declined", color: "red", sortOrder: 4, closesCommentsOnEntry: true },
      ],
    });

    await tx.suggestionType.createMany({
      data: [
        {
          name: "Feature request",
          slug: "feature-request",
          description: "Something new that doesn't exist yet.",
          color: "purple",
          icon: "sparkle",
          sortOrder: 0,
        },
        {
          name: "Update request",
          slug: "update-request",
          description: "A change or improvement to something that already exists.",
          color: "blue",
          icon: "wrench",
          sortOrder: 1,
        },
      ],
    });

    await tx.guideline.createMany({
      data: [
        {
          title: "Search first",
          body: "Check the board before posting. If something similar already exists, vote for it instead of posting a duplicate.",
          sortOrder: 0,
        },
        {
          title: "One idea per suggestion",
          body: "Keep each suggestion to a single idea so people can vote on it clearly.",
          sortOrder: 1,
        },
        {
          title: "Be specific",
          body: "Say what you'd like to happen and why it would help. Short and clear beats long and vague.",
          sortOrder: 2,
        },
        {
          title: "Keep it constructive",
          body: "No insults, complaints about individuals or requests for special treatment. Anything that breaks the server rules may be removed.",
          sortOrder: 3,
        },
      ],
    });

    await tx.settings.update({ where: { id: 1 }, data: { seededAt: new Date() } });
  });
}
