import { IMAGE_LIMITS, IMAGE_UPLOAD_TYPES, addImage } from "@/server/images";
import { defineApi } from "@/server/http";
import { publicIdParam } from "@/server/params";

/**
 * Adds a picture to a suggestion. The body is the file itself. It is never
 * stored as sent: the server makes a new image from it (see `server/images.ts`).
 */
export const POST = defineApi({
  auth: "member",
  skipTenure: true, // same as editing the text: the domain function applies the rules
  rawBody: { maxBytes: IMAGE_LIMITS.maxBytes, types: IMAGE_UPLOAD_TYPES },
  rate: { name: "image-upload", limit: 24, windowMs: 60 * 60_000, per: "user" },
  handler: async ({ req, user, params, raw }) => addImage(user, publicIdParam(params), raw!, req),
});
