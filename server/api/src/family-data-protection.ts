import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const protectedValuePrefix = "rr1";
const wrappedKeyPrefix = "rrk1";

export interface WrappedFamilyDataKey {
  familyID: string;
  version: number;
  wrappedKey: string;
}

export interface FamilyDataKeyStore {
  activeKey(familyID: string): Promise<WrappedFamilyDataKey | null>;
  key(familyID: string, version: number): Promise<WrappedFamilyDataKey | null>;
  saveKeyIfAbsent(key: WrappedFamilyDataKey): Promise<WrappedFamilyDataKey>;
  rotateKey(key: WrappedFamilyDataKey, priorVersion: number): Promise<void>;
}

export class FamilyDataProtector {
  private constructor(
    private readonly masterKey: Buffer,
    private readonly keyStore: FamilyDataKeyStore,
  ) {}

  static fromEncodedMasterKey(
    encodedKey: string,
    keyStore: FamilyDataKeyStore,
  ): FamilyDataProtector {
    const masterKey = decodeKey(encodedKey);
    if (!masterKey) {
      throw new Error(
        "FAMILY_DATA_ENCRYPTION_KEY must be a base64-encoded 32-byte key",
      );
    }
    return new FamilyDataProtector(masterKey, keyStore);
  }

  isProtected(value: string): boolean {
    return value.startsWith(`${protectedValuePrefix}.`);
  }

  async protect(familyID: string, purpose: string, plaintext: string): Promise<string> {
    const familyKey = await this.activeFamilyKey(familyID);
    const key = this.unwrapFamilyKey(familyKey);
    return seal(
      key,
      Buffer.from(plaintext, "utf8"),
      protectedValueAAD(familyID, purpose, familyKey.version),
      protectedValuePrefix,
      familyKey.version,
    );
  }

  async rotateFamilyKey(familyID: string): Promise<void> {
    const activeKey = await this.activeFamilyKey(familyID);
    const nextKey = this.newWrappedFamilyKey(familyID, activeKey.version + 1);
    await this.keyStore.rotateKey(nextKey, activeKey.version);
  }

  async validateActiveFamilyKey(familyID: string): Promise<void> {
    try {
      const key = await this.keyStore.activeKey(familyID);
      if (!key || this.unwrapFamilyKey(key).length !== 32) throw new Error("invalid key");
    } catch {
      throw new Error("Unable to validate Family data key");
    }
  }

  async reveal(familyID: string, purpose: string, protectedValue: string): Promise<string> {
    try {
      const parsed = parseSealedValue(protectedValue, protectedValuePrefix);
      const familyKey = await this.keyStore.key(familyID, parsed.version);
      if (!familyKey) throw new Error("missing key");
      const key = this.unwrapFamilyKey(familyKey);
      return open(
        key,
        parsed,
        protectedValueAAD(familyID, purpose, parsed.version),
      ).toString("utf8");
    } catch {
      throw new Error("Unable to reveal protected Family data");
    }
  }

  private async activeFamilyKey(familyID: string): Promise<WrappedFamilyDataKey> {
    const existing = await this.keyStore.activeKey(familyID);
    if (existing) return existing;

    return this.keyStore.saveKeyIfAbsent(this.newWrappedFamilyKey(familyID, 1));
  }

  private newWrappedFamilyKey(familyID: string, version: number): WrappedFamilyDataKey {
    return {
      familyID,
      version,
      wrappedKey: seal(
        this.masterKey,
        randomBytes(32),
        wrappedKeyAAD(familyID, version),
        wrappedKeyPrefix,
        version,
      ),
    };
  }

  private unwrapFamilyKey(key: WrappedFamilyDataKey): Buffer {
    const parsed = parseSealedValue(key.wrappedKey, wrappedKeyPrefix);
    if (parsed.version !== key.version) throw new Error("invalid key version");
    return open(
      this.masterKey,
      parsed,
      wrappedKeyAAD(key.familyID, key.version),
    );
  }
}

interface ParsedSealedValue {
  version: number;
  nonce: Buffer;
  tag: Buffer;
  ciphertext: Buffer;
}

function seal(
  key: Buffer,
  plaintext: Buffer,
  associatedData: Buffer,
  prefix: string,
  version: number,
): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(associatedData);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return [
    prefix,
    String(version),
    nonce.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

function open(key: Buffer, value: ParsedSealedValue, associatedData: Buffer): Buffer {
  const decipher = createDecipheriv("aes-256-gcm", key, value.nonce);
  decipher.setAAD(associatedData);
  decipher.setAuthTag(value.tag);
  return Buffer.concat([decipher.update(value.ciphertext), decipher.final()]);
}

function parseSealedValue(value: string, expectedPrefix: string): ParsedSealedValue {
  const [prefix, versionValue, nonceValue, tagValue, ciphertextValue, ...extra] = value.split(".");
  const version = Number(versionValue);
  if (
    prefix !== expectedPrefix
    || !Number.isSafeInteger(version)
    || version < 1
    || !nonceValue
    || !tagValue
    || ciphertextValue === undefined
    || extra.length > 0
  ) {
    throw new Error("invalid protected value");
  }
  const nonce = decodeCanonicalBase64URL(nonceValue);
  const tag = decodeCanonicalBase64URL(tagValue);
  const ciphertext = decodeCanonicalBase64URL(ciphertextValue, true);
  if (nonce.length !== 12 || tag.length !== 16) throw new Error("invalid protected value");
  return {
    version,
    nonce,
    tag,
    ciphertext,
  };
}

function decodeCanonicalBase64URL(value: string, allowEmpty = false): Buffer {
  if (value === "" && allowEmpty) return Buffer.alloc(0);
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("invalid protected value");
  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value) throw new Error("invalid protected value");
  return decoded;
}

function protectedValueAAD(familyID: string, purpose: string, version: number): Buffer {
  return Buffer.from(`rallyroo-family-data\0${familyID}\0${purpose}\0${version}`, "utf8");
}

function wrappedKeyAAD(familyID: string, version: number): Buffer {
  return Buffer.from(`rallyroo-family-key\0${familyID}\0${version}`, "utf8");
}

function decodeKey(encodedKey: string): Buffer | null {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(encodedKey)) return null;
  const decoded = Buffer.from(encodedKey, "base64");
  return decoded.length === 32 && decoded.toString("base64") === encodedKey
    ? decoded
    : null;
}
