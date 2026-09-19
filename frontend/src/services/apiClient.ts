// ============================================================
// TOOFAN API client
// Thin transport layer. All domain shaping happens in the
// individual service modules. This file owns HTTP + error
// translation (never leak internal stack traces to the UI).
// ============================================================

const configuredBase = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "");
const DEFAULT_BASE = configuredBase ? `${configuredBase}/api/v1` : "/api/v1";

export class ApiError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export function getApiBaseUrl(): string {
  return DEFAULT_BASE;
}

export function getWebSocketUrl(path: string): string {
  const base = DEFAULT_BASE.replace(/\/$/, "");
  const absolute =
    base.startsWith("http://") || base.startsWith("https://")
      ? base
      : `${window.location.origin}${base}`;
  const url = new URL(`${absolute}${path.startsWith("/") ? path : `/${path}`}`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

async function parseError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { detail?: unknown };
    if (typeof body.detail === "string") return body.detail;
    if (body.detail) return JSON.stringify(body.detail);
  } catch {
    // keep generic message
  }
  return `Request failed with status ${res.status}`;
}

export async function apiGet<T>(path: string, base: string = DEFAULT_BASE): Promise<T> {
  try {
    const res = await fetch(`${base}${path}`, {
      headers: { Accept: "application/json" },
      credentials: "same-origin",
    });
    if (!res.ok) {
      throw new ApiError(await parseError(res), res.status);
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
      throw new ApiError(await parseError(res), res.status);
    }
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError("The TOOFAN backend is unreachable.");
  }
}
