import type { Context, Next } from "hono";
import { eq, and, or, isNull, gte } from "drizzle-orm";
import { db, apiKeys } from "../../client";
import { hashApiKey, getApiKeyPrefix, isValidApiKeyFormat } from "../utils/crypto";
import type { ApiKey } from "../../schema";

// Simple in-memory cache for API keys
interface CachedKey {
  key: ApiKey;
  timestamp: number;
}

const keyCache = new Map<string, CachedKey>();
const CACHE_TTL = 2 * 60 * 1000; // 2 minutes

/**
 * Clean expired entries from cache
 */
function cleanCache() {
  const now = Date.now();
  for (const [hash, cached] of keyCache.entries()) {
    if (now - cached.timestamp > CACHE_TTL) {
      keyCache.delete(hash);
    }
  }
}

/**
 * Get API key from cache or database
 */
async function getApiKey(rawKey: string): Promise<ApiKey | null> {
  const keyHash = hashApiKey(rawKey);
  
  // Check cache first
  const cached = keyCache.get(keyHash);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.key;
  }
  
  // Query database
  try {
    const keyPrefix = getApiKeyPrefix(rawKey);
    const now = new Date();
    
    const result = await db.query.apiKeys.findFirst({
      where: and(
        eq(apiKeys.keyPrefix, keyPrefix),
        eq(apiKeys.keyHash, keyHash),
        eq(apiKeys.isActive, true),
        or(
          isNull(apiKeys.expiresAt),
          gte(apiKeys.expiresAt, now)
        )
      ),
      with: {
        user: true,
      },
    });
    
    if (result) {
      // Ensure scopes is always an array
      const apiKey: ApiKey = {
        ...result,
        scopes: result.scopes || ["read", "write"],
      };
      
      // Cache the result
      keyCache.set(keyHash, { key: apiKey, timestamp: Date.now() });
      
      // Update last used timestamp (non-blocking)
      db.update(apiKeys)
        .set({ lastUsedAt: now })
        .where(eq(apiKeys.id, result.id))
        .execute()
        .catch(console.error);
      
      // Clean cache periodically
      if (Math.random() < 0.1) { // 10% chance
        cleanCache();
      }
      
      return apiKey;
    }
  } catch (error) {
    console.error("Error validating API key:", error);
  }
  
  return null;
}

/**
 * API key authentication middleware
 */
export async function apiKeyAuth(c: Context, next: Next) {
  const apiKey = c.req.header("X-API-Key");
  
  if (!apiKey) {
    return c.json({ error: "Missing API key. Please provide X-API-Key header" }, 401);
  }
  
  // Check for root key (environment variable)
  // This key bypasses database checks and has all permissions
  const rootKey = process.env.API_KEY || Bun.env?.API_KEY;
  
  if (rootKey && apiKey === rootKey) {
    // Root key has all permissions and bypasses database
    c.set("apiKeyType", "root");
    c.set("apiKeyScopes", ["read", "write", "admin", "root"]);
    c.set("userId", "root");
    await next();
    return;
  }
  
  // For non-root keys, validate format
  if (!isValidApiKeyFormat(apiKey)) {
    return c.json({ error: "Invalid API key format" }, 401);
  }
  
  // Get key from cache or database
  const keyData = await getApiKey(apiKey);
  
  if (!keyData) {
    return c.json({ error: "Invalid API key" }, 401);
  }
  
  // Set context variables for use in routes
  c.set("apiKeyId", keyData.id);
  c.set("userId", keyData.userId);
  c.set("apiKeyScopes", keyData.scopes || ["read", "write"]);
  c.set("apiKeyType", "database");
  
  await next();
}

/**
 * Scope checking middleware
 * Use after apiKeyAuth to check if the key has required scopes
 */
export function requireScopes(...requiredScopes: string[]) {
  return async (c: Context, next: Next) => {
    const keyScopes = c.get("apiKeyScopes") as string[] || [];
    
    // Root and admin scopes have access to everything
    if (keyScopes.includes("root") || keyScopes.includes("admin")) {
      await next();
      return;
    }
    
    // Check if key has all required scopes
    const hasAllScopes = requiredScopes.every(scope => keyScopes.includes(scope));
    
    if (!hasAllScopes) {
      return c.json({ 
        error: "Insufficient permissions",
        required: requiredScopes,
        available: keyScopes
      }, 403);
    }
    
    await next();
  };
}

/**
 * Clear the entire cache (useful for testing or manual cache invalidation)
 */
export function clearApiKeyCache() {
  keyCache.clear();
}