/** Typed fetch client for the Cookie Monster owner API (see packages/shared/src/api.ts). */
import type {
  Aoi,
  FeedbackReport,
  Fixation,
  GazeSample,
  Heatmap,
  JourneySummary,
  PageTemplateSummary,
  PageVisit,
  ProductMetrics,
  SessionDetail,
  SessionEvent,
  SessionSummary,
  ShopConfig,
  UxIssue,
} from "@cm/shared";

export const TOKEN_KEY = "cm.ownerToken";
export const DEFAULT_TOKEN = "dev-owner";

export function getToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) || DEFAULT_TOKEN;
  } catch {
    return DEFAULT_TOKEN;
  }
}

export function setToken(token: string): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable */
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** SessionDetail with the `z.any()` arrays narrowed to their real types. */
export type TypedSessionDetail = Omit<SessionDetail, "pages" | "events" | "fixations" | "gaze" | "aois"> & {
  pages: PageVisit[];
  events: SessionEvent[];
  fixations: Fixation[];
  gaze: GazeSample[];
  aois: Aoi[];
};

/** rrweb eventWithTime (kept opaque; the Replayer validates it). */
export type RrwebEvent = { type: number; timestamp: number; data?: unknown; [k: string]: unknown };

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${getToken()}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new ApiError(0, `Cannot reach the server (${(e as Error).message}). Is it running on :8787?`);
  }
  const text = await res.text();
  let data: unknown = undefined;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    const msg =
      (data && typeof data === "object" && ("message" in data || "error" in data)
        ? String((data as Record<string, unknown>).message ?? (data as Record<string, unknown>).error)
        : typeof data === "string" && data.length < 300
          ? data
          : "") || `${res.status} ${res.statusText}`;
    // Vite's proxy answers 500/502/504 with an empty body when the target is down.
    if ((res.status === 502 || res.status === 504 || res.status === 500) && !text) {
      throw new ApiError(res.status, "The API server is not reachable (is it running on :8787?)");
    }
    throw new ApiError(res.status, msg, data);
  }
  return data as T;
}

const enc = encodeURIComponent;

/** Returns null on 404 (used for "not generated yet" resources). */
async function orNull<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

export const api = {
  shops: () => request<ShopConfig[]>("GET", "/shops"),
  createShop: (shop: Partial<ShopConfig> & Omit<ShopConfig, "id">) => request<ShopConfig>("POST", "/shops", shop),
  updateShop: (shop: ShopConfig) => request<ShopConfig>("PUT", `/shops/${enc(shop.id)}`, shop),
  createTester: (shopId: string, label: string) =>
    request<{ testerId: string; token: string }>("POST", `/shops/${enc(shopId)}/testers`, { label }),

  sessions: (shopId: string) => request<SessionSummary[]>("GET", `/shops/${enc(shopId)}/sessions`),
  session: (id: string) => request<TypedSessionDetail>("GET", `/sessions/${enc(id)}`),
  rrweb: async (id: string, pageId: string): Promise<RrwebEvent[]> => {
    const r = await orNull(request<RrwebEvent[] | { events: RrwebEvent[] }>("GET", `/sessions/${enc(id)}/rrweb/${enc(pageId)}`));
    if (!r) return [];
    return Array.isArray(r) ? r : Array.isArray(r.events) ? r.events : [];
  },
  deleteSession: (id: string) => request<{ ok: boolean }>("DELETE", `/sessions/${enc(id)}`),

  pages: (shopId: string) => request<PageTemplateSummary[]>("GET", `/shops/${enc(shopId)}/pages`),
  heatmap: (shopId: string, template: string) =>
    request<Heatmap>("GET", `/shops/${enc(shopId)}/heatmap?template=${enc(template)}`),
  products: (shopId: string) => request<ProductMetrics[]>("GET", `/shops/${enc(shopId)}/products`),
  uxIssues: (shopId: string) => request<UxIssue[]>("GET", `/shops/${enc(shopId)}/ux-issues`),
  journeys: (shopId: string) => request<JourneySummary>("GET", `/shops/${enc(shopId)}/journeys`),

  sessionFeedback: (id: string) => orNull(request<FeedbackReport>("GET", `/sessions/${enc(id)}/feedback`)),
  generateSessionFeedback: (id: string) => request<FeedbackReport>("POST", `/sessions/${enc(id)}/feedback`),
  shopFeedback: (shopId: string) => orNull(request<FeedbackReport>("GET", `/shops/${enc(shopId)}/feedback`)),
  generateShopFeedback: (shopId: string) => request<FeedbackReport>("POST", `/shops/${enc(shopId)}/feedback`),
};
