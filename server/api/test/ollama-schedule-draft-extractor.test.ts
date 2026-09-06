import { describe, expect, it } from "vitest";
import { OllamaScheduleDraftExtractor } from "../src/ollama-schedule-draft-extractor.js";

const request = {
  text: "Remind Alex to bring cleats tomorrow at 4 PM",
  inputType: "voice" as const,
  timeZone: "America/Los_Angeles",
  referenceDate: "2026-09-06T16:00:00.000Z",
  members: [{ id: "kid-1", name: "Alex" }],
};

describe("OllamaScheduleDraftExtractor", () => {
  it("requests structured output and validates reminder drafts", async () => {
    let body: Record<string, unknown> = {};
    const extractor = new OllamaScheduleDraftExtractor({
      baseURL: new URL("http://127.0.0.1:11435"),
      model: "qwen3.8:27b-mlx",
      fetch: async (_url, init) => {
        body = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({
          message: { content: JSON.stringify({ drafts: [{
            kind: "reminder",
            title: "Bring cleats",
            memberIDs: ["kid-1"],
            startTime: null,
            endTime: null,
            dueAt: "2026-09-07T23:00:00.000Z",
            location: null,
            alertLeadTimeMinutes: 0,
            clarification: null,
            confidence: 0.96,
          }] }) },
          done: true,
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      },
    });

    const result = await extractor.extract(request);

    expect(result.drafts[0]).toMatchObject({ kind: "reminder", memberIDs: ["kid-1"] });
    expect(body).toMatchObject({ model: "qwen3.8:27b-mlx", stream: false, think: false });
    expect(body.format).toMatchObject({ type: "object" });
    expect(JSON.stringify(body.messages)).toContain("America/Los_Angeles");
  });

  it("falls back to prompt-constrained JSON when the local runtime lacks structured outputs", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const validContent = `\`\`\`json\n${JSON.stringify({ drafts: [{
      kind: "reminder", title: "Bring cleats", memberIDs: ["kid-1"],
      startTime: null, endTime: null, dueAt: "2026-09-07T23:00:00.000Z",
      location: null, alertLeadTimeMinutes: 0, clarification: null, confidence: 0.9,
    }] })}\n\`\`\``;
    const extractor = new OllamaScheduleDraftExtractor({
      baseURL: new URL("http://127.0.0.1:11435"),
      model: "qwen3.8:27b-mlx",
      fetch: async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return bodies.length === 1
          ? new Response("not supported", { status: 501 })
          : new Response(JSON.stringify({ message: { content: validContent }, done: true }), { status: 200 });
      },
    });

    await expect(extractor.extract(request)).resolves.toMatchObject({ drafts: [{ kind: "reminder" }] });
    expect(bodies[0]?.format).toMatchObject({ type: "object" });
    expect(bodies[1]).not.toHaveProperty("format");
    expect(JSON.stringify(bodies[1]?.messages)).toContain("outputSchema");
  });

  it("accepts the first validated JSON object when the local runtime repeats it after a think marker", async () => {
    const draftResult = JSON.stringify({ drafts: [{
      kind: "reminder", title: "Bring cleats", memberIDs: ["kid-1"],
      startTime: null, endTime: null, dueAt: "2026-09-07T23:00:00.000Z",
      location: null, alertLeadTimeMinutes: 0, clarification: null, confidence: 0.9,
    }] });
    let attempts = 0;
    const extractor = new OllamaScheduleDraftExtractor({
      baseURL: new URL("http://127.0.0.1:11435"),
      model: "qwen3.8:27b-mlx",
      fetch: async () => ++attempts === 1
        ? new Response("not supported", { status: 501 })
        : new Response(JSON.stringify({
          message: { content: `${draftResult}\n</think>\n${draftResult}` }, done: true,
        }), { status: 200 }),
    });

    await expect(extractor.extract(request)).resolves.toMatchObject({
      drafts: [{ title: "Bring cleats" }],
    });
  });

  it("rejects member IDs the model was not given", async () => {
    const extractor = new OllamaScheduleDraftExtractor({
      baseURL: new URL("http://127.0.0.1:11435"),
      model: "qwen3.8:27b-mlx",
      fetch: async () => new Response(JSON.stringify({
        message: { content: JSON.stringify({ drafts: [{
          kind: "event", title: "Practice", memberIDs: ["other-family-member"],
          startTime: "2026-09-07T23:00:00.000Z", endTime: "2026-09-08T00:00:00.000Z",
          dueAt: null, location: null, alertLeadTimeMinutes: 15,
          clarification: null, confidence: 0.9,
        }] }) }, done: true,
      }), { status: 200 }),
    });

    await expect(extractor.extract(request)).rejects.toThrow("unknown member");
  });
});
