import { z } from "zod";

const money = z.number().int().min(0).max(1_000_000_000_000).nullable();
export const receiptDraftSchema = z.object({
  merchant: z.string().max(120).nullable(),
  spentOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  totalMinor: money,
  currency: z.literal("USD").nullable(),
  category: z.string().trim().min(1).max(60).nullable(),
  lineItems: z.array(z.object({
    name: z.string().trim().min(1).max(120),
    amountMinor: money,
  }).strict()).max(100),
}).strict();

export type ReceiptDraft = z.infer<typeof receiptDraftSchema>;

export interface ReceiptDraftExtractor {
  extract(ocrText: string): Promise<ReceiptDraft>;
}

export class ReceiptDraftProviderError extends Error {
  constructor(public readonly reason: "unavailable" | "invalid_response" | "too_many_items" | "timeout") {
    super(reason);
    this.name = "ReceiptDraftProviderError";
  }
}
