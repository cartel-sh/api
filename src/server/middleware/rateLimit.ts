import type { Context, Next } from "hono";

interface RateLimitConfig {
	windowMs: number; // Time window in milliseconds
	maxRequests: number; // Max requests per window
	keyGenerator?: (c: Context) => string; // Function to generate rate limit key
	message?: string; // Error message when rate limited
	skipSuccessfulRequests?: boolean; // Only count failed requests
	skipFailedRequests?: boolean; // Only count successful requests
}

interface RateLimitEntry {
	count: number;
	resetTime: number;
}

// In-memory store for rate limits (consider Redis for production)
class RateLimitStore {
	private store = new Map<string, RateLimitEntry>();
	private cleanupInterval: Timer;

	constructor() {
		// Clean up expired entries every minute
		this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
	}

	increment(key: string, windowMs: number): { count: number; remaining: number; resetTime: number } {
		const now = Date.now();
		const entry = this.store.get(key);

		if (!entry || entry.resetTime <= now) {
			// New window
			const resetTime = now + windowMs;
			this.store.set(key, { count: 1, resetTime });
			return { count: 1, remaining: 0, resetTime };
		}

		// Increment existing window
		entry.count++;
		return { count: entry.count, remaining: 0, resetTime: entry.resetTime };
	}

	getCount(key: string): number {
		const now = Date.now();
		const entry = this.store.get(key);

		if (!entry || entry.resetTime <= now) {
			return 0;
		}

		return entry.count;
	}

	cleanup() {
		const now = Date.now();
		for (const [key, entry] of this.store.entries()) {
			if (entry.resetTime <= now) {
				this.store.delete(key);
			}
		}
	}

	destroy() {
		clearInterval(this.cleanupInterval);
		this.store.clear();
	}
}

// Global store instance
const globalStore = new RateLimitStore();

/**
 * Default key generator - uses IP address or user ID
 */
function defaultKeyGenerator(c: Context): string {
	// Prefer authenticated user ID
	const userId = c.get("userId");
	if (userId && userId !== "root") {
		return `user:${userId}`;
	}

	// Fall back to API key ID
	const apiKeyId = c.get("apiKeyId");
	if (apiKeyId) {
		return `apikey:${apiKeyId}`;
	}

	// Fall back to IP address
	const forwardedFor = c.req.header("x-forwarded-for");
	const ip = forwardedFor ? forwardedFor.split(",")[0]?.trim() || "unknown" : 
		(c.req.header("x-real-ip") || "unknown");
	
	return `ip:${ip}`;
}

/**
 * Rate limiting middleware
 */
export function rateLimit(config: RateLimitConfig) {
	const {
		windowMs,
		maxRequests,
		keyGenerator = defaultKeyGenerator,
		message = "Too many requests, please try again later",
		skipSuccessfulRequests = false,
		skipFailedRequests = false,
	} = config;

	return async (c: Context, next: Next) => {
		const key = keyGenerator(c);
		const count = globalStore.getCount(key);

		// Check if already rate limited
		if (count >= maxRequests) {
			return c.json({
				error: message,
				retryAfter: Math.ceil(windowMs / 1000),
			}, 429);
		}

		// Set rate limit headers
		c.header("X-RateLimit-Limit", String(maxRequests));
		c.header("X-RateLimit-Remaining", String(Math.max(0, maxRequests - count - 1)));
		c.header("X-RateLimit-Reset", String(Math.ceil((Date.now() + windowMs) / 1000)));

		// Process request
		await next();

		// Increment counter based on response status
		const status = c.res.status;
		const isSuccess = status >= 200 && status < 400;

		if ((isSuccess && !skipSuccessfulRequests) || (!isSuccess && !skipFailedRequests)) {
			const result = globalStore.increment(key, windowMs);
			
			// Update headers with actual values
			c.header("X-RateLimit-Remaining", String(Math.max(0, maxRequests - result.count)));
			c.header("X-RateLimit-Reset", String(Math.ceil(result.resetTime / 1000)));
		}
	};
}

// Preset configurations
export const rateLimits = {
	// Strict limit for auth endpoints
	auth: rateLimit({
		windowMs: 15 * 60 * 1000, // 15 minutes
		maxRequests: 5, // 5 requests per 15 minutes
		message: "Too many authentication attempts, please try again later",
	}),

	// Standard API limit
	api: rateLimit({
		windowMs: 60 * 1000, // 1 minute
		maxRequests: 60, // 60 requests per minute
	}),

	// Relaxed limit for read operations
	read: rateLimit({
		windowMs: 60 * 1000, // 1 minute
		maxRequests: 100, // 100 requests per minute
	}),

	// Strict limit for write operations
	write: rateLimit({
		windowMs: 60 * 1000, // 1 minute
		maxRequests: 20, // 20 requests per minute
	}),

	// Very strict limit for sensitive operations
	sensitive: rateLimit({
		windowMs: 60 * 60 * 1000, // 1 hour
		maxRequests: 10, // 10 requests per hour
	}),
};

/**
 * Dynamic rate limit based on auth type and scopes
 */
export function dynamicRateLimit() {
	return async (c: Context, next: Next) => {
		const authType = c.get("authType");
		const scopes = c.get("userScopes") || c.get("apiKeyScopes") || [];

		let config: RateLimitConfig;

		// Root/admin gets higher limits
		if (scopes.includes("root") || scopes.includes("admin")) {
			config = {
				windowMs: 60 * 1000,
				maxRequests: 1000,
			};
		}
		// API keys get standard limits
		else if (authType === "apikey") {
			config = {
				windowMs: 60 * 1000,
				maxRequests: 100,
			};
		}
		// Bearer tokens get lower limits
		else if (authType === "bearer") {
			config = {
				windowMs: 60 * 1000,
				maxRequests: 60,
			};
		}
		// Unauthenticated gets strict limits
		else {
			config = {
				windowMs: 60 * 1000,
				maxRequests: 20,
				message: "Rate limit exceeded. Please authenticate for higher limits",
			};
		}

		const middleware = rateLimit(config);
		return middleware(c, next);
	};
}