import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { and, eq, sql } from "drizzle-orm";
import { db, userIdentities, users } from "../../../client";
import { requireJwtAuth } from "../../middleware/auth";
import { requestLogging } from "../../middleware/logging";

type Variables = {
	userId?: string;
	logger?: any;
};

const app = new OpenAPIHono<{ Variables: Variables }>();

app.use("*", requestLogging());
app.use("*", requireJwtAuth);

const PlatformEnum = z.enum([
	"discord",
	"evm",
	"lens",
	"farcaster",
	"telegram",
]);

const connectIdentityRoute = createRoute({
	method: "post",
	path: "/connect",
	summary: "Connect Identity",
	description: "Connects a new identity to an existing user account (requires authentication).",
	middleware: [requireJwtAuth],
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						userId: z.string().uuid(),
						platform: PlatformEnum,
						identity: z.string().min(1),
						isPrimary: z.boolean().optional().default(false),
					}),
				},
			},
		},
	},
	responses: {
		201: {
			description: "Success",
			content: {
				"application/json": {
					schema: z.any(),
				},
			},
		},
		400: {
			description: "Bad request",
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

app.openapi(connectIdentityRoute, async (c) => {
	const logger = c.get("logger");
	const { userId, platform, identity, isPrimary } = c.req.valid("json");

	logger.info("Admin connecting identity to user", {
		userId,
		platform,
		isPrimary,
		identityLength: identity.length,
	});

	try {
		const normalizedIdentity =
			platform === "evm" || platform === "lens"
				? identity.toLowerCase()
				: identity;

		logger.logDatabase("query", "users", { userId });
		const user = await db.query.users.findFirst({
			where: eq(users.id, userId),
		});

		if (!user) {
			logger.warn("Identity connection failed: user not found", { userId });
			return c.json({ error: "User not found" }, 404);
		}

		logger.logDatabase("query", "userIdentities", { platform, identity: "***masked***" });
		const existingIdentity = await db.query.userIdentities.findFirst({
			where: and(
				eq(userIdentities.platform, platform),
				eq(userIdentities.identity, normalizedIdentity),
			),
		});

		if (existingIdentity) {
			if (existingIdentity.userId === userId) {
				logger.warn("Identity connection failed: already connected to this user", {
					userId,
					platform,
				});
				return c.json(
					{ error: "Identity already connected to this user" },
					400,
				);
			}
			logger.warn("Identity connection failed: already connected to another user", {
				platform,
				existingUserId: existingIdentity.userId,
			});
			return c.json(
				{ error: "Identity already connected to another user" },
				400,
			);
		}

		if (isPrimary) {
			logger.logDatabase("update", "userIdentities", {
				action: "unset_primary",
				userId,
			});
			await db
				.update(userIdentities)
				.set({ isPrimary: false, updatedAt: new Date() })
				.where(
					and(
						eq(userIdentities.userId, userId),
						eq(userIdentities.isPrimary, true),
					),
				);
		}

		logger.logDatabase("insert", "userIdentities", {
			userId,
			platform,
			isPrimary,
		});
		const [newIdentity] = await db
			.insert(userIdentities)
			.values({
				userId,
				platform,
				identity: normalizedIdentity,
				isPrimary,
			})
			.returning();

		logger.info("Identity connected successfully", {
			userId,
			platform,
			identity: "***masked***",
			isPrimary,
		});

		return c.json(
			{
				message: "Identity connected successfully",
				identity: newIdentity,
			},
			201,
		);
	} catch (error) {
		logger.error("Admin identity connection failed", error);
		return c.json({ error: "Failed to connect identity" }, 500);
	}
});

const disconnectIdentityRoute = createRoute({
	method: "delete",
	path: "/disconnect",
	summary: "Disconnect Identity",
	description: "Disconnects an identity from a user account, ensuring at least one identity remains (requires authentication).",
	middleware: [requireJwtAuth],
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						platform: PlatformEnum,
						identity: z.string().min(1),
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
		400: {
			description: "Bad request",
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

app.openapi(disconnectIdentityRoute, async (c) => {
	const logger = c.get("logger");
	const { platform, identity } = c.req.valid("json");

	logger.info("Admin disconnecting identity", {
		platform,
		identityLength: identity.length,
	});

	try {
		const normalizedIdentity =
			platform === "evm" || platform === "lens"
				? identity.toLowerCase()
				: identity;

		logger.logDatabase("query", "userIdentities", { platform, identity: "***masked***" });
		const existingIdentity = await db.query.userIdentities.findFirst({
			where: and(
				eq(userIdentities.platform, platform),
				eq(userIdentities.identity, normalizedIdentity),
			),
		});

		if (!existingIdentity) {
			logger.warn("Identity disconnection failed: identity not found", { platform });
			return c.json({ error: "Identity not found" }, 404);
		}

		logger.logDatabase("query", "userIdentities", {
			action: "count_identities",
			userId: existingIdentity.userId,
		});
		const identityCount = await db
			.select({ count: sql<number>`count(*)` })
			.from(userIdentities)
			.where(eq(userIdentities.userId, existingIdentity.userId));

		if (identityCount[0]?.count === 1) {
			logger.warn("Identity disconnection failed: cannot disconnect only identity", {
				userId: existingIdentity.userId,
				platform,
			});
			return c.json({ error: "Cannot disconnect user's only identity" }, 400);
		}

		logger.logDatabase("delete", "userIdentities", {
			platform,
			userId: existingIdentity.userId,
			wasPrimary: existingIdentity.isPrimary,
		});
		await db
			.delete(userIdentities)
			.where(
				and(
					eq(userIdentities.platform, platform),
					eq(userIdentities.identity, normalizedIdentity),
				),
			);

		if (existingIdentity.isPrimary) {
			logger.logDatabase("query", "userIdentities", {
				action: "find_remaining_identity",
				userId: existingIdentity.userId,
			});
			const remainingIdentity = await db.query.userIdentities.findFirst({
				where: eq(userIdentities.userId, existingIdentity.userId),
			});

			if (remainingIdentity) {
				logger.logDatabase("update", "userIdentities", {
					action: "set_new_primary",
					userId: existingIdentity.userId,
					newPrimaryPlatform: remainingIdentity.platform,
				});
				await db
					.update(userIdentities)
					.set({ isPrimary: true, updatedAt: new Date() })
					.where(
						and(
							eq(userIdentities.platform, remainingIdentity.platform),
							eq(userIdentities.identity, remainingIdentity.identity),
						),
					);
			}
		}

		logger.info("Identity disconnected successfully", {
			userId: existingIdentity.userId,
			platform,
			wasPrimary: existingIdentity.isPrimary,
		});

		return c.json({
			message: "Identity disconnected successfully",
			userId: existingIdentity.userId,
		});
	} catch (error) {
		logger.error("Admin identity disconnection failed", error);
		return c.json({ error: "Failed to disconnect identity" }, 500);
	}
});

const setPrimaryRoute = createRoute({
	method: "put",
	path: "/set-primary",
	summary: "Set Primary Identity",
	description: "Sets an identity as the primary identity for a user account (requires authentication).",
	middleware: [requireJwtAuth],
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						platform: PlatformEnum,
						identity: z.string().min(1),
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

app.openapi(setPrimaryRoute, async (c) => {
	const logger = c.get("logger");
	const { platform, identity } = c.req.valid("json");

	logger.info("Admin setting primary identity", {
		platform,
		identityLength: identity.length,
	});

	try {
		const normalizedIdentity =
			platform === "evm" || platform === "lens"
				? identity.toLowerCase()
				: identity;

		logger.logDatabase("query", "userIdentities", { platform, identity: "***masked***" });
		const existingIdentity = await db.query.userIdentities.findFirst({
			where: and(
				eq(userIdentities.platform, platform),
				eq(userIdentities.identity, normalizedIdentity),
			),
		});

		if (!existingIdentity) {
			logger.warn("Set primary failed: identity not found", { platform });
			return c.json({ error: "Identity not found" }, 404);
		}

		if (existingIdentity.isPrimary) {
			logger.info("Identity is already primary", {
				userId: existingIdentity.userId,
				platform,
			});
			return c.json({ message: "Identity is already primary" });
		}

		logger.logDatabase("update", "userIdentities", {
			action: "unset_current_primary",
			userId: existingIdentity.userId,
		});
		await db
			.update(userIdentities)
			.set({ isPrimary: false, updatedAt: new Date() })
			.where(
				and(
					eq(userIdentities.userId, existingIdentity.userId),
					eq(userIdentities.isPrimary, true),
				),
			);

		logger.logDatabase("update", "userIdentities", {
			action: "set_new_primary",
			userId: existingIdentity.userId,
			platform,
		});
		await db
			.update(userIdentities)
			.set({ isPrimary: true, updatedAt: new Date() })
			.where(
				and(
					eq(userIdentities.platform, platform),
					eq(userIdentities.identity, normalizedIdentity),
				),
			);

		logger.info("Primary identity set successfully", {
			userId: existingIdentity.userId,
			platform,
		});

		return c.json({
			message: "Identity set as primary successfully",
			userId: existingIdentity.userId,
		});
	} catch (error) {
		logger.error("Admin set primary identity failed", error);
		return c.json({ error: "Failed to set primary identity" }, 500);
	}
});

const mergeUsersRoute = createRoute({
	method: "post",
	path: "/merge-users",
	summary: "Merge Users",
	description: "Merges two user accounts by transferring all identities from the source user to the target user (requires authentication).",
	middleware: [requireJwtAuth],
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						sourceUserId: z.string().uuid(),
						targetUserId: z.string().uuid(),
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
		400: {
			description: "Bad request",
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

app.openapi(mergeUsersRoute, async (c) => {
	const logger = c.get("logger");
	const { sourceUserId, targetUserId } = c.req.valid("json");

	logger.info("Admin merging users", {
		sourceUserId,
		targetUserId,
	});

	if (sourceUserId === targetUserId) {
		logger.warn("User merge failed: cannot merge user with itself", {
			userId: sourceUserId,
		});
		return c.json({ error: "Cannot merge user with itself" }, 400);
	}

	try {
		logger.logDatabase("query", "users", {
			action: "find_source_and_target",
			sourceUserId,
			targetUserId,
		});
		const [sourceUser, targetUser] = await Promise.all([
			db.query.users.findFirst({ where: eq(users.id, sourceUserId) }),
			db.query.users.findFirst({ where: eq(users.id, targetUserId) }),
		]);

		if (!sourceUser || !targetUser) {
			logger.warn("User merge failed: one or both users not found", {
				sourceUserFound: !!sourceUser,
				targetUserFound: !!targetUser,
				sourceUserId,
				targetUserId,
			});
			return c.json({ error: "One or both users not found" }, 404);
		}

		logger.logDatabase("query", "userIdentities", {
			action: "find_source_identities",
			sourceUserId,
		});
		const sourceIdentities = await db.query.userIdentities.findMany({
			where: eq(userIdentities.userId, sourceUserId),
		});

		if (sourceIdentities.length === 0) {
			logger.warn("User merge failed: source user has no identities", {
				sourceUserId,
			});
			return c.json({ error: "Source user has no identities" }, 400);
		}

		logger.logDatabase("update", "userIdentities", {
			action: "transfer_identities",
			sourceUserId,
			targetUserId,
			identityCount: sourceIdentities.length,
		});
		await db
			.update(userIdentities)
			.set({
				userId: targetUserId,
				isPrimary: false,
				updatedAt: new Date(),
			})
			.where(eq(userIdentities.userId, sourceUserId));

		logger.logDatabase("delete", "users", {
			action: "delete_source_user",
			sourceUserId,
		});
		await db.delete(users).where(eq(users.id, sourceUserId));

		logger.info("Users merged successfully", {
			sourceUserId,
			targetUserId,
			mergedIdentities: sourceIdentities.length,
			mergedPlatforms: sourceIdentities.map(i => i.platform),
		});

		return c.json({
			message: "Users merged successfully",
			targetUserId,
			mergedIdentities: sourceIdentities.length,
		});
	} catch (error) {
		logger.error("Admin user merge failed", error);
		return c.json({ error: "Failed to merge users" }, 500);
	}
});

export default app;
