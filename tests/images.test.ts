import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DELETE as removeImage } from "@/app/api/suggestions/[id]/images/[imageId]/route";
import { POST as upload } from "@/app/api/suggestions/[id]/images/route";
import { GET as serve } from "@/app/api/images/[id]/route";
import { configureBoardForTests, syncBoard } from "@/server/board";
import { prisma } from "@/server/db";
import { addImage, deleteImage, getImageFor, processImage, purgeExpiredImages } from "@/server/images";
import { resetRateLimitsForTests } from "@/server/rate-limit";
import { getSuggestion } from "@/server/queries";
import { moveSuggestion } from "@/server/suggestions";
import { statusSchema } from "@/shared/schemas";
import { call, configureSite, makeApproved, makePending, makeUser, resetDb, statusBySlug } from "./helpers/db";
import { animatedWebp, gif, html, jpeg, photoWithMetadata, pixelBomb, png, polyglot, svg, webp } from "./helpers/images";
import { MockDiscord } from "./helpers/mock-discord";

/**
 * Pictures on suggestions. The point of most of these is what must NOT
 * happen: a hostile file being stored or served, a picture reaching someone
 * who shouldn't see it, or a picture outliving the time the owner set.
 */

const discord = new MockDiscord();
const CHANNEL = "900000000000000001";

beforeAll(async () => {
  await discord.start();
  configureBoardForTests({ timers: false, pauseMs: 0 });
});
afterAll(async () => {
  await discord.stop();
});
beforeEach(async () => {
  await resetDb();
  await configureSite();
  resetRateLimitsForTests();
  discord.messages.clear();
  discord.channels.clear();
  discord.addChannel(CHANNEL);
});

const sendImage = (user: Awaited<ReturnType<typeof makeUser>> | null, publicId: string, raw: Buffer, contentType = "image/png") =>
  call(upload, { method: "POST", path: `/api/suggestions/${publicId}/images`, params: { id: publicId }, raw, contentType, user });

const fetchImage = (id: string, user: Awaited<ReturnType<typeof makeUser>> | null = null, headers: Record<string, string> = {}) =>
  call(serve, { path: `/api/images/${id}.webp`, params: { id: `${id}.webp` }, user, headers });

const isWebp = (b: Buffer) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP";

describe("turning an upload into a stored picture", () => {
  it("accepts PNG, JPEG and WebP, and always stores a fresh WebP", async () => {
    for (const file of [await png(), await jpeg(), await webp()]) {
      const out = await processImage(file);
      expect(isWebp(out.data)).toBe(true);
      expect(out).toMatchObject({ width: 64, height: 48 });
    }
  });

  it("scales big pictures down to fit, and never up", async () => {
    const big = await processImage(await sharp({ create: { width: 3200, height: 2000, channels: 3, background: "#123456" } }).png().toBuffer());
    expect(big).toMatchObject({ width: 1600, height: 1000 });
    const small = await processImage(await png(20, 10));
    expect(small).toMatchObject({ width: 20, height: 10 });
  });

  it("removes the name and place a photo carries, and applies its rotation first", async () => {
    const photo = await photoWithMetadata();
    expect(photo.toString("latin1")).toContain("secret-owner-name");

    const out = await processImage(photo);

    expect(out.data.toString("latin1")).not.toContain("secret-owner-name");
    expect(out.data.toString("latin1")).not.toContain("Private Road");
    const meta = await sharp(out.data).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.icc).toBeUndefined();
    // It was 200 wide and 100 tall, flagged "rotate a quarter turn", so it is stored upright: 100 by 200.
    expect(out).toMatchObject({ width: 100, height: 200 });
  });

  it("throws away anything glued onto an image, so a picture can't also be a script", async () => {
    const dressed = await polyglot();
    expect(dressed.toString("latin1")).toContain("<script>");

    const out = await processImage(dressed);

    expect(isWebp(out.data)).toBe(true);
    const text = out.data.toString("latin1");
    expect(text).not.toContain("<script");
    expect(text).not.toContain("<?php");
  });

  it.each([
    ["an HTML page", html],
    ["an SVG, which can carry script", svg],
    ["a GIF", gif],
    ["nothing at all", () => Buffer.alloc(0)],
    ["random bytes", () => Buffer.from(Array.from({ length: 500 }, (_, i) => (i * 37 + 11) % 256))],
  ])("refuses %s", async (_name, make) => {
    await expect(processImage(make())).rejects.toMatchObject({ status: 400 });
  });

  it("refuses a file that starts like an image but isn't one", async () => {
    const lie = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("this is not really a png at all")]);
    await expect(processImage(lie)).rejects.toMatchObject({ code: "image_invalid" });
    const cut = (await jpeg()).subarray(0, 40);
    await expect(processImage(cut)).rejects.toMatchObject({ status: 400 });
  });

  it("refuses an animated image rather than quietly keeping one frame", async () => {
    await expect(processImage(await animatedWebp())).rejects.toMatchObject({ code: "image_animated" });
  });

  it.each([
    ["144 million pixels, over our limit but under the library's own", pixelBomb(12_000, 12_000)],
    ["1.6 billion pixels", pixelBomb(40_000, 40_000)],
  ])("refuses a tiny file that claims %s, without decoding it", async (_name, bomb) => {
    expect(bomb.length).toBeLessThan(2_000);
    const started = Date.now();
    // Turned away because of what it claims to be, before any decoding starts.
    await expect(processImage(bomb)).rejects.toMatchObject({ status: 400, code: "image_too_large" });
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("refuses an upload over the size limit", async () => {
    const huge = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8 * 1024 * 1024)]);
    await expect(processImage(huge)).rejects.toMatchObject({ code: "image_too_large" });
  });
});

describe("uploading", () => {
  it("lets an author add pictures to their own waiting suggestion, up to four", async () => {
    const author = await makeUser();
    const s = await makePending(author);

    const first = await sendImage(author, s.publicId, await png());
    expect(first.status).toBe(200);
    expect(first.json).toMatchObject({ width: 64, height: 48, position: 0 });
    for (let i = 1; i < 4; i++) expect((await sendImage(author, s.publicId, await png())).status).toBe(200);

    const fifth = await sendImage(author, s.publicId, await png());
    expect(fifth.status).toBe(409);
    expect(fifth.json.error.code).toBe("too_many_images");
    expect(await prisma.suggestionImage.count({ where: { suggestionId: s.id } })).toBe(4);
  });

  it("stores only what the server made, never the file that was sent", async () => {
    const author = await makeUser();
    const s = await makePending(author);
    await sendImage(author, s.publicId, await polyglot(), "image/jpeg");
    const row = await prisma.suggestionImage.findFirstOrThrow({ where: { suggestionId: s.id } });
    expect(isWebp(Buffer.from(row.data))).toBe(true);
    expect(Buffer.from(row.data).toString("latin1")).not.toContain("<script");
  });

  it("never stores more than four when many arrive at once", async () => {
    const author = await makeUser();
    const s = await makePending(author);
    const file = await png();
    const results = await Promise.all(Array.from({ length: 8 }, () => sendImage(author, s.publicId, file)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(4);
    expect(results.filter((r) => r.status === 409)).toHaveLength(4);
    expect(await prisma.suggestionImage.count({ where: { suggestionId: s.id } })).toBe(4);
  });

  it("reuses a freed place", async () => {
    const author = await makeUser();
    const s = await makePending(author);
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) ids.push((await sendImage(author, s.publicId, await png())).json.id);
    await call(removeImage, { method: "DELETE", params: { id: s.publicId, imageId: ids[1]! }, user: author });
    const again = await sendImage(author, s.publicId, await png());
    expect(again.status).toBe(200);
    expect(again.json.position).toBe(1);
  });

  it("only accepts the three image types, by label, and checks the contents regardless of the label", async () => {
    const author = await makeUser();
    const s = await makePending(author);
    for (const type of ["image/gif", "image/svg+xml", "text/html", "application/json", "application/octet-stream", ""]) {
      const res = await sendImage(author, s.publicId, await png(), type);
      expect(res.status, type).toBe(415);
    }
    // Labelled as a PNG, but it is a web page.
    const lie = await sendImage(author, s.publicId, html(), "image/png");
    expect(lie.status).toBe(400);
    expect(await prisma.suggestionImage.count()).toBe(0);
  });

  it("stops an oversized upload while it streams in", async () => {
    const author = await makeUser();
    const s = await makePending(author);
    const res = await sendImage(author, s.publicId, Buffer.alloc(9 * 1024 * 1024, 1));
    expect(res.status).toBe(413);
  });

  it("limits how many a person can upload in an hour", async () => {
    const author = await makeUser();
    const s = await makePending(author);
    const tiny = await png(2, 2);
    const statuses: number[] = [];
    for (let i = 0; i < 26; i++) statuses.push((await sendImage(author, s.publicId, tiny)).status);
    expect(statuses.slice(0, 24).every((x) => x === 200 || x === 409)).toBe(true);
    expect(statuses.slice(24)).toEqual([429, 429]);
  });

  it("records each upload in the audit log, without the picture", async () => {
    const author = await makeUser({ name: "Uploader" });
    const s = await makePending(author);
    await sendImage(author, s.publicId, await png());
    const row = await prisma.auditLog.findFirstOrThrow({ where: { action: "image.upload" } });
    expect(row).toMatchObject({ actorName: "Uploader", targetId: s.publicId });
    expect(JSON.stringify(row.details)).not.toMatch(/RIFF/);
  });
});

describe("who may add and remove pictures", () => {
  it("turns away signed-out visitors, people without the Member role, and blocked people", async () => {
    const author = await makeUser();
    const s = await makePending(author);
    expect((await sendImage(null, s.publicId, await png())).status).toBe(401);
    expect((await sendImage(await makeUser({ member: false }), s.publicId, await png())).status).toBe(403);
    expect((await sendImage(await makeUser({ blocked: true }), s.publicId, await png())).status).toBe(401);
  });

  it("treats somebody else's waiting suggestion as not existing", async () => {
    const s = await makePending(await makeUser());
    const res = await sendImage(await makeUser(), s.publicId, await png());
    expect(res.status).toBe(404);
    expect(await prisma.suggestionImage.count()).toBe(0);
  });

  it("locks an approved suggestion's pictures to the owner, even for its author", async () => {
    const author = await makeUser();
    const owner = await makeUser({ owner: true });
    const s = await makeApproved(author);

    expect((await sendImage(author, s.publicId, await png())).status).toBe(403);
    expect((await sendImage(await makeUser(), s.publicId, await png())).status).toBe(403);
    expect((await sendImage(owner, s.publicId, await png())).status).toBe(200);
  });

  it("stops an author changing pictures once the suggestion is rejected", async () => {
    const author = await makeUser();
    const s = await makePending(author);
    await sendImage(author, s.publicId, await png());
    await prisma.suggestion.update({ where: { id: s.id }, data: { approval: "REJECTED" } });
    expect((await sendImage(author, s.publicId, await png())).status).toBe(403);
  });

  it("removes only the picture asked for, and only from the right suggestion", async () => {
    const author = await makeUser();
    const other = await makeUser();
    const mine = await makePending(author);
    const theirs = await makePending(other);
    const myImage = (await sendImage(author, mine.publicId, await png())).json.id as string;
    const theirImage = (await sendImage(other, theirs.publicId, await png())).json.id as string;

    const wrongHome = await call(removeImage, { method: "DELETE", params: { id: mine.publicId, imageId: theirImage }, user: author });
    expect(wrongHome.status).toBe(404);
    const notMine = await call(removeImage, { method: "DELETE", params: { id: theirs.publicId, imageId: theirImage }, user: author });
    expect(notMine.status).toBe(404);
    expect(await prisma.suggestionImage.count()).toBe(2);

    const ok = await call(removeImage, { method: "DELETE", params: { id: mine.publicId, imageId: myImage }, user: author });
    expect(ok.status).toBe(200);
    expect(await prisma.suggestionImage.count()).toBe(1);
    expect((await call(removeImage, { method: "DELETE", params: { id: mine.publicId, imageId: myImage }, user: author })).status).toBe(404);
  });

  it("lets the owner remove a picture from any suggestion, but not an author from an approved one", async () => {
    const author = await makeUser();
    const owner = await makeUser({ owner: true });
    const s = await makeApproved(author);
    const id = (await sendImage(owner, s.publicId, await png())).json.id as string;

    expect((await call(removeImage, { method: "DELETE", params: { id: s.publicId, imageId: id }, user: author })).status).toBe(403);
    expect((await call(removeImage, { method: "DELETE", params: { id: s.publicId, imageId: id }, user: owner })).status).toBe(200);
  });

  it("applies the same rules inside the domain functions, not just the routes", async () => {
    const author = await makeUser();
    const s = await makeApproved(author);
    await expect(addImage(author, s.publicId, await png())).rejects.toMatchObject({ status: 403 });
    await expect(deleteImage(await makeUser(), s.publicId, "abcdefghijklmnopqrstuvwxy")).rejects.toMatchObject({ status: 403 });
  });
});

describe("serving pictures", () => {
  it("serves a public picture as a WebP with the headers that keep it an image", async () => {
    const owner = await makeUser({ owner: true });
    const s = await makeApproved(await makeUser());
    const id = (await sendImage(owner, s.publicId, await jpeg(), "image/jpeg")).json.id as string;

    const res = await fetchImage(id);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-disposition")).toMatch(/^inline;/);
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(isWebp(res.bytes)).toBe(true);

    const etag = res.headers.get("etag")!;
    const again = await fetchImage(id, null, { "if-none-match": etag });
    expect(again.status).toBe(304);
    expect(again.bytes.length).toBe(0);
  });

  it("keeps a waiting suggestion's pictures to its author and the owner", async () => {
    const author = await makeUser();
    const owner = await makeUser({ owner: true });
    const s = await makePending(author);
    const id = (await sendImage(author, s.publicId, await png())).json.id as string;

    expect((await fetchImage(id)).status).toBe(404);
    expect((await fetchImage(id, await makeUser())).status).toBe(404);
    const mine = await fetchImage(id, author);
    expect(mine.status).toBe(200);
    expect(mine.headers.get("cache-control")).toBe("private, no-store");
    expect((await fetchImage(id, owner)).status).toBe(200);
  });

  it("does not let a cache keep a waiting suggestion's picture, nor answer 304 for it", async () => {
    const author = await makeUser();
    const s = await makePending(author);
    const id = (await sendImage(author, s.publicId, await png())).json.id as string;
    const first = await fetchImage(id, author);
    const second = await fetchImage(id, author, { "if-none-match": first.headers.get("etag")! });
    expect(second.status).toBe(200);
  });

  it("answers the same for a made-up id and a malformed one", async () => {
    for (const bad of ["abc.webp", "ABCDEFGHIJKLMNOPQRSTUVWXY.webp", "../../etc/passwd.webp", "abcdefghijklmnopqrstuvwxy", "abcdefghijklmnopqrstuvwxy.png", "abcdefghijklmnopqrstuvwxy.webp/x"]) {
      const res = await call(serve, { path: "/api/images/x", params: { id: bad } });
      expect(res.status, bad).toBe(404);
    }
    expect((await fetchImage("abcdefghijklmnopqrstuvwxy")).status).toBe(404);
  });

  it("stops serving a picture when its suggestion is deleted", async () => {
    const owner = await makeUser({ owner: true });
    const s = await makeApproved(await makeUser());
    const id = (await sendImage(owner, s.publicId, await png())).json.id as string;
    expect((await fetchImage(id)).status).toBe(200);
    await prisma.suggestion.delete({ where: { id: s.id } });
    expect((await fetchImage(id)).status).toBe(404);
    expect(await prisma.suggestionImage.count()).toBe(0);
  });

  it("is available to the domain layer under the same rule", async () => {
    const author = await makeUser();
    const s = await makePending(author);
    const id = (await sendImage(author, s.publicId, await png())).json.id as string;
    expect(await getImageFor(id, null)).toBeNull();
    expect((await getImageFor(id, author))?.isPublic).toBe(false);
  });
});

describe("what pages and lists learn about pictures", () => {
  it("gives the detail page each picture's address and size, never its bytes", async () => {
    const owner = await makeUser({ owner: true });
    const s = await makeApproved(await makeUser());
    const id = (await sendImage(owner, s.publicId, await png(80, 40))).json.id as string;

    const detail = await getSuggestion(null, s.publicId);

    expect(detail?.images).toEqual([{ id, url: `/api/images/${id}.webp`, width: 80, height: 40 }]);
    expect(detail?.imageCount).toBe(1);
    expect(JSON.stringify(detail)).not.toContain("RIFF");
  });

  it("does not reveal a waiting suggestion, or its pictures, to the public", async () => {
    const author = await makeUser();
    const s = await makePending(author);
    await sendImage(author, s.publicId, await png());
    expect(await getSuggestion(null, s.publicId)).toBeNull();
    expect((await getSuggestion(author, s.publicId))?.images).toHaveLength(1);
  });
});

describe("deleting pictures after a while", () => {
  const ago = (days: number) => new Date(Date.now() - days * 86_400_000);
  let theOwner: Awaited<ReturnType<typeof makeUser>> | null = null;
  beforeEach(() => {
    theOwner = null;
  });
  const ownerOnce = async () => (theOwner ??= await makeUser({ owner: true }));
  const inCompleted = async (days: number, title = "Something that got finished") => {
    const owner = await ownerOnce();
    const s = await makeApproved(await makeUser(), title, "completed");
    await prisma.suggestion.update({ where: { id: s.id }, data: { statusChangedAt: ago(days) } });
    await addImage(owner, s.publicId, await png());
    await addImage(owner, s.publicId, await png());
    return s;
  };
  const count = (id: string) => prisma.suggestionImage.count({ where: { suggestionId: id } });

  it("starts at 30 days on Completed", async () => {
    expect((await statusBySlug("completed")).imageRetentionDays).toBe(30);
    expect((await statusBySlug("planned")).imageRetentionDays).toBeNull();
  });

  it("deletes the pictures once a suggestion has been Completed for 30 days, and not before", async () => {
    const old = await inCompleted(31, "Finished more than a month ago");
    const recent = await inCompleted(29, "Finished less than a month ago");

    const result = await purgeExpiredImages();

    expect(result).toEqual({ suggestions: 1, images: 2 });
    expect(await count(old.id)).toBe(0);
    expect(await count(recent.id)).toBe(2);
  });

  it("explains it on the suggestion's public history and in the audit log", async () => {
    const s = await inCompleted(40);
    await purgeExpiredImages();
    const events = await prisma.timelineEvent.findMany({ where: { suggestionId: s.id, kind: "IMAGES_REMOVED" } });
    expect(events).toHaveLength(1);
    expect(await prisma.auditLog.findFirst({ where: { action: "image.expire" } })).toMatchObject({ actorName: "System" });
  });

  it("is safe to run again, and does nothing to suggestions that have no pictures", async () => {
    const s = await inCompleted(40);
    const bare = await makeApproved(await makeUser(), "Finished but never had a picture", "completed");
    await prisma.suggestion.update({ where: { id: bare.id }, data: { statusChangedAt: ago(90) } });
    await purgeExpiredImages();
    expect(await purgeExpiredImages()).toEqual({ suggestions: 0, images: 0 });
    expect(await prisma.timelineEvent.count({ where: { suggestionId: s.id, kind: "IMAGES_REMOVED" } })).toBe(1);
    expect(await prisma.timelineEvent.count({ where: { suggestionId: bare.id, kind: "IMAGES_REMOVED" } })).toBe(0);
  });

  it("leaves pictures alone in statuses with no rule, however long they sit there", async () => {
    const owner = await makeUser({ owner: true });
    const s = await makeApproved(await makeUser(), "Planned for a very long time", "planned");
    await prisma.suggestion.update({ where: { id: s.id }, data: { statusChangedAt: ago(500) } });
    await addImage(owner, s.publicId, await png());
    expect(await purgeExpiredImages()).toEqual({ suggestions: 0, images: 0 });
    expect(await count(s.id)).toBe(1);
  });

  it("keeps them if the suggestion moved out of Completed, and starts the clock again if it comes back", async () => {
    const owner = await ownerOnce();
    const s = await inCompleted(40, "Completed, then reopened by mistake");

    await moveSuggestion(owner, s.publicId, (await statusBySlug("in-progress")).id);
    expect(await purgeExpiredImages()).toEqual({ suggestions: 0, images: 0 });

    await moveSuggestion(owner, s.publicId, (await statusBySlug("completed")).id);
    expect(await purgeExpiredImages()).toEqual({ suggestions: 0, images: 0 });
    expect(await count(s.id)).toBe(2);
  });

  it("follows the number the owner sets on any status", async () => {
    const owner = await makeUser({ owner: true });
    const planned = await statusBySlug("planned");
    await prisma.status.update({ where: { id: planned.id }, data: { imageRetentionDays: 7 } });
    const s = await makeApproved(await makeUser(), "Planned, with a one week rule", "planned");
    await addImage(owner, s.publicId, await png());

    await prisma.suggestion.update({ where: { id: s.id }, data: { statusChangedAt: ago(6) } });
    expect((await purgeExpiredImages()).images).toBe(0);
    await prisma.suggestion.update({ where: { id: s.id }, data: { statusChangedAt: ago(8) } });
    expect((await purgeExpiredImages()).images).toBe(1);
  });

  it("never touches a suggestion that hasn't been approved", async () => {
    const author = await makeUser();
    const s = await makePending(author);
    await addImage(author, s.publicId, await png());
    await prisma.suggestion.update({ where: { id: s.id }, data: { statusChangedAt: ago(400) } });
    expect(await purgeExpiredImages()).toEqual({ suggestions: 0, images: 0 });
    expect(await count(s.id)).toBe(1);
  });

  it("takes the picture out of the Discord post as well", async () => {
    await prisma.settings.update({
      where: { id: 1 },
      data: { discordBoardEnabled: true, discordChannelId: CHANNEL, discordBoardSince: new Date(Date.now() - 5_000) },
    });
    const owner = await makeUser({ owner: true });
    const s = await makeApproved(await makeUser(), "A suggestion with a picture", "suggestions");
    const stored = await addImage(owner, s.publicId, await png());

    await syncBoard();
    const embed = () => discord.inChannel(CHANNEL)[0]!.payload.embeds[0];
    expect(embed().image).toEqual({ url: `https://suggest.test/api/images/${stored.id}.webp` });

    // Finished a long time ago.
    await prisma.suggestion.update({ where: { id: s.id }, data: { statusId: (await statusBySlug("completed")).id, statusChangedAt: ago(45) } });
    await purgeExpiredImages();
    await syncBoard();

    expect(discord.inChannel(CHANNEL)).toHaveLength(1);
    expect(embed().image).toBeUndefined();
  });
});

describe("the owner's setting", () => {
  const base = { name: "Done", color: "green", votingOpen: false, closesCommentsOnEntry: true, showOnRoadmap: true };

  it("accepts a number of days, or none", () => {
    expect(statusSchema.safeParse({ ...base, imageRetentionDays: 30 }).success).toBe(true);
    expect(statusSchema.safeParse({ ...base, imageRetentionDays: null }).success).toBe(true);
    expect(statusSchema.safeParse(base).success).toBe(true);
  });

  it("refuses nonsense", () => {
    for (const bad of [0, -5, 1.5, 4000, "30", Number.NaN]) {
      expect(statusSchema.safeParse({ ...base, imageRetentionDays: bad as never }).success, String(bad)).toBe(false);
    }
  });

  it("is kept when a form that doesn't mention it saves the status", async () => {
    const { updateStatus } = await import("@/server/config");
    const owner = await makeUser({ owner: true });
    const completed = await statusBySlug("completed");
    await updateStatus(owner, completed.id, { name: "Completed", color: "green", votingOpen: false, closesCommentsOnEntry: true, showOnRoadmap: true });
    expect((await statusBySlug("completed")).imageRetentionDays).toBe(30);
    await updateStatus(owner, completed.id, { name: "Completed", color: "green", votingOpen: false, closesCommentsOnEntry: true, showOnRoadmap: true, imageRetentionDays: null });
    expect((await statusBySlug("completed")).imageRetentionDays).toBeNull();
  });
});

describe("the database refuses what the server would never make", () => {
  it("keeps to four positions, WebP data of a sane size, and sane dimensions", async () => {
    const author = await makeUser();
    const s = await makePending(author);
    const good = Buffer.from(await sharp({ create: { width: 4, height: 4, channels: 3, background: "#000" } }).webp().toBuffer());
    const insert = (position: number, data: Buffer, width = 4, height = 4) =>
      prisma.suggestionImage.create({ data: { suggestionId: s.id, position, width, height, data: new Uint8Array(data) } });

    await expect(insert(4, good)).rejects.toThrow();
    await expect(insert(-1, good)).rejects.toThrow();
    await expect(insert(0, Buffer.from("<script>alert(1)</script>"))).rejects.toThrow();
    await expect(insert(0, await png())).rejects.toThrow();
    await expect(insert(0, Buffer.concat([good, Buffer.alloc(2_100_000)]))).rejects.toThrow();
    await expect(insert(0, good, 5000, 4)).rejects.toThrow();
    await expect(insert(0, good, 0, 4)).rejects.toThrow();
    await insert(0, good);
    await expect(insert(0, good)).rejects.toThrow();
    await expect(prisma.status.update({ where: { id: (await statusBySlug("completed")).id }, data: { imageRetentionDays: 0 } })).rejects.toThrow();
  });
});
