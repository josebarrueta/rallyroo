import { describe, expect, it, vi } from "vitest";
import { OllamaDayBriefNarrator } from "../src/ollama-day-brief-narrator.js";
import type { DayBriefNarratorInput } from "../src/day-brief.js";

const input: DayBriefNarratorInput = {
  firstName: "Alex", localDate: "2026-10-05", timeZone: "UTC",
  facts: { events: [{ id: "event", title: "Private practice", scheduledAt: "2026-10-05T15:00:00Z",
    startTime: "2026-10-05T15:00:00Z", endTime: "2026-10-05T16:00:00Z", location: null, roles: ["driver"] }], reminders: [] },
  deterministicTitle: "Hello, Alex.", deterministicBody: "One commitment today.",
  narrativeOptions: [{ id: "pace", text: "Your morning looks relaxed, with one commitment this afternoon." }],
};
const envelope = (content: object) => new Response(JSON.stringify({ message: { content: JSON.stringify(content) }, done: true }));

describe("OllamaDayBriefNarrator", () => {
  it("sends only approved wording choices and renders the selected choice without free-form output", async () => {
    const requests: RequestInit[] = [];
    const narrator = new OllamaDayBriefNarrator({ baseURL: new URL("https://ollama.example"), model: "model",
      fetch: vi.fn(async (_url, init) => { requests.push(init!); return envelope({ optionID: "pace" }); }) });
    await expect(narrator.narrate(input)).resolves.toEqual({ title: input.deterministicTitle, body: input.narrativeOptions[0]!.text });
    const request = JSON.parse(requests[0]!.body as string);
    expect(request.format).toBeTruthy();
    expect(JSON.parse(request.messages[1].content)).toEqual({ options: input.narrativeOptions });
    expect(request.messages[1].content).not.toMatch(/Private practice|Alex|2026-10-05|driver/);
  });

  it("can retry without runtime schema support without relaxing application validation", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response("unsupported", { status: 400 }))
      .mockResolvedValueOnce(envelope({ optionID: "pace" }));
    const narrator = new OllamaDayBriefNarrator({ baseURL: new URL("https://ollama.example"), model: "model", fetch });
    await expect(narrator.narrate(input)).resolves.toEqual({ title: input.deterministicTitle, body: input.narrativeOptions[0]!.text });
    expect(JSON.parse(fetch.mock.calls[1]![1].body)).not.toHaveProperty("format");
  });

  it.each([{ optionID: "unknown" }, { title: "Hello", body: "You drive at 6 AM" },
    { optionID: "pace", body: "A private obligation" }])("rejects unsupported output %j", async (output) => {
    const narrator = new OllamaDayBriefNarrator({ baseURL: new URL("https://ollama.example"), model: "model",
      fetch: vi.fn(async () => envelope(output)) });
    await expect(narrator.narrate(input)).rejects.toThrow("invalid_day_brief_narrative");
  });
});
