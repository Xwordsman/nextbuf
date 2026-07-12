import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { getAuthEnvironment } from "@/shared/config/runtime-env";

type EncryptedPayload = {
  ciphertext: string;
  initializationVector: string;
  authTag: string;
};

function encryptionKey(): Buffer {
  return Buffer.from(getAuthEnvironment().MAIL_PAYLOAD_KEY, "base64");
}

export function encryptMailPayload(
  payload: Record<string, string>,
  key: Buffer = encryptionKey(),
): EncryptedPayload {
  const initializationVector = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, initializationVector);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);

  return {
    ciphertext: ciphertext.toString("base64"),
    initializationVector: initializationVector.toString("hex"),
    authTag: cipher.getAuthTag().toString("hex"),
  };
}

export function decryptMailPayload(
  payload: EncryptedPayload,
  key: Buffer = encryptionKey(),
): Record<string, string> {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(payload.initializationVector, "hex"),
  );
  decipher.setAuthTag(Buffer.from(payload.authTag, "hex"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");

  return JSON.parse(plaintext) as Record<string, string>;
}
