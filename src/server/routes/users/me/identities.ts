import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { and, eq, sql } from "drizzle-orm";
import { db, userIdentities, users, practiceSessions, projects } from "../../../../client";
import { requireAuth } from "../../../middleware/auth";
import { requestLogging } from "../../../middleware/logging";

type Variables = {
	userId?: string;
	logger?: any;
};

const app = new OpenAPIHono<{ Variables: Variables }>();

app.use("*", requestLogging());
app.use("*", requireAuth);

const PlatformEnum = z.enum([
	"discord",
	"evm",
	"lens",
	"farcaster",
	"telegram",
	"github",
]);

const IdentityMetadataSchema = z.object({
	username: z.string().optional(),
	displayName: z.string().optional(),
	avatarUrl: z.string().optional(),
	email: z.string().optional(),
	bio: z.string().optional(),
	profileUrl: z.string().optional(),
}).nullable();

const UserIdentitySchema = z.object({
	userId: z.string().uuid(),
	platform: PlatformEnum,
	identity: z.string(),
	isPrimary: z.boolean(),
	metadata: IdentityMetadataSchema,
	verifiedAt: z.string().datetime().nullable(),
	createdAt: z.string().datetime().nullable(),
	updatedAt: z.string().datetime().nullable(),
});

const listIdentitiesRoute = createRoute({
	method: "get",
	path: "/",
	summary: "List My Identities",
	description: "Lists all identities connected to the authenticated user's account.",
	responses: {
		200: {
			description: "List of user identities",
			content: {
				"application/json": {
					schema: z.array(UserIdentitySchema),
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
	tags: ["Users"],
});

app.openapi(listIdentitiesRoute, async (c) => {
	const logger = c.get("logger");
	const userId = c.get("userId");

	if (!userId) {
		logger.warn("List identities failed: no user ID in context");
		return c.json({ error: "Unauthorized" }, 401);
	}

	logger.info("Listing user identities", { userId });

	try {
		logger.logDatabase("query", "userIdentities", { userId });
		const identities = await db.query.userIdentities.findMany({
			where: eq(userIdentities.userId, userId),
			orderBy: (identities, { desc }) => [desc(identities.isPrimary), desc(identities.createdAt)],
		});

		logger.info("User identities retrieved successfully", {
			userId,
			identityCount: identities.length,
		});

		return c.json(
			identities.map((identity) => ({
				userId: identity.userId,
				platform: identity.platform as "discord" | "evm" | "lens" | "farcaster" | "telegram" | "github",
				identity: identity.identity,
				isPrimary: identity.isPrimary,
				metadata: {
					...identity.metadata as {
						username?: string;
						displayName?: string;
						avatarUrl?: string;
						email?: string;
						bio?: string;
						profileUrl?: string;
					} | null,
					oauthAccessToken: identity.oauthAccessToken
				},
				verifiedAt: identity.verifiedAt?.toISOString() || null,
				createdAt: identity.createdAt?.toISOString() || null,
				updatedAt: identity.updatedAt?.toISOString() || null,
			})),
			200
		);
	} catch (error) {
		logger.error("Failed to list user identities", error);
		return c.json({ error: "Failed to list identities" }, 500);
	}
});

const connectIdentityRoute = createRoute({
	method: "post",
	path: "/connect",
	summary: "Connect Identity",
	description: "Connects a new identity to the authenticated user's account. If the identity is already connected to another user, it will be reassigned to the current user.",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						platform: PlatformEnum,
						identity: z.string().min(1),
						metadata: IdentityMetadataSchema.optional(),
						verifiedAt: z.string().datetime().optional(),
						isPrimary: z.boolean().optional().default(false),
						oauthAccessToken: z.string().optional(),
						oauthRefreshToken: z.string().optional(),
						oauthTokenExpiresAt: z.string().datetime().optional(),
					}),
				},
			},
		},
	},
	responses: {
		201: {
			description: "Identity connected successfully",
			content: {
				"application/json": {
					schema: z.object({
						message: z.string(),
						identity: UserIdentitySchema,
						reassigned: z.boolean(),
						previousUserId: z.string().uuid().optional(),
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
	tags: ["Users"],
});

app.openapi(connectIdentityRoute, async (c) => {
	const logger = c.get("logger");
	const userId = c.get("userId");
	const { platform, identity, metadata, verifiedAt, isPrimary, oauthAccessToken, oauthRefreshToken, oauthTokenExpiresAt } = c.req.valid("json");

	if (!userId) {
		logger.warn("Connect identity failed: no user ID in context");
		return c.json({ error: "Unauthorized" }, 401);
	}

	logger.info("Connecting identity to user", {
		userId,
		platform,
		isPrimary,
	});

	try {
		const normalizedIdentity =
			platform === "evm" || platform === "lens"
				? identity.toLowerCase()
				: identity;

		// Check if identity already exists
		logger.logDatabase("query", "userIdentities", { platform, identity: "***masked***" });
		const existingIdentity = await db.query.userIdentities.findFirst({
			where: and(
				eq(userIdentities.platform, platform),
				eq(userIdentities.identity, normalizedIdentity),
			),
		});

		let reassigned = false;
		let previousUserId: string | undefined;

		if (existingIdentity) {
			if (existingIdentity.userId === userId) {
				logger.info("Identity already connected to this user, updating with new data", {
					userId,
					platform,
					hasNewOAuthToken: !!oauthAccessToken,
				});
				
				logger.logDatabase("update", "userIdentities", {
					action: "update_existing_identity",
					userId,
					platform,
				});
				await db
					.update(userIdentities)
					.set({
						metadata: metadata || existingIdentity.metadata,
						verifiedAt: verifiedAt ? new Date(verifiedAt) : existingIdentity.verifiedAt,
						isPrimary: isPrimary !== undefined ? isPrimary : existingIdentity.isPrimary,
						oauthAccessToken: oauthAccessToken || existingIdentity.oauthAccessToken,
						oauthRefreshToken: oauthRefreshToken || existingIdentity.oauthRefreshToken,
						oauthTokenExpiresAt: oauthTokenExpiresAt ? new Date(oauthTokenExpiresAt) : existingIdentity.oauthTokenExpiresAt,
						updatedAt: new Date(),
					})
					.where(
						and(
							eq(userIdentities.platform, platform),
							eq(userIdentities.identity, normalizedIdentity),
						),
					);
			} else {
				previousUserId = existingIdentity.userId;
				logger.info("Reassigning identity from another user", {
					fromUserId: previousUserId,
					toUserId: userId,
					platform,
				});

				logger.logDatabase("update", "userIdentities", {
					action: "reassign_identity",
					fromUserId: previousUserId,
					toUserId: userId,
					platform,
				});
				await db
					.update(userIdentities)
					.set({
						userId,
						metadata: metadata || existingIdentity.metadata,
						verifiedAt: verifiedAt ? new Date(verifiedAt) : existingIdentity.verifiedAt,
						isPrimary: false, 
						oauthAccessToken: oauthAccessToken || existingIdentity.oauthAccessToken,
						oauthRefreshToken: oauthRefreshToken || existingIdentity.oauthRefreshToken,
						oauthTokenExpiresAt: oauthTokenExpiresAt ? new Date(oauthTokenExpiresAt) : existingIdentity.oauthTokenExpiresAt,
						updatedAt: new Date(),
					})
					.where(
						and(
							eq(userIdentities.platform, platform),
							eq(userIdentities.identity, normalizedIdentity),
						),
					);

				logger.info("Starting data migration from previous user", {
					fromUserId: previousUserId,
					toUserId: userId,
				});

				logger.logDatabase("update", "practiceSessions", {
					action: "migrate_user_data",
					fromUserId: previousUserId,
					toUserId: userId,
				});
				await db
					.update(practiceSessions)
					.set({ userId })
					.where(eq(practiceSessions.userId, previousUserId));

				logger.logDatabase("update", "projects", {
					action: "migrate_user_data",
					fromUserId: previousUserId,
					toUserId: userId,
				});
				await db
					.update(projects)
					.set({ userId, updatedAt: new Date() })
					.where(eq(projects.userId, previousUserId));

				const remainingIdentities = await db.query.userIdentities.findMany({
					where: eq(userIdentities.userId, previousUserId),
				});

				if (remainingIdentities.length === 0) {
					logger.info("Deleting dummy user with no remaining identities", {
						userId: previousUserId,
					});
					logger.logDatabase("delete", "users", {
						action: "delete_dummy_user",
						userId: previousUserId,
					});
					await db.delete(users).where(eq(users.id, previousUserId));
				}

				logger.info("Data migration completed successfully", {
					fromUserId: previousUserId,
					toUserId: userId,
					dummyUserDeleted: remainingIdentities.length === 0,
				});

				reassigned = true;
			}
		} else {
			// Create new identity
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
			await db
				.insert(userIdentities)
				.values({
					userId,
					platform,
					identity: normalizedIdentity,
					metadata,
					verifiedAt: verifiedAt ? new Date(verifiedAt) : null,
					isPrimary,
					oauthAccessToken,
					oauthRefreshToken,
					oauthTokenExpiresAt: oauthTokenExpiresAt ? new Date(oauthTokenExpiresAt) : null,
				});
		}

		// Fetch the updated/created identity
		const newIdentity = await db.query.userIdentities.findFirst({
			where: and(
				eq(userIdentities.userId, userId),
				eq(userIdentities.platform, platform),
				eq(userIdentities.identity, normalizedIdentity),
			),
		});

		if (!newIdentity) {
			logger.error("Failed to fetch connected identity");
			return c.json({ error: "Failed to connect identity" }, 500);
		}

		logger.info("Identity connected successfully", {
			userId,
			platform,
			reassigned,
			previousUserId,
		});

		return c.json(
			{
				message: reassigned
					? "Identity reassigned successfully"
					: "Identity connected successfully",
				identity: {
					userId: newIdentity.userId,
					platform: newIdentity.platform as "discord" | "evm" | "lens" | "farcaster" | "telegram" | "github",
					identity: newIdentity.identity,
					isPrimary: newIdentity.isPrimary,
					metadata: newIdentity.metadata as {
						username?: string;
						displayName?: string;
						avatarUrl?: string;
						email?: string;
						bio?: string;
						profileUrl?: string;
					} | null,
					verifiedAt: newIdentity.verifiedAt?.toISOString() || null,
					createdAt: newIdentity.createdAt?.toISOString() || null,
					updatedAt: newIdentity.updatedAt?.toISOString() || null,
				},
				reassigned,
				previousUserId,
			},
			201,
		);
	} catch (error) {
		logger.error("Failed to connect identity", error);
		return c.json({ error: "Failed to connect identity" }, 500);
	}
});

const disconnectIdentityRoute = createRoute({
	method: "delete",
	path: "/{platform}/{identity}",
	summary: "Disconnect Identity",
	description: "Disconnects an identity from the authenticated user's account, ensuring at least one identity remains.",
	request: {
		params: z.object({
			platform: PlatformEnum,
			identity: z.string(),
		}),
	},
	responses: {
		200: {
			description: "Identity disconnected successfully",
			content: {
				"application/json": {
					schema: z.object({
						message: z.string(),
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
	tags: ["Users"],
});

app.openapi(disconnectIdentityRoute, async (c) => {
	const logger = c.get("logger");
	const userId = c.get("userId");
	const { platform, identity } = c.req.valid("param");

	if (!userId) {
		logger.warn("Disconnect identity failed: no user ID in context");
		return c.json({ error: "Unauthorized" }, 401);
	}

	logger.info("Disconnecting identity from user", {
		userId,
		platform,
	});

	try {
		const normalizedIdentity =
			platform === "evm" || platform === "lens"
				? identity.toLowerCase()
				: identity;

		// Check if identity exists and belongs to user
		logger.logDatabase("query", "userIdentities", { userId, platform, identity: "***masked***" });
		const existingIdentity = await db.query.userIdentities.findFirst({
			where: and(
				eq(userIdentities.userId, userId),
				eq(userIdentities.platform, platform),
				eq(userIdentities.identity, normalizedIdentity),
			),
		});

		if (!existingIdentity) {
			logger.warn("Identity not found or not owned by user", {
				userId,
				platform,
			});
			return c.json({ error: "Identity not found" }, 404);
		}

		// Check if user has other identities
		logger.logDatabase("query", "userIdentities", {
			action: "count_identities",
			userId,
		});
		const identityCount = await db
			.select({ count: sql<number>`count(*)` })
			.from(userIdentities)
			.where(eq(userIdentities.userId, userId));

		if (identityCount[0]?.count === 1) {
			logger.warn("Cannot disconnect user's only identity", {
				userId,
				platform,
			});
			return c.json({ error: "Cannot disconnect your only identity" }, 400);
		}

		// Delete the identity
		logger.logDatabase("delete", "userIdentities", {
			userId,
			platform,
			wasPrimary: existingIdentity.isPrimary,
		});
		await db
			.delete(userIdentities)
			.where(
				and(
					eq(userIdentities.userId, userId),
					eq(userIdentities.platform, platform),
					eq(userIdentities.identity, normalizedIdentity),
				),
			);

		// If it was primary, set another identity as primary
		if (existingIdentity.isPrimary) {
			logger.logDatabase("query", "userIdentities", {
				action: "find_remaining_identity",
				userId,
			});
			const remainingIdentity = await db.query.userIdentities.findFirst({
				where: eq(userIdentities.userId, userId),
			});

			if (remainingIdentity) {
				logger.logDatabase("update", "userIdentities", {
					action: "set_new_primary",
					userId,
					newPrimaryPlatform: remainingIdentity.platform,
				});
				await db
					.update(userIdentities)
					.set({ isPrimary: true, updatedAt: new Date() })
					.where(
						and(
							eq(userIdentities.userId, userId),
							eq(userIdentities.platform, remainingIdentity.platform),
							eq(userIdentities.identity, remainingIdentity.identity),
						),
					);
			}
		}

		logger.info("Identity disconnected successfully", {
			userId,
			platform,
			wasPrimary: existingIdentity.isPrimary,
		});

		return c.json(
			{
				message: "Identity disconnected successfully",
			},
			200,
		);
	} catch (error) {
		logger.error("Failed to disconnect identity", error);
		return c.json({ error: "Failed to disconnect identity" }, 500);
	}
});

const setPrimaryIdentityRoute = createRoute({
	method: "put",
	path: "/primary",
	summary: "Set Primary Identity",
	description: "Sets an identity as the primary identity for the authenticated user's account.",
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
			description: "Primary identity set successfully",
			content: {
				"application/json": {
					schema: z.object({
						message: z.string(),
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
	tags: ["Users"],
});

app.openapi(setPrimaryIdentityRoute, async (c) => {
	const logger = c.get("logger");
	const userId = c.get("userId");
	const { platform, identity } = c.req.valid("json");

	if (!userId) {
		logger.warn("Set primary identity failed: no user ID in context");
		return c.json({ error: "Unauthorized" }, 401);
	}

	logger.info("Setting primary identity for user", {
		userId,
		platform,
	});

	try {
		const normalizedIdentity =
			platform === "evm" || platform === "lens"
				? identity.toLowerCase()
				: identity;

		// Check if identity exists and belongs to user
		logger.logDatabase("query", "userIdentities", { userId, platform, identity: "***masked***" });
		const existingIdentity = await db.query.userIdentities.findFirst({
			where: and(
				eq(userIdentities.userId, userId),
				eq(userIdentities.platform, platform),
				eq(userIdentities.identity, normalizedIdentity),
			),
		});

		if (!existingIdentity) {
			logger.warn("Identity not found or not owned by user", {
				userId,
				platform,
			});
			return c.json({ error: "Identity not found" }, 404);
		}

		if (existingIdentity.isPrimary) {
			logger.info("Identity is already primary", {
				userId,
				platform,
			});
			return c.json({ message: "Identity is already primary" }, 200);
		}

		// Unset current primary
		logger.logDatabase("update", "userIdentities", {
			action: "unset_current_primary",
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

		// Set new primary
		logger.logDatabase("update", "userIdentities", {
			action: "set_new_primary",
			userId,
			platform,
		});
		await db
			.update(userIdentities)
			.set({ isPrimary: true, updatedAt: new Date() })
			.where(
				and(
					eq(userIdentities.userId, userId),
					eq(userIdentities.platform, platform),
					eq(userIdentities.identity, normalizedIdentity),
				),
			);

		logger.info("Primary identity set successfully", {
			userId,
			platform,
		});

		return c.json(
			{
				message: "Primary identity set successfully",
			},
			200,
		);
	} catch (error) {
		logger.error("Failed to set primary identity", error);
		return c.json({ error: "Failed to set primary identity" }, 500);
	}
});

export default app;