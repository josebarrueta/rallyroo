import { describe, expect, it, vi } from "vitest";
import { OllamaDayBriefNarrator } from "../src/ollama-day-brief-narrator.js";
import type { DayBriefNarratorInput } from "../src/day-brief.js";

const input: DayBriefNarratorInput = {
  localDate: "2026-10-05",
  timeZone: "America/Los_Angeles",
  facts: {
    events: [{
      id: "event",
      title: "Practice",
      scheduledAt: "2026-10-05T15:00:00.000Z",
      startTime: "2026-10-05T15:00:00.000Z",
      endTime: "2026-10-05T16:00:00.000Z",
      location: "Field",
      roles: ["driver"],
    }],
    reminders: [],
  },
  deterministicTitle: "Your Monday: 1 event, 0 reminders",
  deterministicBody: "8:00 AM Practice (you drive).",
};

describe("OllamaDayBriefNarrator", () => {
  it("sends only structured authorized facts and validates the narrative", async () => {
    const requests: RequestInit[] = [];
    const fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      requests.push(init ?? {});
      return new Response(JSON.stringify({
      message: { content: JSON.stringify({
        title: "Your Monday starts with a drive",
        body: "Leave time is not available, but you drive to Practice at 8:00 AM.",
      }) },
        done: true,
      }), { status: 200 });
    });
    const narrator = new OllamaDayBriefNarrator({
      baseURL: new URL("https://ollama.example.test"),
      model: "model",
      fetch,
    });

    await expect(narrator.narrate(input)).resolves.toEqual({
      title: "Your Monday starts with a drive",
      body: "Leave time is not available, but you drive to Practice at 8:00 AM.",
    });
    const request = JSON.parse(requests[0]!.body as string);
    expect(request.format).toBeTruthy();
    expect(request.messages[1].content).toContain('"facts"');
    expect(request.messages[1].content).not.toContain("parent-subject");
  });

  it("retries without structured-output format when the runtime rejects it", async () => {
    const requests: RequestInit[] = [];
    let call = 0;
    const fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      requests.push(init ?? {});
      call += 1;
      if (call === 1) return new Response("unsupported", { status: 400 });
      return new Response(JSON.stringify({
        message: { content: '{"title":"Monday","body":"Practice is at 8:00 AM."}' },
        done: true,
      }), { status: 200 });
    });
    const narrator = new OllamaDayBriefNarrator({
      baseURL: new URL("https://ollama.example.test"), model: "model", fetch,
    });

    await expect(narrator.narrate(input)).resolves.toEqual({
      title: "Monday",
      body: "Practice is at 8:00 AM.",
    });
    expect(JSON.parse(requests[1]!.body as string)).not.toHaveProperty("format");
  });
});
