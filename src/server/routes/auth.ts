import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { SiweMessage } from "siwe";
import { db, users, userIdentities, apiKeys } from "../../client";
import { eq, and, or, isNull, gte } from "drizzle-orm";
import {
	hashApiKey,
	getApiKeyPrefix,
	isValidApiKeyFormat,
} from "../utils/crypto";
import {
	createAccessToken,
	createRefreshToken,
	generateSecureToken,
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
};

const app = new OpenAPIHono<{ Variables: Variables }>();

const verifyRoute = createRoute({
	method: "post",
	path: "/verify",
	description: "Verify SIWE (Sign-In with Ethereum) message and signature to authenticate user. Returns JWT access token and refresh token for API authentication.",
	summary: "Authenticate with SIWE",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						message: z.string().describe("SIWE message string"),
						signature: z.string().describe("Signature from wallet"),
					}),
				},
			},
		},
		headers: z.object({
			"X-API-Key": z.string().optional(),
		}),
	},
	responses: {
		200: {
			description: "Successfully authenticated",
			content: {
				"application/json": {
					schema: z.object({
						accessToken: z.string().describe("JWT access token"),
						refreshToken: z.string().describe("Refresh token for getting new access tokens"),
						expiresIn: z.number().describe("Access token expiry in seconds"),
						tokenType: z.literal("Bearer"),
						userId: z.string(),
						address: z.string(),
						clientName: z.string().optional(),
					}),
				},
			},
		},
		400: {
			description: "Bad request",
			content: {
				"application/json": {
					schema: z.object({
						error: z.string(),
						message: z.string().optional(),
					}),
				},
			},
		},
		401: {
			description: "Unauthorized",
			content: {
				"application/json": {
					schema: z.object({
						error: z.string(),
					}),
				},
			},
		},
		500: {
			description: "Internal server error",
			content: {
				"application/json": {
					schema: z.object({
						error: z.string(),
					}),
				},
			},
		},
	},
	tags: ["Authentication"],
});

app.openapi(verifyRoute, async (c) => {
	const { message, signature } = c.req.valid("json");
	const apiKey = c.req.header("X-API-Key");

	if (!apiKey) {
		return c.json({ error: "API key required" }, 401);
	}

	try {
		const siweMessage = new SiweMessage(message);

		if (!isValidApiKeyFormat(apiKey)) {
			return c.json({ error: "Invalid API key format" }, 401);
		}

		const keyPrefix = getApiKeyPrefix(apiKey);
		const keyHash = hashApiKey(apiKey);
		const now = new Date();

		const apiKeyData = await db.query.apiKeys.findFirst({
			where: and(
				eq(apiKeys.keyPrefix, keyPrefix),
				eq(apiKeys.keyHash, keyHash),
				eq(apiKeys.isActive, true),
				or(isNull(apiKeys.expiresAt), gte(apiKeys.expiresAt, now)),
			),
		});

		if (!apiKeyData) {
			return c.json({ error: "Invalid API key" }, 401);
		}

		const clientId = apiKeyData.id;
		const clientName = apiKeyData.clientName || undefined;
		const allowedOrigins = apiKeyData.allowedOrigins || [];

		db.update(apiKeys)
			.set({ lastUsedAt: now })
			.where(eq(apiKeys.id, apiKeyData.id))
			.execute()
			.catch(console.error);

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
		const result = await siweMessage.verify({ signature });

		if (!result.success) {
			return c.json({ error: "Invalid signature" }, 401);
		}

		const address = siweMessage.address.toLowerCase();

		// Find or create user
		let identity = await db.query.userIdentities.findFirst({
			where: and(
				eq(userIdentities.platform, "evm"),
				eq(userIdentities.identity, address),
			),
			with: {
				user: true,
			},
		});

		let userId: string;

		if (!identity) {
			const [newUser] = await db.insert(users).values({}).returning();
			if (!newUser) {
				throw new Error("Failed to create user");
			}
			userId = newUser.id;

			await db.insert(userIdentities).values({
				userId,
				platform: "evm",
				identity: address,
				isPrimary: true,
			});
		} else {
			userId = identity.userId;
		}

		const accessToken = await createAccessToken(userId, ["read", "write"], clientId);
		const familyId = generateSecureToken(); // New family for new login
		const refreshToken = await createRefreshToken(userId, familyId, clientId);

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
		console.error("SIWE verification error:", error);
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
					schema: z.object({
						refreshToken: z.string().describe("The refresh token"),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			description: "Successfully refreshed tokens",
			content: {
				"application/json": {
					schema: z.object({
						accessToken: z.string(),
						refreshToken: z.string(),
						expiresIn: z.number(),
						tokenType: z.literal("Bearer"),
					}),
				},
			},
		},
		401: {
			description: "Invalid or expired refresh token",
			content: {
				"application/json": {
					schema: z.object({
						error: z.string(),
					}),
				},
			},
		},
	},
	tags: ["Authentication"],
});

app.openapi(refreshRoute, async (c) => {
	const { refreshToken } = c.req.valid("json");

	const result = await rotateRefreshToken(refreshToken);

	if (!result) {
		return c.json({ error: "Invalid or expired refresh token" }, 401);
	}

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
					schema: z.object({
						userId: z.string(),
						address: z.string().optional(),
						user: z.any(),
						scopes: z.array(z.string()),
					}),
				},
			},
		},
		401: {
			description: "Not authenticated or invalid token",
			content: {
				"application/json": {
					schema: z.object({
						error: z.string(),
					}),
				},
			},
		},
		404: {
			description: "User not found",
			content: {
				"application/json": {
					schema: z.object({
						error: z.string(),
					}),
				},
			},
		},
	},
	tags: ["Authentication"],
});

app.openapi(getMeRoute, async (c) => {
	const authHeader = c.req.header("Authorization");
	
	if (!authHeader?.startsWith("Bearer ")) {
		return c.json({ error: "Not authenticated" }, 401);
	}

	const token = authHeader.slice(7);
	const payload = verifyAccessToken(token);

	if (!payload) {
		return c.json({ error: "Invalid or expired token" }, 401);
	}

	const user = await db.query.users.findFirst({
		where: eq(users.id, payload.userId),
		with: {
			identities: {
				where: eq(userIdentities.platform, "evm"),
			},
		},
	});

	if (!user) {
		return c.json({ error: "User not found" }, 404);
	}

	// Get primary EVM address if exists
	const primaryIdentity = user.identities.find(i => i.isPrimary);
	const address = primaryIdentity?.identity;

	return c.json(
		{
			userId: payload.userId,
			address,
			user,
			scopes: payload.scopes,
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
					schema: z.object({
						message: z.string(),
					}),
				},
			},
		},
		401: {
			description: "Not authenticated",
			content: {
				"application/json": {
					schema: z.object({
						error: z.string(),
					}),
				},
			},
		},
	},
	tags: ["Authentication"],
});

app.openapi(revokeRoute, async (c) => {
	const authHeader = c.req.header("Authorization");
	
	if (!authHeader?.startsWith("Bearer ")) {
		return c.json({ error: "Not authenticated" }, 401);
	}

	const token = authHeader.slice(7);
	const payload = verifyAccessToken(token);

	if (!payload) {
		return c.json({ error: "Invalid or expired token" }, 401);
	}

	await revokeAllUserTokens(payload.userId);

	return c.json({ message: "All tokens revoked successfully" }, 200);
});


export default app;