import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { and, eq } from "drizzle-orm";
import { db, userIdentities, users } from "../../../client";

const app = new OpenAPIHono();

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
	tags: ["Users"],
});

app.openapi(getUserByEvmRoute, async (c) => {
	const { address } = c.req.valid("param");
	const normalizedAddress = address.toLowerCase();

	try {
		const identity = await db.query.userIdentities.findFirst({
			where: and(
				eq(userIdentities.platform, "evm"),
				eq(userIdentities.identity, normalizedAddress),
			),
			with: {
				user: true,
			},
		});

		if (!identity) {
			return c.json({ error: "User not found" }, 404);
		}

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
		console.error("[API] Error getting user by EVM address:", error);
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
	tags: ["Users"],
});

app.openapi(getUserByLensRoute, async (c) => {
	const { address } = c.req.valid("param");
	const normalizedAddress = address.toLowerCase();

	try {
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
			return c.json({ error: "User not found" }, 404);
		}

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
		console.error("[API] Error getting user by Lens:", error);
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
	tags: ["Users"],
});

app.openapi(getUserByFarcasterRoute, async (c) => {
	const { fid } = c.req.valid("param");

	try {
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
			return c.json({ error: "User not found" }, 404);
		}

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
		console.error("[API] Error getting user by Farcaster FID:", error);
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
	tags: ["Users"],
});

app.openapi(getUserByDiscordRoute, async (c) => {
	const { discordId } = c.req.valid("param");

	try {
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
			return c.json({ error: "User not found" }, 404);
		}

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
		console.error("[API] Error getting user by Discord ID:", error);
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
	tags: ["Users"],
});

app.openapi(getUserByTelegramRoute, async (c) => {
	const { telegramId } = c.req.valid("param");

	try {
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
			return c.json({ error: "User not found" }, 404);
		}

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
		console.error("[API] Error getting user by Telegram ID:", error);
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
					schema: z.object({
						error: z.string(),
					}),
				},
			},
		},
	},
	tags: ["Users"],
});

app.openapi(createIdentityRoute, async (c) => {
	const { platform, identity, isPrimary } = c.req.valid("json");

	try {
		const normalizedIdentity =
			platform === "evm" || platform === "lens"
				? identity.toLowerCase()
				: identity;

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

		const [newUser] = await db.insert(users).values({}).returning();

		if (!newUser) {
			return c.json({ error: "Failed to create user" }, 500);
		}

		const [newIdentity] = await db
			.insert(userIdentities)
			.values({
				userId: newUser.id,
				platform,
				identity: normalizedIdentity,
				isPrimary: isPrimary || true,
			})
			.returning();

		return c.json(
			{
				userId: newUser.id,
				user: {
					id: newUser.id,
					createdAt: newUser.createdAt?.toISOString() || null,
					updatedAt: newUser.updatedAt?.toISOString() || null,
				},
				identity: {
					userId: newIdentity!.userId,
					platform: newIdentity!.platform,
					identity: newIdentity!.identity,
					isPrimary: newIdentity!.isPrimary,
					createdAt: newIdentity!.createdAt?.toISOString() || null,
					updatedAt: newIdentity!.updatedAt?.toISOString() || null,
				},
				created: true,
			},
			201,
		);
	} catch (error) {
		console.error("[API] Error creating identity:", error);
		return c.json({ error: "Failed to create identity" }, 500);
	}
});

export default app;