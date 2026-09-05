
export type RecoverableCredentialKind = "room-code" | "qr";

export type RecoverableCredentialContext = {
  campaignId: string;
  groupId: string;
  credentialId: string;
  kind: RecoverableCredentialKind;
};

export type EncryptedFieldGroupCredential = {
  ivB64: string;
  ciphertextB64: string;
};

export class FieldGroupCredentialRecoveryError extends Error {
  readonly code: "credential_recovery_unconfigured" | "credential_recovery_failed";

  constructor(code: FieldGroupCredentialRecoveryError["code"], message: string) {
    super(message);
    this.name = "FieldGroupCredentialRecoveryError";
    this.code = code;
  }
}

function decodeBase64Url(value: string) {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new FieldGroupCredentialRecoveryError("credential_recovery_unconfigured", "Credential-Recovery-Key ist ungültig.");
  }
  const normalized = value.replace(/-/gu, "+").replace(/_/gu, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new FieldGroupCredentialRecoveryError("credential_recovery_unconfigured", "Credential-Recovery-Key ist ungültig.");
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function encodeBase64Url(value: Uint8Array) {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/gu, "");
}

function aad(context: RecoverableCredentialContext) {
  return new TextEncoder().encode(
    `flyer-map:field-group-credential:v1:${context.campaignId}:${context.groupId}:${context.credentialId}:${context.kind}`,
  );
}

async function keyFromSecret(secret: string | undefined, usage: KeyUsage[]) {
  if (!secret) {
    throw new FieldGroupCredentialRecoveryError(
      "credential_recovery_unconfigured",
      "Credential-Recovery-Key ist nicht konfiguriert.",
    );
  }
  const raw = decodeBase64Url(secret);
  if (raw.byteLength !== 32) {
    throw new FieldGroupCredentialRecoveryError(
      "credential_recovery_unconfigured",
      "Credential-Recovery-Key muss 32 Byte lang sein.",
    );
  }
  try {
    return await crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, usage);
  } catch {
    throw new FieldGroupCredentialRecoveryError(
      "credential_recovery_unconfigured",
      "Credential-Recovery-Key konnte nicht geladen werden.",
    );
  }
}

export async function encryptFieldGroupCredential(
  secret: string | undefined,
  context: RecoverableCredentialContext,
  plaintext: string,
): Promise<EncryptedFieldGroupCredential> {
  const key = await keyFromSecret(secret, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  try {
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: aad(context), tagLength: 128 },
      key,
      new TextEncoder().encode(plaintext),
    );
    return {
      ivB64: encodeBase64Url(iv),
      ciphertextB64: encodeBase64Url(new Uint8Array(ciphertext)),
    };
  } catch {
    throw new FieldGroupCredentialRecoveryError(
      "credential_recovery_failed",
      "Credential konnte nicht verschlüsselt werden.",
    );
  }
}

export async function decryptFieldGroupCredential(
  secret: string | undefined,
  context: RecoverableCredentialContext,
  encrypted: EncryptedFieldGroupCredential,
) {
  const key = await keyFromSecret(secret, ["decrypt"]);
  try {
    const iv = decodeBase64Url(encrypted.ivB64);
    const ciphertext = decodeBase64Url(encrypted.ciphertextB64);
    if (iv.byteLength !== 12) throw new Error("invalid iv");
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, additionalData: aad(context), tagLength: 128 },
      key,
      ciphertext,
    );
    return new TextDecoder().decode(plaintext);
  } catch (error) {
    if (error instanceof FieldGroupCredentialRecoveryError) throw error;
    throw new FieldGroupCredentialRecoveryError(
      "credential_recovery_failed",
      "Credential konnte nicht entschlüsselt werden.",
    );
  }
}
