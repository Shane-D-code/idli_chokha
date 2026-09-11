// ============================================================
// TOOFAN API client
// Thin transport layer. All domain shaping happens in the
// individual service modules. This file owns HTTP + error
// translation (never leak internal stack traces to the UI).
// ============================================================

const DEFAULT_BASE = "/api";

export class ApiError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export async function apiGet<T>(path: string, base: string = DEFAULT_BASE): Promise<T> {
  try {
    const res = await fetch(`${base}${path}`, {
      headers: { Accept: "application/json" },
      credentials: "same-origin",
    });
    if (!res.ok) {
      throw new ApiError(`Request failed with status ${res.status}`, res.status);
    }
    const json = (await res.json()) as T;
    return json;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    // Transform unknown/network errors into user-safe messages.
    throw new ApiError("The TOOFAN backend is unreachable.");
  }
}

export async function apiPost<T>(path: string, body: unknown, base: string = DEFAULT_BASE): Promise<T> {
  try {
    const res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      credentials: "same-origin",
    });
    if (!res.ok) {
      throw new ApiError(`Request failed with status ${res.status}`, res.status);
    }
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError("The TOOFAN backend is unreachable.");
  }
}
