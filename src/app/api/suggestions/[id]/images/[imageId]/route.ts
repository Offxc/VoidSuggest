import { deleteImage } from "@/server/images";
import { defineApi } from "@/server/http";
import { publicIdParam, rowIdParam } from "@/server/params";

export const DELETE = defineApi({
  auth: "member",
  skipTenure: true,
  rate: { name: "image-delete", limit: 60, windowMs: 60 * 60_000, per: "user" },
  handler: async ({ req, user, params }) => deleteImage(user, publicIdParam(params), rowIdParam(params, "imageId"), req),
});
