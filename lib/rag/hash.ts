import crypto from "crypto";

/**
 * Deterministically hashes a string using SHA-256.
 * Used to deduplicate chunks.
 */
export function hashText(text: string): string {
  return crypto
    .createHash("sha256")
    .update(text)
    .digest("hex");
}
