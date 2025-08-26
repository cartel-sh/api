import { createHash, randomBytes } from "crypto";

/**
 * Generate a new API key with prefix
 * Format: cartel_[32 random characters]
 */
export function generateApiKey(): string {
  const randomPart = randomBytes(24).toString("base64url"); // 32 chars when base64url encoded
  return `cartel_${randomPart}`;
}

/**
 * Hash an API key using SHA-256
 */
export function hashApiKey(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex");
}

/**
 * Get the prefix from an API key (first 8 chars after "cartel_")
 */
export function getApiKeyPrefix(apiKey: string): string {
  if (!apiKey.startsWith("cartel_")) {
    throw new Error("Invalid API key format");
  }
  return apiKey.substring(7, 15); // "cartel_" is 7 chars, take next 8
}

/**
 * Validate API key format
 */
export function isValidApiKeyFormat(apiKey: string): boolean {
  return /^cartel_[A-Za-z0-9_-]{32}$/.test(apiKey);
}

/**
 * Compare a raw API key with a hashed key
 */
export function compareApiKey(rawKey: string, hashedKey: string): boolean {
  return hashApiKey(rawKey) === hashedKey;
}