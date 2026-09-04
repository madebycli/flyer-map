import { pbkdf2 } from "node:crypto";

const PASSWORD_KEY_BYTES = 32;
const MAX_PASSWORD_PBKDF2_ITERATIONS = 5_000_000;

export async function deriveOrganizationPasswordPbkdf2(
  password: string,
  salt: Uint8Array,
  iterations: number,
) {
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > MAX_PASSWORD_PBKDF2_ITERATIONS) {
    throw new Error("organization_password_iterations_invalid");
  }
  const workerSalt = new Uint8Array(salt.byteLength);
  workerSalt.set(salt);
  return new Promise<Uint8Array>((resolve, reject) => {
    pbkdf2(password, workerSalt, iterations, PASSWORD_KEY_BYTES, "sha256", (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }
      const output = new Uint8Array(derivedKey.byteLength);
      output.set(derivedKey);
      resolve(output);
    });
  });
}
