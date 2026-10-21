/**
 * An error that is safe to show to the person who caused it. Anything else
 * thrown inside a request is logged and reported as a generic failure, so
 * internals never leak into responses.
 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const unauthorized = () => new HttpError(401, "unauthorized", "Sign in to continue.");
export const forbidden = (message = "You don't have permission to do that.", code = "forbidden") =>
  new HttpError(403, code, message);
export const notFound = (message = "Not found.") => new HttpError(404, "not_found", message);
export const conflict = (code: string, message: string) => new HttpError(409, code, message);
export const badRequest = (message: string, code = "bad_request", details?: unknown) =>
  new HttpError(400, code, message, details);
export const unavailable = (message = "Discord isn't responding. Please try again in a moment.") =>
  new HttpError(503, "discord_unavailable", message);
