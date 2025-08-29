import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import { eq, and, or, isNull, gte } from "drizzle-orm";
import { db, apiKeys } from "../../client";
import { hashApiKey, getApiKeyPrefix, isValidApiKeyFormat } from "../utils/crypto";
import type { ApiKey } from "../../schema";
import jwt from "jsonwebtoken";

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
      // Ensure scopes is always an array, preserve new fields
      const apiKey: ApiKey = {
        ...result,
        scopes: result.scopes || ["read", "write"],
        clientName: result.clientName,
        allowedOrigins: result.allowedOrigins,
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
 * API key authentication middleware (requires API key)
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
 * Optional API key middleware (extracts API key if present, doesn't require it)
 * Use this for routes where API key is optional but needed for rate limiting
 */
export async function optionalApiKey(c: Context, next: Next) {
  const apiKey = c.req.header("X-API-Key");
  
  if (!apiKey) {
    // No API key provided, continue without it
    await next();
    return;
  }
  
  // Check for root key (environment variable)
  const rootKey = process.env.API_KEY || Bun.env?.API_KEY;
  
  if (rootKey && apiKey === rootKey) {
    // Root key has all permissions and bypasses database
    c.set("apiKeyType", "root");
    c.set("apiKeyScopes", ["read", "write", "admin", "root"]);
    c.set("apiKeyUserId", "root"); // Use apiKeyUserId to differentiate from JWT userId
    await next();
    return;
  }
  
  // For non-root keys, validate format
  if (!isValidApiKeyFormat(apiKey)) {
    // Invalid format, but we don't fail - just continue without API key context
    console.debug("Invalid API key format provided");
    await next();
    return;
  }
  
  // Get key from cache or database
  const keyData = await getApiKey(apiKey);
  
  if (!keyData) {
    // Invalid key, but we don't fail - just continue without API key context
    console.debug("Invalid API key provided");
    await next();
    return;
  }
  
  // Set context variables for use in routes (for rate limiting and client identification)
  c.set("apiKeyId", keyData.id);
  c.set("apiKeyUserId", keyData.userId); // Use apiKeyUserId to differentiate from JWT userId
  c.set("apiKeyScopes", keyData.scopes || ["read", "write"]);
  c.set("apiKeyType", "database");
  c.set("clientName", keyData.clientName);
  c.set("allowedOrigins", keyData.allowedOrigins);
  
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

// JWT configuration - reuse from auth routes
const JWT_SECRET = process.env.JWT_SECRET || Bun.env.JWT_SECRET || "development-secret-key-change-this-in-production-minimum-32-chars";

/**
 * Middleware to extract JWT token and set user context
 * Sets sessionUserId and userAddress in context if valid token present
 * Does not fail if no token - use for optional auth
 * Checks cookie first, then Authorization header
 */
export async function withJwtAuth(c: Context, next: Next) {
  // Try cookie first, then Authorization header
  const token = getCookie(c, "cartelToken") || 
    (c.req.header("Authorization")?.startsWith("Bearer ") 
      ? c.req.header("Authorization")!.slice(7) 
      : null);
  
  if (token) {
    try {
      const payload = jwt.verify(token, JWT_SECRET) as any;
      c.set("sessionUserId", payload.userId);
      c.set("userAddress", payload.address);
      c.set("clientId", payload.clientId);
      c.set("clientName", payload.clientName);
    } catch (error) {
      // Invalid token, continue without user auth
      console.debug("Invalid JWT token:", error);
    }
  }
  
  await next();
}

/**
 * Middleware that requires a valid JWT token
 * Returns 401 if no valid token present
 * Checks cookie first, then Authorization header
 */
export async function requireJwtAuth(c: Context, next: Next) {
  // Try cookie first, then Authorization header
  const token = getCookie(c, "cartelToken") || 
    (c.req.header("Authorization")?.startsWith("Bearer ") 
      ? c.req.header("Authorization")!.slice(7) 
      : null);
  
  if (!token) {
    return c.json({ 
      error: "Authentication required",
      message: "Please sign in to continue"
    }, 401);
  }
  
  try {
    const payload = jwt.verify(token, JWT_SECRET) as any;
    c.set("sessionUserId", payload.userId);
    c.set("userAddress", payload.address);
    c.set("clientId", payload.clientId);
    c.set("clientName", payload.clientName);
    await next();
  } catch (error) {
    return c.json({ 
      error: "Invalid or expired token",
      message: "Please sign in again"
    }, 401);
  }
}

/**
 * Combined middleware that requires both API key and JWT auth
 * API key identifies the application, JWT identifies the user
 */
export async function requireFullAuth(c: Context, next: Next) {
  const apiKeyResult = await apiKeyAuth(c, async () => {});
  if (apiKeyResult) return apiKeyResult; // Return error if API key invalid
  
  return requireJwtAuth(c, next);
}