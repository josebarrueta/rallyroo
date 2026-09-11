import { z } from "zod";

export const scheduleDraftSchema = z.object({
  kind: z.enum(["event", "reminder"]),
  title: z.string().trim().min(1).max(200),
  memberIDs: z.array(z.string().min(1)).max(50),
  startTime: z.string().datetime().nullable(),
  endTime: z.string().datetime().nullable(),
  dueAt: z.string().datetime().nullable(),
  location: z.string().trim().max(500).nullable(),
  alertLeadTimeMinutes: z.union([
    z.literal(0), z.literal(5), z.literal(15), z.literal(30), z.literal(45), z.literal(60), z.literal(1440), z.null(),
  ]),
  clarification: z.string().trim().min(1).max(500).nullable(),
  confidence: z.number().min(0).max(1),
}).superRefine((draft, context) => {
  if (draft.kind === "event" && draft.clarification === null) {
    if (!draft.startTime || !draft.endTime || new Date(draft.endTime) <= new Date(draft.startTime)) {
      context.addIssue({ code: "custom", message: "event requires a valid time range" });
    }
  }
  if (draft.kind === "reminder") {
    if (draft.clarification === null && !draft.dueAt) {
      context.addIssue({ code: "custom", message: "reminder requires a due time" });
    }
    if (draft.alertLeadTimeMinutes === 30 || draft.alertLeadTimeMinutes === 45) {
      context.addIssue({ code: "custom", message: "30 and 45 minute alerts are Event-only" });
    }
  }
});

export const scheduleDraftResultSchema = z.object({
  drafts: z.array(scheduleDraftSchema).max(20),
});

export type ScheduleDraft = z.infer<typeof scheduleDraftSchema>;
export type ScheduleDraftResult = z.infer<typeof scheduleDraftResultSchema>;

export interface ScheduleDraftExtractionRequest {
  text: string;
  inputType: "text" | "voice" | "image";
  timeZone: string;
  referenceDate: string;
  members: Array<{ id: string; name: string }>;
}

export interface ScheduleDraftExtractor {
  extract(request: ScheduleDraftExtractionRequest): Promise<ScheduleDraftResult>;
}

export class UnavailableScheduleDraftExtractor implements ScheduleDraftExtractor {
  async extract(_request: ScheduleDraftExtractionRequest): Promise<ScheduleDraftResult> {
    throw new ScheduleDraftProviderError("unavailable");
  }
}

export class ScheduleDraftProviderError extends Error {
  constructor(public readonly reason: "unavailable" | "invalid_response") {
    super(`Schedule draft provider ${reason}`);
  }
}
