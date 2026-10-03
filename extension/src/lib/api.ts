/* Tester-side HTTP client for the Cookie Monster server. */
import { TesterConfig } from "@cm/shared";
import type { SessionUpload } from "@cm/shared";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function normalizeServerUrl(url: string): string {
  let u = url.trim();
  if (!/^https?:\/\//i.test(u)) u = "http://" + u;
  return u.replace(/\/+$/, "").replace(/\/api$/, "");
}

async function call<T>(serverUrl: string, token: string, method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${normalizeServerUrl(serverUrl)}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new ApiError(`Cannot reach the study server at ${serverUrl} (${(e as Error).message}).`, 0);
  }
  const text = await res.text();
  let json: unknown = undefined;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    // non-JSON error page
  }
  if (!res.ok) {
    const msg =
      (json && typeof json === "object" && ("message" in json || "error" in json)
        ? String((json as Record<string, unknown>).message ?? (json as Record<string, unknown>).error)
        : text.slice(0, 200)) || res.statusText;
    if (res.status === 401 || res.status === 403) throw new ApiError(`The invite token was rejected (${res.status}). ${msg}`, res.status);
    throw new ApiError(`Server error ${res.status}: ${msg}`, res.status);
  }
  return json as T;
}

export async function fetchTesterConfig(serverUrl: string, token: string): Promise<TesterConfig> {
  const raw = await call<unknown>(serverUrl, token, "GET", "/api/tester/config");
  const parsed = TesterConfig.safeParse(raw);
  if (!parsed.success) throw new ApiError("The server sent an unexpected tester configuration.", 0);
  return parsed.data;
}

export function uploadSession(serverUrl: string, token: string, payload: SessionUpload): Promise<{ id: string }> {
  return call(serverUrl, token, "POST", "/api/sessions", payload);
}

export function deleteUploadedSession(serverUrl: string, token: string, id: string): Promise<{ ok: boolean }> {
  return call(serverUrl, token, "DELETE", `/api/tester/sessions/${encodeURIComponent(id)}`);
}
