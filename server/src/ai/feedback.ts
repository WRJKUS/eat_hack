import OpenAI from "openai";
import { FeedbackReport, type ShopConfig } from "@cm/shared";
import type { AnalyzedSession } from "../analytics";
import { sessionDigest, shopDigest } from "./digest";

/**
 * Minimal slice of the OpenAI SDK we use (chat completions with structured outputs).
 * The real `OpenAI` client satisfies it; tests inject a fake.
 */
export interface ChatClient {
  chat: {
    completions: {
      create(body: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming): PromiseLike<{
        choices: Array<{ message: { content: string | null; refusal?: string | null } }>;
      }>;
    };
  };
}

export const DEFAULT_MODEL = "gpt-4.1-mini";

export function createOpenAiClient(apiKey: string | undefined): ChatClient | null {
  if (!apiKey) return null;
  return new OpenAI({ apiKey, timeout: 120_000, maxRetries: 1 });
}

/*
 * Hand-written JSON schema for structured outputs (strict mode). openai@5's zodResponseFormat helper only
 * understands zod v3 internals, and this repo uses zod v4, so the schema is spelled out here and the model
 * output is validated with the shared zod schema afterwards.
 */
const evidenceSchema = {
  type: "object",
  additionalProperties: false,
  required: ["sessionId", "t", "note"],
  properties: {
    sessionId: { type: "string", description: "A sessionId exactly as it appears in the digest." },
    t: { type: ["number", "null"], description: "Epoch-ms timestamp copied from the digest (event/issue/page t), or null." },
    note: { type: "string", description: "What happens at that moment, in one short sentence." },
  },
} as const;

const insightSchema = (subjectKey: "product" | "title", subjectDesc: string) =>
  ({
    type: "object",
    additionalProperties: false,
    required: [subjectKey, "observation", "recommendation", "priority", "evidence"],
    properties: {
      [subjectKey]: { type: "string", description: subjectDesc },
      observation: { type: "string", description: "What the data shows, in plain language." },
      recommendation: { type: "string", description: "A concrete, actionable change the shop owner can make." },
      priority: { type: "string", enum: ["high", "medium", "low"] },
      evidence: { type: "array", items: evidenceSchema },
    },
  }) as const;

export const FEEDBACK_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "journeyNarrative", "productInsights", "uxFindings", "positives"],
  properties: {
    summary: { type: "string", description: "3-5 sentence executive summary for the shop owner." },
    journeyNarrative: { type: "string", description: "How shoppers got to the shop and moved through it." },
    productInsights: { type: "array", items: insightSchema("product", "Product name as in the digest.") },
    uxFindings: { type: "array", items: insightSchema("title", "Short title of the UX finding.") },
    positives: { type: "array", items: { type: "string" } },
  },
} as const;

const ModelOutput = FeedbackReport.omit({ scope: true, scopeId: true, generatedAt: true, model: true });

export const SYSTEM_PROMPT = `You are a senior e-commerce UX researcher. You analyse data from an opt-in eye-tracking usability study
of an online shop and write feedback for the shop owner (not a UX expert).

Input: a compact JSON digest (no raw gaze). It contains session metadata, the shopper's pre-shop journey (categorised:
price comparison, video, recipe, search, ...), the sequence of shop pages with durations, attention metrics per area of
interest (AOI: product cards, images, prices, titles, reviews, call-to-action buttons) with product names, interactions
(clicks, add to cart, checkout, purchase), automatically detected UX issues, and a calibration-quality note.
All "t" values are epoch-millisecond timestamps.

How to read the metrics: dwellMs = total looking time; fixations = number of fixations; timeToFirstFixationMs = how
long after entering the page the element was first looked at (null = never seen); revisits = how often the eyes came
back to it; clicked = whether it was clicked.

Write:
- Concrete, prioritised, actionable recommendations, about products (e.g. the price was looked at repeatedly but did
  not convince; reviews were ignored; the image attracted attention but nobody clicked; a product was added to the cart
  but abandoned) and about UX (findability, dead or rage clicks, hesitation at buttons, content below the fold).
- Plain language for a shop owner. No jargon such as "fixation" or "AOI" in the output; say "looked at", "area", etc.
- Tie insights to the pre-shop journey where relevant (e.g. shoppers coming from a price comparison scrutinise prices;
  shoppers coming from a recipe video look for a specific tool).
- Back every product insight and UX finding with evidence: sessionId exactly as given and a timestamp "t" copied from
  the digest (an interaction, issue or page "t"), or null if there is no specific moment. Never make up session ids,
  timestamps, products, numbers or behaviour that are not in the digest. If the data is thin, say so and keep the list short.
- If the calibration note reports an error above 2.5°, explicitly say that attention on small elements is less reliable
  and lean on larger areas and clicks.
- Order productInsights and uxFindings by priority (high first). Give 1-6 items each. Add 1-4 genuine positives.`;

export interface FeedbackDeps {
  client: ChatClient | null;
  model: string;
}

export const UNAVAILABLE_MSG = "AI feedback is unavailable: OPENAI_API_KEY is not configured on the server (set it in server/.env and restart).";

export class FeedbackUnavailableError extends Error {}
export class FeedbackModelError extends Error {}

async function generate(
  deps: FeedbackDeps,
  scope: "session" | "shop",
  scopeId: string,
  digest: unknown,
  sessions: Pick<AnalyzedSession, "id" | "startedAt" | "endedAt">[],
): Promise<FeedbackReport> {
  if (!deps.client) throw new FeedbackUnavailableError(UNAVAILABLE_MSG);
  const user =
    scope === "session"
      ? `Scope: a single shopping session. Write the report for this session.\n\nDigest:\n${JSON.stringify(digest)}`
      : `Scope: the whole shop, aggregated across the ${sessions.length} most recent sessions. Focus on patterns that recur across sessions, and cite example sessions.\n\nDigest:\n${JSON.stringify(digest)}`;

  let completion;
  try {
    completion = await deps.client.chat.completions.create({
      model: deps.model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: user },
      ],
      response_format: { type: "json_schema", json_schema: { name: "feedback_report", strict: true, schema: FEEDBACK_JSON_SCHEMA as unknown as Record<string, unknown> } },
    });
  } catch (err) {
    throw new FeedbackModelError(`OpenAI request failed: ${(err as Error).message}`);
  }
  const msg = completion.choices[0]?.message;
  if (!msg) throw new FeedbackModelError("OpenAI returned no choices");
  if (msg.refusal) throw new FeedbackModelError(`model refused: ${msg.refusal}`);
  let raw: unknown;
  try {
    raw = JSON.parse(msg.content ?? "");
  } catch {
    throw new FeedbackModelError("model output is not valid JSON");
  }
  const parsed = ModelOutput.safeParse(raw);
  if (!parsed.success) throw new FeedbackModelError(`model output does not match the report schema: ${parsed.error.issues[0]?.message ?? ""}`);

  // Keep only evidence that points at real sessions; null out timestamps outside the session's time range.
  const ranges = new Map(sessions.map((s) => [s.id, s]));
  const cleanEvidence = (ev: FeedbackReport["uxFindings"][number]["evidence"]) =>
    ev
      .filter((e) => ranges.has(e.sessionId))
      .map((e) => {
        const s = ranges.get(e.sessionId)!;
        const ok = e.t != null && Number.isFinite(e.t) && e.t >= s.startedAt - 3_600_000 && e.t <= s.endedAt + 60_000;
        return { ...e, t: ok ? e.t : null };
      });
  const out = parsed.data;
  const report: FeedbackReport = {
    scope,
    scopeId,
    generatedAt: Date.now(),
    model: deps.model,
    summary: out.summary,
    journeyNarrative: out.journeyNarrative,
    productInsights: out.productInsights.map((p) => ({ ...p, evidence: cleanEvidence(p.evidence) })),
    uxFindings: out.uxFindings.map((u) => ({ ...u, evidence: cleanEvidence(u.evidence) })),
    positives: out.positives,
  };
  return FeedbackReport.parse(report);
}

export function generateSessionFeedback(deps: FeedbackDeps, session: AnalyzedSession, shop?: ShopConfig): Promise<FeedbackReport> {
  return generate(deps, "session", session.id, sessionDigest(session, shop), [session]);
}

export function generateShopFeedback(deps: FeedbackDeps, shop: ShopConfig, sessionsNewestFirst: AnalyzedSession[]): Promise<FeedbackReport> {
  const digest = shopDigest(shop, sessionsNewestFirst);
  return generate(deps, "shop", shop.id, digest, sessionsNewestFirst.slice(0, 30));
}
