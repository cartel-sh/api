import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { and, eq } from "drizzle-orm";
import { db, userIdentities, users } from "../../../client";
import { requestLogging } from "../../middleware/logging";
import {
	UserSchema,
	UserIdentitySchema,
	ErrorResponseSchema,
} from "../../../shared/schemas";

type Variables = {
	userId?: string;
	logger?: any;
};

const app = new OpenAPIHono<{ Variables: Variables }>();

app.use("*", requestLogging());

const PlatformEnum = z.enum([
	"discord",
	"evm",
	"lens",
	"farcaster",
	"telegram",
]);

const getUserByEvmRoute = createRoute({
	method: "get",
	path: "/by-evm/{address}",
	summary: "Get User by EVM",
	description: "Retrieves a user by their EVM wallet address.",
	request: {
		params: z.object({
			address: z.string(),
		}),
	},
	responses: {
		200: {
			description: "User found",
			content: {
				"application/json": {
					schema: z.object({
						userId: z.string(),
						user: z.object({
							id: z.string(),
							createdAt: z.string().datetime().nullable(),
							updatedAt: z.string().datetime().nullable(),
						}),
						identity: z.object({
							platform: z.string(),
							identity: z.string(),
							isPrimary: z.boolean(),
						}),
					}),
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
		500: {
			description: "Internal server error",
			content: {
				"application/json": {
					schema: ErrorResponseSchema,
				},
			},
		},
	},
	tags: ["Users"],
});

app.openapi(getUserByEvmRoute, async (c) => {
	const logger = c.get("logger");
	const { address } = c.req.valid("param");
	const normalizedAddress = address.toLowerCase();

	logger.info("Getting user by EVM address", {
		address: "***masked***",
		addressLength: address.length,
	});

	try {
		logger.logDatabase("query", "users", {
			action: "find_by_evm_address",
			address: "***masked***",
		});
		const user = await db.query.users.findFirst({
			where: eq(users.address, normalizedAddress),
		});

		if (!user) {
			logger.warn("User not found by EVM address", {
				address: "***masked***",
			});
			return c.json({ error: "User not found" }, 404);
		}

		logger.info("User retrieved successfully by EVM address", {
			userId: user.id,
			address: "***masked***",
			userCreatedAt: user.createdAt?.toISOString(),
		});

		return c.json({
			userId: user.id,
			user: {
				id: user.id,
				createdAt: user.createdAt?.toISOString() || null,
				updatedAt: user.updatedAt?.toISOString() || null,
			},
			identity: {
				platform: "evm",
				identity: user.address || "",
				isPrimary: true, // EVM address is now always primary for user
			},
		}, 200);
	} catch (error) {
		logger.error("User retrieval by EVM address failed", error);
		return c.json({ error: "Failed to get user" }, 500);
	}
});

const getUserByLensRoute = createRoute({
	method: "get",
	path: "/by-lens/{address}",
	summary: "Get User by Lens",
	description: "Retrieves a user by their Lens protocol address.",
	request: {
		params: z.object({
			address: z.string(),
		}),
	},
	responses: {
		200: {
			description: "User found",
			content: {
				"application/json": {
					schema: z.object({
						userId: z.string(),
						user: z.object({
							id: z.string(),
							createdAt: z.string().datetime().nullable(),
							updatedAt: z.string().datetime().nullable(),
						}),
						identity: z.object({
							platform: z.string(),
							identity: z.string(),
							isPrimary: z.boolean(),
						}),
					}),
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
		500: {
			description: "Internal server error",
			content: {
				"application/json": {
					schema: ErrorResponseSchema,
				},
			},
		},
	},
	tags: ["Users"],
});

app.openapi(getUserByLensRoute, async (c) => {
	const logger = c.get("logger");
	const { address } = c.req.valid("param");
	const normalizedAddress = address.toLowerCase();

	logger.info("Getting user by Lens address", {
		address: "***masked***",
		addressLength: address.length,
	});

	try {
		logger.logDatabase("query", "userIdentities", {
			action: "find_by_lens_address",
			platform: "lens",
			address: "***masked***",
		});
		const identity = await db.query.userIdentities.findFirst({
			where: and(
				eq(userIdentities.platform, "lens"),
				eq(userIdentities.identity, normalizedAddress),
			),
			with: {
				user: true,
			},
		});

		if (!identity) {
			logger.warn("User not found by Lens address", {
				address: "***masked***",
			});
			return c.json({ error: "User not found" }, 404);
		}

		logger.info("User retrieved successfully by Lens address", {
			userId: identity.userId,
			isPrimary: identity.isPrimary,
			userCreatedAt: identity.user.createdAt?.toISOString(),
		});

		return c.json({
			userId: identity.userId,
			user: {
				id: identity.user.id,
				createdAt: identity.user.createdAt?.toISOString() || null,
				updatedAt: identity.user.updatedAt?.toISOString() || null,
			},
			identity: {
				platform: identity.platform,
				identity: identity.identity,
				isPrimary: identity.isPrimary,
			},
		}, 200);
	} catch (error) {
		logger.error("User retrieval by Lens address failed", error);
		return c.json({ error: "Failed to get user" }, 500);
	}
});

const getUserByFarcasterRoute = createRoute({
	method: "get",
	path: "/by-farcaster/{fid}",
	summary: "Get User by Farcaster",
	description: "Retrieves a user by their Farcaster FID.",
	request: {
		params: z.object({
			fid: z.string(),
		}),
	},
	responses: {
		200: {
			description: "User found",
			content: {
				"application/json": {
					schema: z.object({
						userId: z.string(),
						user: z.object({
							id: z.string(),
							createdAt: z.string().datetime().nullable(),
							updatedAt: z.string().datetime().nullable(),
						}),
						identity: z.object({
							platform: z.string(),
							identity: z.string(),
							isPrimary: z.boolean(),
						}),
					}),
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
		500: {
			description: "Internal server error",
			content: {
				"application/json": {
					schema: ErrorResponseSchema,
				},
			},
		},
	},
	tags: ["Users"],
});

app.openapi(getUserByFarcasterRoute, async (c) => {
	const logger = c.get("logger");
	const { fid } = c.req.valid("param");

	logger.info("Getting user by Farcaster FID", { fid });

	try {
		logger.logDatabase("query", "userIdentities", {
			action: "find_by_farcaster_fid",
			platform: "farcaster",
			fid,
		});
		const identity = await db.query.userIdentities.findFirst({
			where: and(
				eq(userIdentities.platform, "farcaster"),
				eq(userIdentities.identity, fid),
			),
			with: {
				user: true,
			},
		});

		if (!identity) {
			logger.warn("User not found by Farcaster FID", { fid });
			return c.json({ error: "User not found" }, 404);
		}

		logger.info("User retrieved successfully by Farcaster FID", {
			userId: identity.userId,
			fid,
			isPrimary: identity.isPrimary,
			userCreatedAt: identity.user.createdAt?.toISOString(),
		});

		return c.json({
			userId: identity.userId,
			user: {
				id: identity.user.id,
				createdAt: identity.user.createdAt?.toISOString() || null,
				updatedAt: identity.user.updatedAt?.toISOString() || null,
			},
			identity: {
				platform: identity.platform,
				identity: identity.identity,
				isPrimary: identity.isPrimary,
			},
		}, 200);
	} catch (error) {
		logger.error("User retrieval by Farcaster FID failed", error);
		return c.json({ error: "Failed to get user" }, 500);
	}
});

const getUserByDiscordRoute = createRoute({
	method: "get",
	path: "/by-discord/{discordId}",
	summary: "Get User by Discord",
	description: "Retrieves a user by their Discord ID.",
	request: {
		params: z.object({
			discordId: z.string(),
		}),
	},
	responses: {
		200: {
			description: "User found",
			content: {
				"application/json": {
					schema: z.object({
						userId: z.string(),
						user: z.object({
							id: z.string(),
							createdAt: z.string().datetime().nullable(),
							updatedAt: z.string().datetime().nullable(),
						}),
						identity: z.object({
							platform: z.string(),
							identity: z.string(),
							isPrimary: z.boolean(),
						}),
					}),
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
		500: {
			description: "Internal server error",
			content: {
				"application/json": {
					schema: ErrorResponseSchema,
				},
			},
		},
	},
	tags: ["Users"],
});

app.openapi(getUserByDiscordRoute, async (c) => {
	const logger = c.get("logger");
	const { discordId } = c.req.valid("param");

	logger.info("Getting user by Discord ID", { discordId });

	try {
		logger.logDatabase("query", "userIdentities", {
			action: "find_by_discord_id",
			platform: "discord",
			discordId,
		});
		const identity = await db.query.userIdentities.findFirst({
			where: and(
				eq(userIdentities.platform, "discord"),
				eq(userIdentities.identity, discordId),
			),
			with: {
				user: true,
			},
		});

		if (!identity) {
			logger.warn("User not found by Discord ID", { discordId });
			return c.json({ error: "User not found" }, 404);
		}

		logger.info("User retrieved successfully by Discord ID", {
			userId: identity.userId,
			discordId,
			isPrimary: identity.isPrimary,
			userCreatedAt: identity.user.createdAt?.toISOString(),
		});

		return c.json({
			userId: identity.userId,
			user: {
				id: identity.user.id,
				createdAt: identity.user.createdAt?.toISOString() || null,
				updatedAt: identity.user.updatedAt?.toISOString() || null,
			},
			identity: {
				platform: identity.platform,
				identity: identity.identity,
				isPrimary: identity.isPrimary,
			},
		}, 200);
	} catch (error) {
		logger.error("User retrieval by Discord ID failed", error);
		return c.json({ error: "Failed to get user" }, 500);
	}
});

const getUserByTelegramRoute = createRoute({
	method: "get",
	path: "/by-telegram/{telegramId}",
	summary: "Get User by Telegram",
	description: "Retrieves a user by their Telegram ID.",
	request: {
		params: z.object({
			telegramId: z.string(),
		}),
	},
	responses: {
		200: {
			description: "User found",
			content: {
				"application/json": {
					schema: z.object({
						userId: z.string(),
						user: z.object({
							id: z.string(),
							createdAt: z.string().datetime().nullable(),
							updatedAt: z.string().datetime().nullable(),
						}),
						identity: z.object({
							platform: z.string(),
							identity: z.string(),
							isPrimary: z.boolean(),
						}),
					}),
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
		500: {
			description: "Internal server error",
			content: {
				"application/json": {
					schema: ErrorResponseSchema,
				},
			},
		},
	},
	tags: ["Users"],
});

app.openapi(getUserByTelegramRoute, async (c) => {
	const logger = c.get("logger");
	const { telegramId } = c.req.valid("param");

	logger.info("Getting user by Telegram ID", { telegramId });

	try {
		logger.logDatabase("query", "userIdentities", {
			action: "find_by_telegram_id",
			platform: "telegram",
			telegramId,
		});
		const identity = await db.query.userIdentities.findFirst({
			where: and(
				eq(userIdentities.platform, "telegram"),
				eq(userIdentities.identity, telegramId),
			),
			with: {
				user: true,
			},
		});

		if (!identity) {
			logger.warn("User not found by Telegram ID", { telegramId });
			return c.json({ error: "User not found" }, 404);
		}

		logger.info("User retrieved successfully by Telegram ID", {
			userId: identity.userId,
			telegramId,
			isPrimary: identity.isPrimary,
			userCreatedAt: identity.user.createdAt?.toISOString(),
		});

		return c.json({
			userId: identity.userId,
			user: {
				id: identity.user.id,
				createdAt: identity.user.createdAt?.toISOString() || null,
				updatedAt: identity.user.updatedAt?.toISOString() || null,
			},
			identity: {
				platform: identity.platform,
				identity: identity.identity,
				isPrimary: identity.isPrimary,
			},
		}, 200);
	} catch (error) {
		logger.error("User retrieval by Telegram ID failed", error);
		return c.json({ error: "Failed to get user" }, 500);
	}
});

const createIdentityRoute = createRoute({
	method: "post",
	path: "/",
	summary: "Create User Identity",
	description: "Creates a new user identity or returns an existing one if the identity already exists.",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						platform: PlatformEnum,
						identity: z.string().min(1),
						isPrimary: z.boolean().optional().default(false),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			description: "Existing identity returned",
			content: {
				"application/json": {
					schema: z.object({
						userId: z.string(),
						user: z.object({
							id: z.string(),
							createdAt: z.string().datetime().nullable(),
							updatedAt: z.string().datetime().nullable(),
						}),
						identity: z.object({
							userId: z.string(),
							platform: z.string(),
							identity: z.string(),
							isPrimary: z.boolean(),
							createdAt: z.string().datetime().nullable(),
							updatedAt: z.string().datetime().nullable(),
						}),
						created: z.boolean(),
					}),
				},
			},
		},
		201: {
			description: "New identity created",
			content: {
				"application/json": {
					schema: z.object({
						userId: z.string(),
						user: z.object({
							id: z.string(),
							createdAt: z.string().datetime().nullable(),
							updatedAt: z.string().datetime().nullable(),
						}),
						identity: z.object({
							userId: z.string(),
							platform: z.string(),
							identity: z.string(),
							isPrimary: z.boolean(),
							createdAt: z.string().datetime().nullable(),
							updatedAt: z.string().datetime().nullable(),
						}),
						created: z.boolean(),
					}),
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
	tags: ["Users"],
});

app.openapi(createIdentityRoute, async (c) => {
	const logger = c.get("logger");
	const { platform, identity, isPrimary } = c.req.valid("json");

	logger.info("Creating user identity", {
		platform,
		identity: platform === "evm" || platform === "lens" ? "***masked***" : identity,
		isPrimary: isPrimary || true,
	});

	try {
		const normalizedIdentity =
			platform === "evm" || platform === "lens"
				? identity.toLowerCase()
				: identity;

		logger.logDatabase("query", "userIdentities", {
			action: "check_existing_identity",
			platform,
			identity: platform === "evm" || platform === "lens" ? "***masked***" : normalizedIdentity,
		});
		const existingIdentity = await db.query.userIdentities.findFirst({
			where: and(
				eq(userIdentities.platform, platform),
				eq(userIdentities.identity, normalizedIdentity),
			),
			with: {
				user: true,
			},
		});

		if (existingIdentity) {
			logger.info("Returning existing identity", {
				userId: existingIdentity.userId,
				platform,
				isPrimary: existingIdentity.isPrimary,
				createdAt: existingIdentity.createdAt?.toISOString(),
			});
			return c.json({
				userId: existingIdentity.userId,
				user: {
					id: existingIdentity.user.id,
					createdAt: existingIdentity.user.createdAt?.toISOString() || null,
					updatedAt: existingIdentity.user.updatedAt?.toISOString() || null,
				},
				identity: {
					userId: existingIdentity.userId,
					platform: existingIdentity.platform,
					identity: existingIdentity.identity,
					isPrimary: existingIdentity.isPrimary,
					createdAt: existingIdentity.createdAt?.toISOString() || null,
					updatedAt: existingIdentity.updatedAt?.toISOString() || null,
				},
				created: false,
			}, 200);
		}

		logger.logDatabase("insert", "users", {
			action: "create_new_user",
		});
		const [newUser] = await db.insert(users).values({}).returning();

		if (!newUser) {
			logger.error("Failed to create user: no user returned");
			return c.json({ error: "Failed to create user" }, 500);
		}

		const willBePrimary = isPrimary !== undefined ? isPrimary : true;
		logger.logDatabase("insert", "userIdentities", {
			userId: newUser.id,
			platform,
			identity: platform === "evm" || platform === "lens" ? "***masked***" : normalizedIdentity,
			isPrimary: willBePrimary,
		});
		const [newIdentity] = await db
			.insert(userIdentities)
			.values({
				userId: newUser.id,
				platform,
				identity: normalizedIdentity,
				isPrimary: willBePrimary,
			})
			.returning();

		if (!newIdentity) {
			logger.error("Failed to create identity: no identity returned");
			return c.json({ error: "Failed to create identity" }, 500);
		}

		logger.info("User identity created successfully", {
			userId: newUser.id,
			platform,
			identity: platform === "evm" || platform === "lens" ? "***masked***" : newIdentity.identity,
			isPrimary: newIdentity.isPrimary,
			createdAt: newIdentity.createdAt?.toISOString(),
		});

		return c.json(
			{
				userId: newUser.id,
				user: {
					id: newUser.id,
					createdAt: newUser.createdAt?.toISOString() || null,
					updatedAt: newUser.updatedAt?.toISOString() || null,
				},
				identity: {
					userId: newIdentity.userId,
					platform: newIdentity.platform,
					identity: newIdentity.identity,
					isPrimary: newIdentity.isPrimary,
					createdAt: newIdentity.createdAt?.toISOString() || null,
					updatedAt: newIdentity.updatedAt?.toISOString() || null,
				},
				created: true,
			},
			201,
		);
	} catch (error) {
		logger.error("User identity creation failed", error);
		return c.json({ error: "Failed to create identity" }, 500);
	}
});

export default app;