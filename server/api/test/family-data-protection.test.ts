import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  FamilyDataProtector,
  type FamilyDataKeyStore,
  type WrappedFamilyDataKey,
} from "../src/family-data-protection.js";

class MemoryFamilyDataKeyStore implements FamilyDataKeyStore {
  readonly activeVersions = new Map<string, number>();
  readonly keys = new Map<string, WrappedFamilyDataKey>();

  async activeKey(familyID: string): Promise<WrappedFamilyDataKey | null> {
    const version = this.activeVersions.get(familyID);
    return version === undefined ? null : this.keys.get(`${familyID}/${version}`) ?? null;
  }

  async key(familyID: string, version: number): Promise<WrappedFamilyDataKey | null> {
    return this.keys.get(`${familyID}/${version}`) ?? null;
  }

  async saveKeyIfAbsent(key: WrappedFamilyDataKey): Promise<WrappedFamilyDataKey> {
    const existing = await this.activeKey(key.familyID);
    if (existing) return existing;
    this.keys.set(`${key.familyID}/${key.version}`, key);
    this.activeVersions.set(key.familyID, key.version);
    return key;
  }

  async rotateKey(key: WrappedFamilyDataKey, priorVersion: number): Promise<void> {
    if (this.activeVersions.get(key.familyID) !== priorVersion) {
      throw new Error("concurrent rotation");
    }
    this.keys.set(`${key.familyID}/${key.version}`, key);
    this.activeVersions.set(key.familyID, key.version);
  }
}

const masterKey = randomBytes(32).toString("base64");

describe("FamilyDataProtector", () => {
  it("round-trips protected details without retaining plaintext", async () => {
    const protector = FamilyDataProtector.fromEncodedMasterKey(
      masterKey,
      new MemoryFamilyDataKeyStore(),
    );

    const protectedValue = await protector.protect(
      "family-a",
      "events/event-1/title",
      "Private medical appointment",
    );

    expect(protectedValue).toMatch(/^rr1\.1\./);
    expect(protectedValue).not.toContain("Private medical appointment");
    await expect(protector.reveal(
      "family-a",
      "events/event-1/title",
      protectedValue,
    )).resolves.toBe("Private medical appointment");
  });

  it("binds ciphertext to its Family and field purpose", async () => {
    const protector = FamilyDataProtector.fromEncodedMasterKey(
      masterKey,
      new MemoryFamilyDataKeyStore(),
    );
    const protectedValue = await protector.protect(
      "family-a",
      "events/event-1/location",
      "Sensitive location",
    );
    await protector.protect("family-b", "events/event-2/title", "Other Family");

    await expect(protector.reveal(
      "family-b",
      "events/event-1/location",
      protectedValue,
    )).rejects.toThrow("Unable to reveal protected Family data");
    await expect(protector.reveal(
      "family-a",
      "events/event-1/title",
      protectedValue,
    )).rejects.toThrow("Unable to reveal protected Family data");
  });

  it("preserves old ciphertext while rotating new writes to a new Family key", async () => {
    const protector = FamilyDataProtector.fromEncodedMasterKey(
      masterKey,
      new MemoryFamilyDataKeyStore(),
    );
    const beforeRotation = await protector.protect("family-a", "events/1/title", "Before");

    await protector.rotateFamilyKey("family-a");
    const afterRotation = await protector.protect("family-a", "events/2/title", "After");

    expect(beforeRotation).toMatch(/^rr1\.1\./);
    expect(afterRotation).toMatch(/^rr1\.2\./);
    await expect(protector.reveal("family-a", "events/1/title", beforeRotation))
      .resolves.toBe("Before");
    await expect(protector.reveal("family-a", "events/2/title", afterRotation))
      .resolves.toBe("After");
  });

  it("rejects an existing Family key wrapped by a different master key", async () => {
    const keyStore = new MemoryFamilyDataKeyStore();
    const original = FamilyDataProtector.fromEncodedMasterKey(masterKey, keyStore);
    await original.protect("family-a", "events/1/title", "Protected");
    const replacement = FamilyDataProtector.fromEncodedMasterKey(
      randomBytes(32).toString("base64"),
      keyStore,
    );

    await expect(replacement.validateActiveFamilyKey("family-a"))
      .rejects.toThrow("Unable to validate Family data key");
  });

  it("rejects master keys that do not decode to exactly 32 bytes", () => {
    expect(() => FamilyDataProtector.fromEncodedMasterKey(
      Buffer.alloc(31).toString("base64"),
      new MemoryFamilyDataKeyStore(),
    )).toThrow("FAMILY_DATA_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
  });
});
