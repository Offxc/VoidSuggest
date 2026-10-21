import { notFound } from "./errors";

/**
 * Route parameters are validated against the exact shape of the ids we
 * generate, so a malformed value is a clean 404 and never reaches a query.
 */

const PUBLIC_ID = /^[0-9A-HJKMNP-TV-Z]{8}$/;
const ROW_ID = /^[a-z0-9]{20,32}$/;

export function publicIdParam(params: Record<string, string>, key = "id"): string {
  const value = params[key];
  if (!value || !PUBLIC_ID.test(value)) throw notFound();
  return value;
}

export function rowIdParam(params: Record<string, string>, key = "id"): string {
  const value = params[key];
  if (!value || !ROW_ID.test(value)) throw notFound();
  return value;
}
