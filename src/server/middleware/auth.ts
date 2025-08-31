import type { Context, Next } from "hono";
import { eq, and, or, isNull, gte } from "drizzle-orm";
import { db, apiKeys, users } from "../../client";
import {
	hashApiKey,
	getApiKeyPrefix,
	isValidApiKeyFormat,
} from "../utils/crypto";
import { verifyAccessToken } from "../utils/tokens";
import { logger as baseLogger } from "../utils/logger";
import type { ApiKey, UserRole } from "../../schema";

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
				or(isNull(apiKeys.expiresAt), gte(apiKeys.expiresAt, now)),
			),
			with: {
				user: true,
			},
		});

		if (result) {
			const apiKey: ApiKey = {
				...result,
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
				.catch((error) => baseLogger.error({ error }, "Failed to update API key last used timestamp"));

			// Clean cache periodically
			if (Math.random() < 0.1) {
				// 10% chance
				cleanCache();
			}

			return apiKey;
		}
	} catch (error) {
		baseLogger.error({ error }, "API key validation failed");
	}

	return null;
}

/**
 * Bearer token authentication middleware
 * Validates JWT access tokens in Authorization header
 */
export async function bearerAuth(c: Context, next: Next) {
	const authHeader = c.req.header("Authorization");

	if (!authHeader?.startsWith("Bearer ")) {
		return c.json(
			{ error: "Missing bearer token. Please provide Authorization: Bearer <token> header" },
			401,
		);
	}

	const token = authHeader.slice(7);
	const payload = verifyAccessToken(token);

	if (!payload) {
		return c.json({ error: "Invalid or expired token" }, 401);
	}

	// context variables for use in routes
	c.set("userId", payload.userId);
	c.set("userRole", payload.userRole);
	c.set("clientId", payload.clientId);
	c.set("authType", "bearer");

	await next();
}

/**
 * Optional bearer token middleware
 * Extracts bearer token if present, doesn't require it
 */
export async function optionalBearerAuth(c: Context, next: Next) {
	const authHeader = c.req.header("Authorization");

	if (authHeader?.startsWith("Bearer ")) {
		const token = authHeader.slice(7);
		const payload = verifyAccessToken(token);

		if (payload) {
			c.set("userId", payload.userId);
			c.set("userRole", payload.userRole);
			c.set("clientId", payload.clientId);
			c.set("authType", "bearer");
		}
	}

	await next();
}

/**
 * API key authentication middleware (requires API key)
 */
export async function apiKeyAuth(c: Context, next: Next) {
	const apiKey = c.req.header("X-API-Key");

	if (!apiKey) {
		return c.json(
			{ error: "Missing API key. Please provide X-API-Key header" },
			401,
		);
	}

	// Check for root key (environment variable)
	// This key bypasses database checks and has admin role
	const rootKey = process.env.API_KEY || Bun.env?.API_KEY;

	if (rootKey && apiKey === rootKey) {
		// Root key has admin role
		c.set("apiKeyType", "root");
		c.set("userId", "root");
		c.set("userRole", "admin" as UserRole);
		c.set("authType", "apikey");
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

	// Fetch user to get role
	const user = await db.query.users.findFirst({
		where: eq(users.id, keyData.userId),
	});

	// Set context variables for use in routes
	c.set("apiKeyId", keyData.id);
	c.set("userId", keyData.userId);
	c.set("userRole", user?.role || 'authenticated');
	c.set("clientName", keyData.clientName);
	c.set("apiKeyType", "database");
	c.set("authType", "apikey");

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
		// Root key has admin role
		c.set("apiKeyType", "root");
		c.set("apiKeyUserId", "root");
		c.set("userRole", "admin" as UserRole);
		c.set("authType", "apikey");
		await next();
		return;
	}

	// For non-root keys, validate format
	if (!isValidApiKeyFormat(apiKey)) {
		// Invalid format, but we don't fail - just continue without API key context
		baseLogger.debug({}, "Invalid API key format provided");
		await next();
		return;
	}

	// Get key from cache or database
	const keyData = await getApiKey(apiKey);

	if (!keyData) {
		// Invalid key, but we don't fail - just continue without API key context
		baseLogger.debug({}, "Invalid API key provided");
		await next();
		return;
	}

	// Fetch user to get role
	const user = await db.query.users.findFirst({
		where: eq(users.id, keyData.userId),
	});

	// Set context variables for use in routes (for rate limiting and client identification)
	c.set("apiKeyId", keyData.id);
	c.set("apiKeyUserId", keyData.userId);
	c.set("userRole", user?.role || 'authenticated');
	c.set("apiKeyType", "database");
	c.set("clientName", keyData.clientName);
	c.set("allowedOrigins", keyData.allowedOrigins);
	c.set("authType", "apikey");

	await next();
}

/**
 * Combined authentication middleware
 * Accepts either Bearer token OR API key
 */
export async function combinedAuth(c: Context, next: Next) {
	const authHeader = c.req.header("Authorization");
	const apiKey = c.req.header("X-API-Key");

	// Prefer Bearer token if both are provided
	if (authHeader?.startsWith("Bearer ")) {
		const token = authHeader.slice(7);
		const payload = verifyAccessToken(token);

		if (payload) {
			c.set("userId", payload.userId);
			c.set("userRole", payload.userRole);
			c.set("clientId", payload.clientId);
			c.set("authType", "bearer");
			await next();
			return;
		}
	}

	// Fall back to API key
	if (apiKey) {
		// Check for root key
		const rootKey = process.env.API_KEY || Bun.env?.API_KEY;

		if (rootKey && apiKey === rootKey) {
			c.set("apiKeyType", "root");
			c.set("userId", "root");
			c.set("userRole", "admin" as UserRole);
			c.set("authType", "apikey");
			await next();
			return;
		}

		// Validate format and get key
		if (isValidApiKeyFormat(apiKey)) {
			const keyData = await getApiKey(apiKey);

			if (keyData) {
				// Fetch user to get role
				const user = await db.query.users.findFirst({
					where: eq(users.id, keyData.userId),
				});

				c.set("apiKeyId", keyData.id);
				c.set("userId", keyData.userId);
				c.set("userRole", user?.role || 'authenticated');
				c.set("apiKeyType", "database");
				c.set("authType", "apikey");
				await next();
				return;
			}
		}
	}

	return c.json(
		{ error: "Authentication required. Provide either Bearer token or API key" },
		401,
	);
}

/**
 * Role checking middleware
 * Use after auth middleware to check if the user has required role level
 */
export function requireRole(minRole: UserRole) {
	return async (c: Context, next: Next) => {
		const userRole = c.get("userRole") as UserRole | undefined;

		if (!userRole) {
			return c.json(
				{ error: "Authentication required" },
				401,
			);
		}

		// Define role hierarchy
		const roleHierarchy: Record<UserRole | 'public', number> = {
			'public': 0,
			'authenticated': 1,
			'member': 2,
			'admin': 3,
		};

		// Handle public/unauthenticated case
		const currentLevel = roleHierarchy[userRole] ?? 0;
		const requiredLevel = roleHierarchy[minRole] ?? 1;

		if (currentLevel < requiredLevel) {
			return c.json(
				{
					error: "Insufficient permissions",
					required: minRole,
					current: userRole,
				},
				403,
			);
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

export const requireAuth = requireRole('authenticated');
export const requireMembership = requireRole('member');
export const requireAdmin = requireRole('admin');

// Export old function names for backward compatibility (will be removed)
export const requireJwtAuth = bearerAuth;
export const withJwtAuth = optionalBearerAuth;
export const requireFullAuth = combinedAuth;