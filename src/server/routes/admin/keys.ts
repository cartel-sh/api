import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { eq, desc } from "drizzle-orm";
import { db, apiKeys, users } from "../../../client";
import {
	generateApiKey,
	hashApiKey,
	getApiKeyPrefix,
} from "../../utils/crypto";
import { requireJwtAuth } from "../../middleware/auth";

const app = new OpenAPIHono();

app.use("*", requireJwtAuth);

const createApiKeyRoute = createRoute({
	method: "post",
	path: "/",
	middleware: [requireJwtAuth],
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						userId: z.string().uuid(),
						name: z.string().min(1).max(100),
						description: z.string().optional(),
						scopes: z.array(z.string()).default(["read", "write"]),
						clientName: z.string().optional(),
						allowedOrigins: z.array(z.string()).optional(),
						expiresIn: z
							.number()
							.optional()
							.describe("Seconds until expiration"),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			description: "Success",
			content: {
				"application/json": {
					schema: z.any(),
				},
			},
		},
		404: {
			description: "Not found",
			content: {
				"application/json": {
					schema: z.any(),
				},
			},
		},
		500: {
			description: "Internal server error",
			content: {
				"application/json": {
					schema: z.any(),
				},
			},
		},
	},
	tags: ["Admin"],
});

app.openapi(createApiKeyRoute, async (c) => {
	const {
		userId,
		name,
		description,
		scopes,
		clientName,
		allowedOrigins,
		expiresIn,
	} = c.req.valid("json");

	try {
		const user = await db.query.users.findFirst({
			where: eq(users.id, userId),
		});

		if (!user) {
			return c.json({ error: "User not found" }, 404);
		}

		const apiKey = generateApiKey();
		const keyPrefix = getApiKeyPrefix(apiKey);
		const keyHash = hashApiKey(apiKey);

		const expiresAt = expiresIn
			? new Date(Date.now() + expiresIn * 1000)
			: null;

		const result = await db
			.insert(apiKeys)
			.values({
				userId,
				name,
				description,
				keyPrefix,
				keyHash,
				scopes,
				clientName,
				allowedOrigins,
				expiresAt,
			})
			.returning();

		const newKey = result[0];
		if (!newKey) {
			return c.json({ error: "Failed to create API key" }, 500);
		}

		return c.json({
			id: newKey.id,
			userId: newKey.userId,
			name: newKey.name,
			description: newKey.description,
			scopes: newKey.scopes,
			expiresAt: newKey.expiresAt,
			apiKey,
			message: "Save this API key securely. It will not be shown again.",
		});
	} catch (error) {
		console.error("[API] Error creating API key:", error);
		return c.json({ error: "Failed to create API key" }, 500);
	}
});

app.get("/", async (c) => {
	const userId = c.req.query("userId");

	try {
		let keys: any[];

		if (userId) {
			keys = await db.query.apiKeys.findMany({
				where: eq(apiKeys.userId, userId),
				orderBy: [desc(apiKeys.createdAt)],
				with: {
					user: {
						with: {
							identities: true,
						},
					},
				},
			});
		} else {
			keys = await db.query.apiKeys.findMany({
				orderBy: [desc(apiKeys.createdAt)],
				with: {
					user: {
						with: {
							identities: true,
						},
					},
				},
			});
		}

		const sanitizedKeys = keys.map((key) => ({
			id: key.id,
			userId: key.userId,
			name: key.name,
			description: key.description,
			keyPrefix: `cartel_${key.keyPrefix}...`,
			scopes: key.scopes,
			lastUsedAt: key.lastUsedAt,
			expiresAt: key.expiresAt,
			isActive: key.isActive,
			createdAt: key.createdAt,
			user: key.user
				? {
						id: key.user.id,
						identities: key.user.identities,
					}
				: undefined,
		}));

		return c.json(sanitizedKeys);
	} catch (error) {
		console.error("[API] Error listing API keys:", error);
		return c.json({ error: "Failed to list API keys" }, 500);
	}
});

app.get("/:id", async (c) => {
	const keyId = c.req.param("id");

	try {
		const key = await db.query.apiKeys.findFirst({
			where: eq(apiKeys.id, keyId),
			with: {
				user: {
					with: {
						identities: true,
					},
				},
			},
		});

		if (!key) {
			return c.json({ error: "API key not found" }, 404);
		}

		return c.json({
			id: key.id,
			userId: key.userId,
			name: key.name,
			description: key.description,
			keyPrefix: `cartel_${key.keyPrefix}...`,
			scopes: key.scopes,
			lastUsedAt: key.lastUsedAt,
			expiresAt: key.expiresAt,
			isActive: key.isActive,
			createdAt: key.createdAt,
			updatedAt: key.updatedAt,
			user: {
				id: key.user.id,
				identities: key.user.identities,
			},
		});
	} catch (error) {
		console.error("[API] Error getting API key:", error);
		return c.json({ error: "Failed to get API key" }, 500);
	}
});

const updateApiKeyRoute = createRoute({
	method: "patch",
	path: "/{id}",
	middleware: [requireJwtAuth],
	request: {
		params: z.object({
			id: z.string(),
		}),
		body: {
			content: {
				"application/json": {
					schema: z.object({
						name: z.string().min(1).max(100).optional(),
						description: z.string().optional(),
						scopes: z.array(z.string()).optional(),
						isActive: z.boolean().optional(),
						expiresAt: z.string().datetime().nullable().optional(),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			description: "Success",
			content: {
				"application/json": {
					schema: z.any(),
				},
			},
		},
		404: {
			description: "Not found",
			content: {
				"application/json": {
					schema: z.any(),
				},
			},
		},
		500: {
			description: "Internal server error",
			content: {
				"application/json": {
					schema: z.any(),
				},
			},
		},
	},
	tags: ["Admin"],
});

app.openapi(updateApiKeyRoute, async (c) => {
	const keyId = c.req.valid("param").id;
	const updates = c.req.valid("json");

	try {
		const [updated] = await db
			.update(apiKeys)
			.set({
				...updates,
				expiresAt: updates.expiresAt ? new Date(updates.expiresAt) : undefined,
				updatedAt: new Date(),
			})
			.where(eq(apiKeys.id, keyId))
			.returning();

		if (!updated) {
			return c.json({ error: "API key not found" }, 404);
		}

		return c.json({
			id: updated.id,
			name: updated.name,
			description: updated.description,
			scopes: updated.scopes,
			isActive: updated.isActive,
			expiresAt: updated.expiresAt,
		});
	} catch (error) {
		console.error("[API] Error updating API key:", error);
		return c.json({ error: "Failed to update API key" }, 500);
	}
});

app.delete("/:id", async (c) => {
	const keyId = c.req.param("id");

	try {
		const [deactivated] = await db
			.update(apiKeys)
			.set({
				isActive: false,
				updatedAt: new Date(),
			})
			.where(eq(apiKeys.id, keyId))
			.returning();

		if (!deactivated) {
			return c.json({ error: "API key not found" }, 404);
		}

		return c.json({
			success: true,
			message: "API key deactivated successfully",
		});
	} catch (error) {
		console.error("[API] Error deactivating API key:", error);
		return c.json({ error: "Failed to deactivate API key" }, 500);
	}
});

app.post("/:id/rotate", async (c) => {
	const keyId = c.req.param("id");
	const gracePeriod = parseInt(c.req.query("gracePeriod") || "300");

	try {
		const existingKey = await db.query.apiKeys.findFirst({
			where: eq(apiKeys.id, keyId),
		});

		if (!existingKey) {
			return c.json({ error: "API key not found" }, 404);
		}

		// Generate new key
		const newApiKey = generateApiKey();
		const newKeyPrefix = getApiKeyPrefix(newApiKey);
		const newKeyHash = hashApiKey(newApiKey);

		await db.transaction(async (tx) => {
			await tx
				.update(apiKeys)
				.set({
					expiresAt: new Date(Date.now() + gracePeriod * 1000),
					updatedAt: new Date(),
				})
				.where(eq(apiKeys.id, keyId));

			await tx.insert(apiKeys).values({
				userId: existingKey.userId,
				name: `${existingKey.name} (rotated)`,
				description: `Rotated from ${existingKey.keyPrefix}`,
				keyPrefix: newKeyPrefix,
				keyHash: newKeyHash,
				scopes: existingKey.scopes,
				clientName: existingKey.clientName,
				allowedOrigins: existingKey.allowedOrigins,
				expiresAt: existingKey.expiresAt,
			});
		});

		return c.json({
			newApiKey,
			message: `New API key generated. Old key will expire in ${gracePeriod} seconds.`,
			expiresAt: new Date(Date.now() + gracePeriod * 1000),
		});
	} catch (error) {
		console.error("[API] Error rotating API key:", error);
		return c.json({ error: "Failed to rotate API key" }, 500);
	}
});

export default app;
