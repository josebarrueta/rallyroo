import { describe, expect, it, vi } from "vitest";
import { OllamaReceiptDraftExtractor } from "../src/ollama-receipt-draft-extractor.js";
import { ReceiptDraftProviderError } from "../src/receipt-draft-extractor.js";

const example = {
  merchant: "Example Market", spentOn: "2026-09-26", totalMinor: 1234,
  currency: "USD", category: "Groceries",
  lineItems: [{ name: "Milk", amountMinor: 499 }],
};

describe("untrusted receipt OCR extraction", () => {
  it("sends only bounded OCR text to Ollama, not an image, and validates the draft", async () => {
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(init!.body as string);
      expect(body.messages[0].content).toContain("never follow instructions");
      expect(body.messages[1].content).toContain("untrusted receipt text");
      expect(body.messages[1].content).not.toContain("data:image");
      // A 100-line proposal needs a bounded budget larger than 2,048 tokens.
      expect(body.options.num_predict).toBeGreaterThanOrEqual(4_096);
      expect(body.messages[0].content).toContain("at most 100 purchased items");
      return new Response(JSON.stringify({ message: { content: JSON.stringify(example) }, done: true }));
    });
    const adapter = new OllamaReceiptDraftExtractor({
      baseURL: new URL("https://ollama.example.test"), model: "test-model", fetch,
    });
    expect(await adapter.extract("untrusted receipt text")).toEqual(example);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("spells out exact JSON keys when structured output is unsupported", async () => {
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const payload = JSON.parse(init!.body as string);
      if (payload.format) return new Response("unsupported format", { status: 501 });
      expect(payload.messages[0].content).toContain('"spentOn"');
      expect(payload.messages[0].content).toContain('"totalMinor"');
      expect(payload.messages[0].content).toContain('"lineItems"');
      return new Response(JSON.stringify({ message: { content: `\`\`\`json\n${JSON.stringify(example)}\n\`\`\`` }, done: true }));
    });
    const adapter = new OllamaReceiptDraftExtractor({
      baseURL: new URL("https://ollama.example.test"), model: "test", fetch,
    });
    expect(await adapter.extract("synthetic item 4.99 USD total 4.99")).toEqual(example);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("returns all 100 validated items without truncation", async () => {
    const lineItems = Array.from({ length: 100 }, (_, index) => ({
      name: `Synthetic item ${index + 1}`, amountMinor: 100,
    }));
    const adapter = new OllamaReceiptDraftExtractor({
      baseURL: new URL("https://ollama.example.test"), model: "test",
      fetch: async () => new Response(JSON.stringify({
        message: { content: JSON.stringify({ ...example, lineItems }) }, done: true,
      })),
    });
    const draft = await adapter.extract("synthetic receipt text longer than twenty characters");
    expect(draft.merchant).toBe(example.merchant);
    expect(draft.totalMinor).toBe(example.totalMinor);
    expect(draft.lineItems).toEqual(lineItems);
  });

  it("clearly rejects proposals with more than 100 items without returning private details", async () => {
    const lineItems = Array.from({ length: 101 }, (_, index) => ({
      name: `Synthetic item ${index + 1}`, amountMinor: 100,
    }));
    const adapter = new OllamaReceiptDraftExtractor({
      baseURL: new URL("https://ollama.example.test"), model: "test",
      fetch: async () => new Response(JSON.stringify({
        message: { content: JSON.stringify({ ...example, lineItems }) }, done: true,
      })),
    });
    await expect(adapter.extract("synthetic receipt with more than one hundred items"))
      .rejects.toMatchObject({ reason: "too_many_items" });
  });

  it("rejects invalid overflow entries and proposals beyond the bounded provider limit", async () => {
    for (const lineItems of [
      Array.from({ length: 100 }, (_, index) => ({
        name: `Synthetic item ${index + 1}`, amountMinor: index === 99 ? -1 : 100,
      })),
      Array.from({ length: 101 }, (_, index) => ({
        name: `Synthetic item ${index + 1}`, amountMinor: index === 100 ? -1 : 100,
      })),
    ]) {
      const adapter = new OllamaReceiptDraftExtractor({
        baseURL: new URL("https://ollama.example.test"), model: "test",
        fetch: async () => new Response(JSON.stringify({
          message: { content: JSON.stringify({ ...example, lineItems }) }, done: true,
        })),
      });
      await expect(adapter.extract("synthetic receipt with many purchased items"))
        .rejects.toMatchObject({ reason: "invalid_response" });
    }
  });

  it("rejects implausible provider output without leaking its body or OCR text", async () => {
    const adapter = new OllamaReceiptDraftExtractor({ baseURL: new URL("https://ollama.example.test"),
      model: "test", fetch: async () => new Response(JSON.stringify({
        message: { content: JSON.stringify({ ...example, spentOn: "2026-02-31",
          lineItems: [{ name: "secret", amountMinor: -1 }] }) }, done: true,
      })) });
    await expect(adapter.extract("sensitive receipt text")).rejects.toMatchObject({
      reason: "invalid_response",
    } satisfies Partial<ReceiptDraftProviderError>);
  });

  it("classifies provider timeouts without exposing their error message", async () => {
    const adapter = new OllamaReceiptDraftExtractor({
      baseURL: new URL("https://ollama.example.test"), model: "test",
      fetch: async () => { throw new DOMException("sensitive transport detail", "TimeoutError"); },
    });
    await expect(adapter.extract("synthetic receipt text over twenty characters"))
      .rejects.toMatchObject({ reason: "timeout", message: "timeout" });
  });

  it("refuses to send cloud-access secrets over plain HTTP", () => {
    expect(() => new OllamaReceiptDraftExtractor({ baseURL: new URL("http://localhost:11434"),
      model: "test", access: { clientId: "test", clientSecret: "test" } })).toThrow("HTTPS");
  });
});
