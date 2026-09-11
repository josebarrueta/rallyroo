import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { InMemoryRallyrooRepository } from "../src/in-memory-repository.js";
import type { IdentityProvider } from "../src/identity-provider.js";

const identityProvider: IdentityProvider = {
  googleAuthorizationURL() { return "https://identity.example/google"; },
  appleAuthorizationURL() { return "https://identity.example/apple"; },
  async authenticateOAuthToken() { throw new Error("not used"); },
  async verifySession(token: string) {
    if (token === "parent-token") return { subject: "parent-subject", displayName: "Alex" };
    if (token === "kid-token") return { subject: "kid-subject", displayName: "Emma" };
    throw new Error("invalid session");
     },
  async revokeSession() {},
  async deleteIdentity() {},
    };

function repository() {
  return new InMemoryRallyrooRepository({
    accounts: [
       { identitySubject: "parent-subject", familyID: "family-1", memberID: "parent-1", role: "parent" },
       { identitySubject: "kid-subject", familyID: "family-1", memberID: "kid-1", role: "kid" },
       ],
    members: [
       { id: "parent-1", familyID: "family-1", name: "Alex", role: "parent", colorTag: "blue" },
       { id: "kid-1", familyID: "family-1", name: "Emma", role: "kid", colorTag: "purple" },
       { id: "kid-2", familyID: "family-1", name: "Noah", role: "kid", colorTag: "orange" },
       ],
    });
}

describe("recurring reminder API", () => {
  it("saves a weekly recurring reminder series", async () => {
    const data = repository();
    const app = buildApp({ identityProvider, repository: data });
    const reminderID = "abcdefab-cdef-4abc-8def-abcdefabc201";

    const saved = await app.inject({
      method: "PUT",
      url: `/v1/reminders/${reminderID}`,
      headers: { authorization: "Bearer parent-token" },
      payload: {
        id: reminderID,
        title: "Pack sports bag",
        assigneeIDs: ["kid-1"],
        dueAt: "2026-09-07T18:00:00Z",
        alertLeadTimeMinutes: 60,
        recurrenceFrequency: "weekly",
        recurrenceWeekdays: [1, 3],
        recurrenceEndDate: "2026-10-01T23:59:00Z",
        },
       });

    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({
      id: reminderID,
      status: "open",
      recurrenceFrequency: "weekly",
      recurrenceWeekdays: [1, 3],
      recurrenceEndDate: "2026-10-01T23:59:00Z",
       });
    await app.close();
     });

  it("saves a biweekly reminder", async () => {
    const data = repository();
    const app = buildApp({ identityProvider, repository: data });
    const reminderID = "abcdefab-cdef-4abc-8def-abcdefabc202";

    const saved = await app.inject({
      method: "PUT",
      url: `/v1/reminders/${reminderID}`,
      headers: { authorization: "Bearer parent-token" },
      payload: {
        id: reminderID,
        title: "Trash day",
        assigneeIDs: ["kid-1"],
        dueAt: "2026-09-07T08:00:00Z",
        alertLeadTimeMinutes: 60,
        recurrenceFrequency: "biweekly",
        recurrenceInterval: 1,
        recurrenceWeekdays: [1],
        recurrenceEndDate: "2026-11-01T23:59:00Z",
        },
       });

    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({
      id: reminderID,
      recurrenceFrequency: "biweekly",
      recurrenceInterval: 1,
       });
    await app.close();
     });

  it("kid cannot create or delete reminders", async () => {
    const data = repository();
    const app = buildApp({ identityProvider, repository: data });
    const reminderID = "abcdefab-cdef-4abc-8def-abcdefabc203";

    const save = await app.inject({
      method: "PUT",
      url: `/v1/reminders/${reminderID}`,
      headers: { authorization: "Bearer kid-token" },
      payload: {
        id: reminderID,
        title: "Kid reminder",
        assigneeIDs: ["kid-1"],
        dueAt: "2026-09-07T10:00:00Z",
        },
       });
    expect(save.statusCode).toBe(403);

    await app.close();
     });

  it("one-time reminders have null recurrence fields", async () => {
    const data = repository();
    const app = buildApp({ identityProvider, repository: data });
    const reminderID = "abcdefab-cdef-4abc-8def-abcdefabc205";

    const saved = await app.inject({
      method: "PUT",
      url: `/v1/reminders/${reminderID}`,
      headers: { authorization: "Bearer parent-token" },
      payload: {
        id: reminderID,
        title: "One-time",
        assigneeIDs: ["kid-1"],
        dueAt: "2026-09-15T10:00:00Z",
        alertLeadTimeMinutes: 15,
        },
       });

    expect(saved.statusCode).toBe(200);
    expect(saved.json().recurrenceFrequency ?? null).toBeNull();
    expect(saved.json().recurrenceWeekdays ?? []).toEqual([]);

    await app.close();
     });

  it("completing and reopening does not break series", async () => {
    const data = repository();
    const app = buildApp({
      identityProvider,
      repository: data,
     });
    const reminderID = "abcdefab-cdef-4abc-8def-abcdefabc204";
    await app.inject({
      method: "PUT",
      url: `/v1/reminders/${reminderID}`,
      headers: { authorization: "Bearer parent-token" },
      payload: {
        id: reminderID,
        title: "Water plants",
        assigneeIDs: ["kid-1"],
        dueAt: "2026-09-07T10:00:00Z",
        recurrenceFrequency: "weekly",
        recurrenceWeekdays: [1],
        recurrenceEndDate: "2026-10-01T23:59:00Z",
        },
       });

    const complete = await app.inject({
      method: "POST",
      url: `/v1/reminders/${reminderID}/complete`,
      headers: { authorization: "Bearer kid-token" },
       });
    expect(complete.statusCode).toBe(200);

    const reopen = await app.inject({
      method: "POST",
      url: `/v1/reminders/${reminderID}/reopen`,
      headers: { authorization: "Bearer parent-token" },
       });
    expect(reopen.statusCode).toBe(200);
    expect(reopen.json()).toMatchObject({ status: "open" });

    await app.close();
     });
});
