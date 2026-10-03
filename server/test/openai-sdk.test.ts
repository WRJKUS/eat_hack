import http from "node:http";
import type { AddressInfo } from "node:net";
import OpenAI from "openai";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FeedbackReport } from "@cm/shared";
import { analyzeSession } from "../src/analytics";
import { FEEDBACK_JSON_SCHEMA, generateSessionFeedback } from "../src/ai/feedback";
import { DEMO_SHOP } from "../src/seed-base";
import { syntheticSession } from "../src/synthetic";

/** Runs the real OpenAI SDK against a local stub of the Chat Completions endpoint. */
describe("feedback via the real OpenAI SDK (stub HTTP server)", () => {
  let server: http.Server;
  let received: any;
  const s = syntheticSession(1, Date.now(), 2);

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        received = { url: req.url, auth: req.headers.authorization, body: JSON.parse(body) };
        const content = JSON.stringify({
          summary: "s",
          journeyNarrative: "j",
          productInsights: [],
          uxFindings: [{ title: "Cart abandoned", observation: "o", recommendation: "r", priority: "high", evidence: [{ sessionId: s.id, t: s.startedAt + 1000, note: "n" }] }],
          positives: [],
        });
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            id: "chatcmpl-1",
            object: "chat.completion",
            created: 1,
            model: received.body.model,
            choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content, refusal: null } }],
          }),
        );
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("sends a strict json_schema request and parses the answer", async () => {
    const port = (server.address() as AddressInfo).port;
    const client = new OpenAI({ apiKey: "sk-test", baseURL: `http://127.0.0.1:${port}/v1`, maxRetries: 0 });
    const report = await generateSessionFeedback({ client, model: "gpt-4.1-mini" }, { ...s, testerId: "t", rrwebPages: [], ...analyzeSession(s) }, DEMO_SHOP);
    expect(FeedbackReport.parse(report).uxFindings[0]!.evidence[0]!.sessionId).toBe(s.id);
    expect(received.url).toBe("/v1/chat/completions");
    expect(received.auth).toBe("Bearer sk-test");
    expect(received.body.response_format).toEqual({ type: "json_schema", json_schema: { name: "feedback_report", strict: true, schema: FEEDBACK_JSON_SCHEMA } });
    expect(received.body.messages[1].content.length).toBeLessThan(60_000);
  });
});
