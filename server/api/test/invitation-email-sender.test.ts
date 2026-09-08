import { describe, expect, it } from "vitest";
import { ResendInvitationEmailSender } from "../src/resend-invitation-email-sender.js";

const delivery = {
  recipientEmail: "kid@example.com",
  inviterName: "Alex & Jordan",
  role: "kid" as const,
  invitationURL: "https://rallyroo.dev/invite#code=secure-code",
  expiresAt: "2026-09-02T12:00:00Z",
};

describe("ResendInvitationEmailSender", () => {
  it("sends the secure invitation link through the Resend API", async () => {
    const requests: Array<{ url: string; authorization: string | null; body: unknown }> = [];
    const sender = new ResendInvitationEmailSender({
      apiKey: "resend-test-key",
      from: "Rallyroo <invites@example.com>",
      fetch: async (input, init) => {
        const headers = new Headers(init?.headers);
        requests.push({
          url: String(input),
          authorization: headers.get("authorization"),
          body: JSON.parse(String(init?.body)),
        });
        return new Response(JSON.stringify({ id: "email-1" }), { status: 200 });
      },
    });

    await sender.send(delivery);

    expect(requests).toEqual([{
      url: "https://api.resend.com/emails",
      authorization: "Bearer resend-test-key",
      body: expect.objectContaining({
        from: "Rallyroo <invites@example.com>",
        to: ["kid@example.com"],
        subject: "Alex & Jordan invited you to Rallyroo",
        text: expect.stringContaining("https://rallyroo.dev/invite#code=secure-code"),
        html: expect.stringContaining('href="https://rallyroo.dev/invite#code=secure-code"'),
      }),
    }]);
  });

  it("reports a failed Resend delivery", async () => {
    const sender = new ResendInvitationEmailSender({
      apiKey: "resend-test-key",
      from: "Rallyroo <invites@example.com>",
      fetch: async () => new Response("provider unavailable", { status: 503 }),
    });

    await expect(sender.send(delivery)).rejects.toThrow("Resend returned 503");
  });
});
