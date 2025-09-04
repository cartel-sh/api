import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { SiweMessage } from "siwe";
import { db, users, apiKeys } from "../../client";
import { eq, and, or, isNull, gte } from "drizzle-orm";
import { requestLogging } from "../middleware/logging";
import { resolveENSProfile } from "../utils/ens";
import {
	AuthResponseSchema,
	RefreshResponseSchema,
	SiweVerifyRequestSchema,
	ErrorResponseSchema,
	ErrorWithMessageResponseSchema,
	AuthHeadersSchema,
	RefreshTokenRequestSchema,
	UserMeResponseSchema,
	RevokeTokensResponseSchema,
} from "../../shared/schemas";
import {
	hashApiKey,
	getApiKeyPrefix,
	isValidApiKeyFormat,
} from "../utils/crypto";
import {
	createAccessToken,
	createRefreshToken,
	rotateRefreshToken,
	revokeAllUserTokens,
	verifyAccessToken,
} from "../utils/tokens";

type Variables = {
	userId?: string;
	userAddress?: string;
	apiKeyId?: string;
	clientName?: string;
	allowedOrigins?: string[];
	logger?: any;
};

const app = new OpenAPIHono<{ Variables: Variables }>();

// Add logging middleware
app.use("*", requestLogging());

const verifyRoute = createRoute({
	method: "post",
	path: "/verify",
	description: "Verify SIWE (Sign-In with Ethereum) message and signature to authenticate user. Returns JWT access token and refresh token for API authentication.",
	summary: "Authenticate with SIWE",
	request: {
		body: {
			content: {
				"application/json": {
					schema: SiweVerifyRequestSchema,
				},
			},
		},
		headers: AuthHeadersSchema,
	},
	responses: {
		200: {
			description: "Successfully authenticated",
			content: {
				"application/json": {
					schema: AuthResponseSchema,
				},
			},
		},
		400: {
			description: "Bad request",
			content: {
				"application/json": {
					schema: ErrorWithMessageResponseSchema,
				},
			},
		},
		401: {
			description: "Unauthorized",
			content: {
				"application/json": {
					schema: ErrorResponseSchema,
				},
			},
		},
		500: {
			description: "Internal server error",
			content: {
				"application/json": {
					schema: ErrorResponseSchema,
				},
			},
		},
	},
	tags: ["Authentication"],
});

app.openapi(verifyRoute, async (c) => {
	const logger = c.get("logger");
	const { message, signature } = c.req.valid("json");
	const apiKey = c.req.header("X-API-Key");

	logger.info("SIWE verification attempt", {
		domain: message.match(/URI: (.+)/)?.[1],
		hasSignature: !!signature,
		hasApiKey: !!apiKey,
	});

	if (!apiKey) {
		logger.warn("SIWE verification failed: missing API key");
		return c.json({ error: "API key required" }, 401);
	}

	try {
		const siweMessage = new SiweMessage(message);
		logger.debug("Parsed SIWE message", {
			address: siweMessage.address,
			domain: siweMessage.domain,
			chainId: siweMessage.chainId,
		});

		if (!isValidApiKeyFormat(apiKey)) {
			logger.warn("SIWE verification failed: invalid API key format");
			return c.json({ error: "Invalid API key format" }, 401);
		}

		const keyPrefix = getApiKeyPrefix(apiKey);
		const keyHash = hashApiKey(apiKey);
		const now = new Date();

		logger.logDatabase("query", "apiKeys", { keyPrefix });

		const apiKeyData = await db.query.apiKeys.findFirst({
			where: and(
				eq(apiKeys.keyPrefix, keyPrefix),
				eq(apiKeys.keyHash, keyHash),
				eq(apiKeys.isActive, true),
				or(isNull(apiKeys.expiresAt), gte(apiKeys.expiresAt, now)),
			),
		});

		if (!apiKeyData) {
			logger.warn("SIWE verification failed: API key not found or expired", {
				keyPrefix,
			});
			return c.json({ error: "Invalid API key" }, 401);
		}

		logger.info("API key validated", {
			clientName: apiKeyData.clientName,
			keyPrefix,
		});

		const clientName = apiKeyData.clientName || undefined;
		const allowedOrigins = apiKeyData.allowedOrigins || [];

		db.update(apiKeys)
			.set({ lastUsedAt: now })
			.where(eq(apiKeys.id, apiKeyData.id))
			.execute()
			.catch((error) => logger.error("Failed to update API key last used timestamp", error));

		// Validate allowed origins
		if (allowedOrigins.length > 0) {
			const isValidOrigin = allowedOrigins.some((origin) => {
				if (siweMessage.domain === origin) return true;
				if (siweMessage.uri && siweMessage.uri.startsWith(origin)) return true;
				if (origin.startsWith("*.")) {
					const baseDomain = origin.slice(2);
					return siweMessage.domain.endsWith(baseDomain);
				}
				return false;
			});

			if (!isValidOrigin) {
				return c.json(
					{
						error: "Invalid domain/URI",
						message: `Domain ${siweMessage.domain} not in allowed origins`,
					},
					400,
				);
			}
		}

		// Validate message timestamps
		if (siweMessage.expirationTime) {
			const expiry = new Date(siweMessage.expirationTime);
			if (expiry < now) {
				return c.json({ error: "Message expired" }, 400);
			}
		}
		if (siweMessage.notBefore) {
			const notBefore = new Date(siweMessage.notBefore);
			if (notBefore > now) {
				return c.json({ error: "Message not yet valid" }, 400);
			}
		}

		// Verify signature
		logger.debug("Verifying SIWE signature");
		const result = await siweMessage.verify({ signature });

		if (!result.success) {
			logger.warn("SIWE signature verification failed", {
				address: siweMessage.address,
			});
			return c.json({ error: "Invalid signature" }, 401);
		}

		const address = siweMessage.address.toLowerCase();
		logger.info("SIWE signature verified successfully", { address });

		// Find or create user by address
		logger.logDatabase("query", "users", { address });
		let user = await db.query.users.findFirst({
			where: eq(users.address, address),
		});

		let userId: string;

		logger.info("Resolving ENS profile for address", { address });
		const ensProfile = await resolveENSProfile(address);
		logger.info("ENS profile resolved", { 
			address, 
			ensName: ensProfile.name,
			hasAvatar: !!ensProfile.avatar 
		});

		if (!user) {
			logger.info("Creating new user for address", { address });
			logger.logDatabase("insert", "users");
			const [newUser] = await db.insert(users).values({
				address,
				ensName: ensProfile.name,
				ensAvatar: ensProfile.avatar,
			}).returning();
			if (!newUser) {
				throw new Error("Failed to create user");
			}
			userId = newUser.id;

			logger.info("New user created", { userId, address, ensName: ensProfile.name });
		} else {
			userId = user.id;
			logger.debug("Existing user found", { userId, address });
			
			const currentEnsName = user.ensName;
			const currentEnsAvatar = user.ensAvatar;
			
			if (currentEnsName !== ensProfile.name || currentEnsAvatar !== ensProfile.avatar) {
				logger.info("Updating ENS information for user", { 
					userId, 
					oldEnsName: currentEnsName,
					newEnsName: ensProfile.name,
					hasNewAvatar: !!ensProfile.avatar
				});
				
				await db.update(users)
					.set({
						ensName: ensProfile.name,
						ensAvatar: ensProfile.avatar,
						updatedAt: new Date(),
					})
					.where(eq(users.id, userId));
			}
		}

		logger.debug("Creating access and refresh tokens", { userId });
		const accessToken = await createAccessToken(userId, clientName);
		const familyId = crypto.randomUUID(); 
		const refreshToken = await createRefreshToken(userId, familyId, clientName);

		logger.logAuth("login_success", userId, {
			address,
			clientName: apiKeyData.clientName,
			familyId,
		});

		return c.json(
			{
				accessToken: accessToken.token,
				refreshToken: refreshToken.token,
				expiresIn: accessToken.expiresIn,
				tokenType: "Bearer" as const,
				userId,
				address,
				clientName,
			},
			200,
		);
	} catch (error) {
		logger.error("SIWE verification error", error);
		return c.json({ error: "Authentication failed" }, 500);
	}
});

const refreshRoute = createRoute({
	method: "post",
	path: "/refresh",
	description: "Exchange a refresh token for new access and refresh tokens. Implements token rotation for security - the old refresh token is invalidated.",
	summary: "Refresh access token",
	request: {
		body: {
			content: {
				"application/json": {
					schema: RefreshTokenRequestSchema,
				},
			},
		},
	},
	responses: {
		200: {
			description: "Successfully refreshed tokens",
			content: {
				"application/json": {
					schema: RefreshResponseSchema,
				},
			},
		},
		401: {
			description: "Invalid or expired refresh token",
			content: {
				"application/json": {
					schema: ErrorResponseSchema,
				},
			},
		},
	},
	tags: ["Authentication"],
});

app.openapi(refreshRoute, async (c) => {
	const logger = c.get("logger");
	const { refreshToken } = c.req.valid("json");

	logger.info("Token refresh attempt");

	const result = await rotateRefreshToken(refreshToken);

	if (!result) {
		logger.warn("Token refresh failed: invalid or expired refresh token");
		return c.json({ error: "Invalid or expired refresh token" }, 401);
	}

	logger.logAuth("token_refresh", undefined, {
		success: true,
	});

	return c.json(
		{
			accessToken: result.accessToken,
			refreshToken: result.refreshToken,
			expiresIn: result.expiresIn,
			tokenType: "Bearer" as const,
		},
		200,
	);
});

const getMeRoute = createRoute({
	method: "get",
	path: "/me",
	description: "Retrieve information about the currently authenticated user. Requires a valid bearer token in the Authorization header.",
	summary: "Get current user",
	security: [
		{
			bearerAuth: [],
		},
	],
	responses: {
		200: {
			description: "Current user information",
			content: {
				"application/json": {
					schema: UserMeResponseSchema,
				},
			},
		},
		401: {
			description: "Not authenticated or invalid token",
			content: {
				"application/json": {
					schema: ErrorResponseSchema,
				},
			},
		},
		404: {
			description: "User not found",
			content: {
				"application/json": {
					schema: ErrorResponseSchema,
				},
			},
		},
	},
	tags: ["Authentication"],
});

app.openapi(getMeRoute, async (c) => {
	const logger = c.get("logger");
	const authHeader = c.req.header("Authorization");
	
	logger.info("Get user profile request");

	if (!authHeader?.startsWith("Bearer ")) {
		logger.warn("Get user profile failed: missing or invalid auth header");
		return c.json({ error: "Not authenticated" }, 401);
	}

	const token = authHeader.slice(7);
	const payload = verifyAccessToken(token);

	if (!payload) {
		logger.warn("Get user profile failed: invalid or expired token");
		return c.json({ error: "Invalid or expired token" }, 401);
	}

	logger.logDatabase("query", "users", { userId: payload.userId });
	const user = await db.query.users.findFirst({
		where: eq(users.id, payload.userId),
	});

	if (!user) {
		logger.warn("Get user profile failed: user not found", {
			userId: payload.userId,
		});
		return c.json({ error: "User not found" }, 404);
	}

	const address = user.address;

	logger.info("User profile retrieved successfully", {
		userId: payload.userId,
		hasAddress: !!address,
	});

	return c.json(
		{
			userId: payload.userId,
			address: address || undefined,
			user,
		},
		200,
	);
});

const revokeRoute = createRoute({
	method: "post",
	path: "/revoke",
	description: "Revoke all refresh tokens for the authenticated user. Useful for logout across all devices or when tokens may be compromised. Requires a valid bearer token.",
	summary: "Revoke all tokens",
	security: [
		{
			bearerAuth: [],
		},
	],
	responses: {
		200: {
			description: "Successfully revoked tokens",
			content: {
				"application/json": {
					schema: RevokeTokensResponseSchema,
				},
			},
		},
		401: {
			description: "Not authenticated",
			content: {
				"application/json": {
					schema: ErrorResponseSchema,
				},
			},
		},
	},
	tags: ["Authentication"],
});

app.openapi(revokeRoute, async (c) => {
	const logger = c.get("logger");
	const authHeader = c.req.header("Authorization");
	
	logger.info("Token revocation request");

	if (!authHeader?.startsWith("Bearer ")) {
		logger.warn("Token revocation failed: missing or invalid auth header");
		return c.json({ error: "Not authenticated" }, 401);
	}

	const token = authHeader.slice(7);
	const payload = verifyAccessToken(token);

	if (!payload) {
		logger.warn("Token revocation failed: invalid or expired token");
		return c.json({ error: "Invalid or expired token" }, 401);
	}

	logger.info("Revoking all tokens for user", { userId: payload.userId });
	await revokeAllUserTokens(payload.userId);

	logger.logAuth("token_revoke_all", payload.userId, {
		success: true,
	});

	return c.json({ message: "All tokens revoked successfully" }, 200);
});


export default app;