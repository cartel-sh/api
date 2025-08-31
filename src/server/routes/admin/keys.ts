import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { eq, desc } from "drizzle-orm";
import { db, apiKeys, users } from "../../../client";
import {
	generateApiKey,
	hashApiKey,
	getApiKeyPrefix,
} from "../../utils/crypto";
import { requireJwtAuth } from "../../middleware/auth";
import { requestLogging } from "../../middleware/logging";

type Variables = {
	userId?: string;
	logger?: any;
};

const app = new OpenAPIHono<{ Variables: Variables }>();

app.use("*", requestLogging());
app.use("*", requireJwtAuth);

const createApiKeyRoute = createRoute({
	method: "post",
	path: "/",
	summary: "Create API Key",
	description: "Creates a new API key for a user with specified permissions and settings (requires authentication).",
	middleware: [requireJwtAuth],
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						userId: z.string().uuid(),
						name: z.string().min(1).max(100),
						description: z.string().optional(),
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
					schema: z.object({
						id: z.string(),
						userId: z.string(),
						name: z.string(),
						description: z.string().optional(),
						clientName: z.string().optional(),
						allowedOrigins: z.array(z.string()).optional(),
						expiresAt: z.string().datetime().nullable(),
						apiKey: z.string(),
						message: z.string(),
					}),
				},
			},
		},
		404: {
			description: "Not found",
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
	tags: ["Admin"],
});

app.openapi(createApiKeyRoute, async (c) => {
	const logger = c.get("logger");
	const {
		userId,
		name,
		description,
		clientName,
		allowedOrigins,
		expiresIn,
	} = c.req.valid("json");

	logger.info("Admin creating API key", {
		userId,
		name,
		clientName,
		hasDescription: !!description,
		allowedOriginsCount: allowedOrigins?.length || 0,
		expiresIn,
	});

	try {
		logger.logDatabase("query", "users", { userId });
		const user = await db.query.users.findFirst({
			where: eq(users.id, userId),
		});

		if (!user) {
			logger.warn("API key creation failed: user not found", { userId });
			return c.json({ error: "User not found" }, 404);
		}

		const apiKey = generateApiKey();
		const keyPrefix = getApiKeyPrefix(apiKey);
		const keyHash = hashApiKey(apiKey);

		const expiresAt = expiresIn
			? new Date(Date.now() + expiresIn * 1000)
			: null;

		logger.logDatabase("insert", "apiKeys", {
			userId,
			name,
			clientName,
			keyPrefix,
			hasExpiration: !!expiresAt,
		});
		const result = await db
			.insert(apiKeys)
			.values({
				userId,
				name,
				description,
				keyPrefix,
				keyHash,
				clientName,
				allowedOrigins,
				expiresAt,
			})
			.returning();

		const newKey = result[0];
		if (!newKey) {
			logger.error("API key creation failed: database insert returned no result");
			return c.json({ error: "Failed to create API key" }, 500);
		}

		logger.info("API key created successfully", {
			keyId: newKey.id,
			userId: newKey.userId,
			name: newKey.name,
			keyPrefix,
			clientName: newKey.clientName,
		});

		return c.json({
			id: newKey.id,
			userId: newKey.userId,
			name: newKey.name,
			description: newKey.description || undefined,
			expiresAt: newKey.expiresAt?.toISOString() || null,
			apiKey,
			message: "Save this API key securely. It will not be shown again.",
		}, 200);
	} catch (error) {
		logger.error("Admin API key creation failed", error);
		return c.json({ error: "Failed to create API key" }, 500);
	}
});

const listApiKeysRoute = createRoute({
	method: "get",
	path: "/",
	summary: "List API Keys",
	description: "Lists all API keys, optionally filtered by user ID (requires authentication).",
	middleware: [requireJwtAuth],
	request: {
		query: z.object({
			userId: z.string().optional(),
		}),
	},
	responses: {
		200: {
			description: "List of API keys",
			content: {
				"application/json": {
					schema: z.array(z.any()),
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
	tags: ["Admin"],
});

app.openapi(listApiKeysRoute, async (c) => {
	const logger = c.get("logger");
	const { userId } = c.req.valid("query");

	logger.info("Admin listing API keys", { 
		filterByUserId: !!userId,
		userId: userId || "all_users"
	});

	try {
		let keys: any[];

		if (userId) {
			logger.logDatabase("query", "apiKeys", { 
				action: "list_by_user",
				userId 
			});
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
			logger.logDatabase("query", "apiKeys", { 
				action: "list_all"
			});
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
			clientName: key.clientName,
			allowedOrigins: key.allowedOrigins,
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

		logger.info("API keys listed successfully", {
			resultCount: sanitizedKeys.length,
			activeKeys: sanitizedKeys.filter(k => k.isActive).length,
			filterByUserId: !!userId,
		});

		return c.json(sanitizedKeys, 200);
	} catch (error) {
		logger.error("Admin API keys listing failed", error);
		return c.json({ error: "Failed to list API keys" }, 500);
	}
});

const getApiKeyRoute = createRoute({
	method: "get",
	path: "/{id}",
	summary: "Get API Key",
	description: "Retrieves details of a specific API key by its ID (requires authentication).",
	middleware: [requireJwtAuth],
	request: {
		params: z.object({
			id: z.string(),
		}),
	},
	responses: {
		200: {
			description: "API key details",
			content: {
				"application/json": {
					schema: z.object({
						id: z.string(),
						userId: z.string(),
						name: z.string(),
						description: z.string().optional(),
						keyPrefix: z.string(),
						clientName: z.string().optional(),
						allowedOrigins: z.array(z.string()).optional(),
						lastUsedAt: z.string().datetime().nullable(),
						expiresAt: z.string().datetime().nullable(),
						isActive: z.boolean(),
						createdAt: z.string().datetime().nullable(),
						updatedAt: z.string().datetime().nullable(),
						user: z.object({
							id: z.string(),
							identities: z.array(z.any()),
						}),
					}),
				},
			},
		},
		404: {
			description: "API key not found",
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
	tags: ["Admin"],
});

app.openapi(getApiKeyRoute, async (c) => {
	const logger = c.get("logger");
	const { id: keyId } = c.req.valid("param");

	logger.info("Admin getting API key details", { keyId });

	try {
		logger.logDatabase("query", "apiKeys", { keyId });
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
			logger.warn("API key not found", { keyId });
			return c.json({ error: "API key not found" }, 404);
		}

		logger.info("API key details retrieved successfully", {
			keyId,
			userId: key.userId,
			name: key.name,
			isActive: key.isActive,
			hasExpiration: !!key.expiresAt,
		});

		return c.json({
			id: key.id,
			userId: key.userId,
			name: key.name,
			description: key.description || undefined,
			keyPrefix: `cartel_${key.keyPrefix}...`,
			clientName: key.clientName || undefined,
			allowedOrigins: key.allowedOrigins || undefined,
			lastUsedAt: key.lastUsedAt?.toISOString() || null,
			expiresAt: key.expiresAt?.toISOString() || null,
			isActive: key.isActive,
			createdAt: key.createdAt?.toISOString() || null,
			updatedAt: key.updatedAt?.toISOString() || null,
			user: {
				id: key.user.id,
				identities: key.user.identities,
			},
		}, 200);
	} catch (error) {
		logger.error("Admin API key retrieval failed", error);
		return c.json({ error: "Failed to get API key" }, 500);
	}
});

const updateApiKeyRoute = createRoute({
	method: "patch",
	path: "/{id}",
	summary: "Update API Key",
	description: "Updates an existing API key's properties such as name, description, or status (requires authentication).",
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
						clientName: z.string().optional(),
						allowedOrigins: z.array(z.string()).optional(),
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
					schema: z.object({
						id: z.string(),
						name: z.string(),
						description: z.string().optional(),
						clientName: z.string().optional(),
						allowedOrigins: z.array(z.string()).optional(),
						isActive: z.boolean(),
						expiresAt: z.string().datetime().nullable(),
					}),
				},
			},
		},
		404: {
			description: "Not found",
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
	tags: ["Admin"],
});

app.openapi(updateApiKeyRoute, async (c) => {
	const logger = c.get("logger");
	const keyId = c.req.valid("param").id;
	const updates = c.req.valid("json");

	logger.info("Admin updating API key", {
		keyId,
		updateFields: Object.keys(updates),
		hasNameUpdate: !!updates.name,
		hasStatusUpdate: updates.isActive !== undefined,
		hasExpirationUpdate: !!updates.expiresAt,
	});

	try {
		logger.logDatabase("update", "apiKeys", { 
			keyId, 
			updateFields: Object.keys(updates)
		});
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
			logger.warn("API key update failed: key not found", { keyId });
			return c.json({ error: "API key not found" }, 404);
		}

		logger.info("API key updated successfully", {
			keyId,
			name: updated.name,
			isActive: updated.isActive,
			updatedFields: Object.keys(updates),
		});

		return c.json({
			id: updated.id,
			name: updated.name,
			description: updated.description || undefined,
			clientName: updated.clientName || undefined,
			allowedOrigins: updated.allowedOrigins || undefined,
			isActive: updated.isActive,
			expiresAt: updated.expiresAt?.toISOString() || null,
		}, 200);
	} catch (error) {
		logger.error("Admin API key update failed", error);
		return c.json({ error: "Failed to update API key" }, 500);
	}
});

const deleteApiKeyRoute = createRoute({
	method: "delete",
	path: "/{id}",
	summary: "Delete API Key",
	description: "Deactivates an API key by setting its status to inactive (requires authentication).",
	middleware: [requireJwtAuth],
	request: {
		params: z.object({
			id: z.string(),
		}),
	},
	responses: {
		200: {
			description: "API key deactivated successfully",
			content: {
				"application/json": {
					schema: z.object({
						success: z.boolean(),
						message: z.string(),
					}),
				},
			},
		},
		404: {
			description: "API key not found",
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
	tags: ["Admin"],
});

app.openapi(deleteApiKeyRoute, async (c) => {
	const logger = c.get("logger");
	const { id: keyId } = c.req.valid("param");

	logger.info("Admin deactivating API key", { keyId });

	try {
		logger.logDatabase("update", "apiKeys", { 
			keyId, 
			action: "deactivate"
		});
		const [deactivated] = await db
			.update(apiKeys)
			.set({
				isActive: false,
				updatedAt: new Date(),
			})
			.where(eq(apiKeys.id, keyId))
			.returning();

		if (!deactivated) {
			logger.warn("API key deactivation failed: key not found", { keyId });
			return c.json({ error: "API key not found" }, 404);
		}

		logger.info("API key deactivated successfully", {
			keyId,
			name: deactivated.name,
			userId: deactivated.userId,
		});

		return c.json({
			success: true,
			message: "API key deactivated successfully",
		}, 200);
	} catch (error) {
		logger.error("Admin API key deactivation failed", error);
		return c.json({ error: "Failed to deactivate API key" }, 500);
	}
});

const rotateApiKeyRoute = createRoute({
	method: "post",
	path: "/{id}/rotate",
	summary: "Rotate API Key",
	description: "Generates a new API key and sets a grace period for the old one (requires authentication).",
	middleware: [requireJwtAuth],
	request: {
		params: z.object({
			id: z.string(),
		}),
		query: z.object({
			gracePeriod: z.string().optional().default("300"),
		}),
	},
	responses: {
		200: {
			description: "API key rotated successfully",
			content: {
				"application/json": {
					schema: z.object({
						newApiKey: z.string(),
						message: z.string(),
						expiresAt: z.string(),
					}),
				},
			},
		},
		404: {
			description: "API key not found",
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
	tags: ["Admin"],
});

app.openapi(rotateApiKeyRoute, async (c) => {
	const logger = c.get("logger");
	const { id: keyId } = c.req.valid("param");
	const { gracePeriod: gracePeriodStr } = c.req.valid("query");
	const gracePeriod = parseInt(gracePeriodStr);

	logger.info("Admin rotating API key", {
		keyId,
		gracePeriod,
	});

	try {
		logger.logDatabase("query", "apiKeys", { keyId });
		const existingKey = await db.query.apiKeys.findFirst({
			where: eq(apiKeys.id, keyId),
		});

		if (!existingKey) {
			logger.warn("API key rotation failed: key not found", { keyId });
			return c.json({ error: "API key not found" }, 404);
		}

		// Generate new key
		const newApiKey = generateApiKey();
		const newKeyPrefix = getApiKeyPrefix(newApiKey);
		const newKeyHash = hashApiKey(newApiKey);

		logger.logDatabase("transaction", "apiKeys", {
			action: "rotate_key",
			keyId,
			oldKeyPrefix: existingKey.keyPrefix,
			newKeyPrefix,
			gracePeriod,
		});

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
				clientName: existingKey.clientName,
				allowedOrigins: existingKey.allowedOrigins,
				expiresAt: existingKey.expiresAt,
			});
		});

		logger.info("API key rotated successfully", {
			keyId,
			oldKeyPrefix: existingKey.keyPrefix,
			newKeyPrefix,
			gracePeriod,
			userId: existingKey.userId,
		});

		return c.json({
			newApiKey,
			message: `New API key generated. Old key will expire in ${gracePeriod} seconds.`,
			expiresAt: new Date(Date.now() + gracePeriod * 1000).toISOString(),
		}, 200);
	} catch (error) {
		logger.error("Admin API key rotation failed", error);
		return c.json({ error: "Failed to rotate API key" }, 500);
	}
});

export default app;
