"use client";

/**
 * Small fetch wrapper for the browser. Always JSON, always same-origin
 * (the browser adds the Origin header the server checks), and errors come
 * back as plain text the interface can show.
 */
export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  message: string | null;
  fieldErrors: Record<string, string[]> | null;
}

export async function api<T = unknown>(method: string, url: string, body?: unknown): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
    });
    const json = (await res.json().catch(() => null)) as { error?: { message?: string; details?: unknown } } | T | null;
    if (res.ok) return { ok: true, status: res.status, data: json as T, message: null, fieldErrors: null };
    const error = (json as { error?: { message?: string; details?: unknown } } | null)?.error;
    const details = error?.details && typeof error.details === "object" ? (error.details as Record<string, string[]>) : null;
    return {
      ok: false,
      status: res.status,
      data: null,
      message: error?.message ?? (res.status === 429 ? "Too many requests. Please wait a moment." : "Something went wrong."),
      fieldErrors: details,
    };
  } catch {
    return { ok: false, status: 0, data: null, message: "Couldn't reach the server. Check your connection.", fieldErrors: null };
  }
}
