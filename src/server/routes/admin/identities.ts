import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { and, eq, sql } from "drizzle-orm";
import { db, userIdentities, users } from "../../../client";
import { requireJwtAuth } from "../../middleware/auth";

const app = new OpenAPIHono();

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
	const { userId, platform, identity, isPrimary } = c.req.valid("json");

	try {
		const normalizedIdentity =
			platform === "evm" || platform === "lens"
				? identity.toLowerCase()
				: identity;

		const user = await db.query.users.findFirst({
			where: eq(users.id, userId),
		});

		if (!user) {
			return c.json({ error: "User not found" }, 404);
		}

		const existingIdentity = await db.query.userIdentities.findFirst({
			where: and(
				eq(userIdentities.platform, platform),
				eq(userIdentities.identity, normalizedIdentity),
			),
		});

		if (existingIdentity) {
			if (existingIdentity.userId === userId) {
				return c.json(
					{ error: "Identity already connected to this user" },
					400,
				);
			}
			return c.json(
				{ error: "Identity already connected to another user" },
				400,
			);
		}

		if (isPrimary) {
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

		const [newIdentity] = await db
			.insert(userIdentities)
			.values({
				userId,
				platform,
				identity: normalizedIdentity,
				isPrimary,
			})
			.returning();

		return c.json(
			{
				message: "Identity connected successfully",
				identity: newIdentity,
			},
			201,
		);
	} catch (error) {
		console.error("[API] Error connecting identity:", error);
		return c.json({ error: "Failed to connect identity" }, 500);
	}
});

const disconnectIdentityRoute = createRoute({
	method: "delete",
	path: "/disconnect",
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
	const { platform, identity } = c.req.valid("json");

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
		});

		if (!existingIdentity) {
			return c.json({ error: "Identity not found" }, 404);
		}

		const identityCount = await db
			.select({ count: sql<number>`count(*)` })
			.from(userIdentities)
			.where(eq(userIdentities.userId, existingIdentity.userId));

		if (identityCount[0]?.count === 1) {
			return c.json({ error: "Cannot disconnect user's only identity" }, 400);
		}

		await db
			.delete(userIdentities)
			.where(
				and(
					eq(userIdentities.platform, platform),
					eq(userIdentities.identity, normalizedIdentity),
				),
			);

		if (existingIdentity.isPrimary) {
			const remainingIdentity = await db.query.userIdentities.findFirst({
				where: eq(userIdentities.userId, existingIdentity.userId),
			});

			if (remainingIdentity) {
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

		return c.json({
			message: "Identity disconnected successfully",
			userId: existingIdentity.userId,
		});
	} catch (error) {
		console.error("[API] Error disconnecting identity:", error);
		return c.json({ error: "Failed to disconnect identity" }, 500);
	}
});

const setPrimaryRoute = createRoute({
	method: "put",
	path: "/set-primary",
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
	const { platform, identity } = c.req.valid("json");

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
		});

		if (!existingIdentity) {
			return c.json({ error: "Identity not found" }, 404);
		}

		if (existingIdentity.isPrimary) {
			return c.json({ message: "Identity is already primary" });
		}

		await db
			.update(userIdentities)
			.set({ isPrimary: false, updatedAt: new Date() })
			.where(
				and(
					eq(userIdentities.userId, existingIdentity.userId),
					eq(userIdentities.isPrimary, true),
				),
			);

		await db
			.update(userIdentities)
			.set({ isPrimary: true, updatedAt: new Date() })
			.where(
				and(
					eq(userIdentities.platform, platform),
					eq(userIdentities.identity, normalizedIdentity),
				),
			);

		return c.json({
			message: "Identity set as primary successfully",
			userId: existingIdentity.userId,
		});
	} catch (error) {
		console.error("[API] Error setting primary identity:", error);
		return c.json({ error: "Failed to set primary identity" }, 500);
	}
});

const mergeUsersRoute = createRoute({
	method: "post",
	path: "/merge-users",
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
	const { sourceUserId, targetUserId } = c.req.valid("json");

	if (sourceUserId === targetUserId) {
		return c.json({ error: "Cannot merge user with itself" }, 400);
	}

	try {
		const [sourceUser, targetUser] = await Promise.all([
			db.query.users.findFirst({ where: eq(users.id, sourceUserId) }),
			db.query.users.findFirst({ where: eq(users.id, targetUserId) }),
		]);

		if (!sourceUser || !targetUser) {
			return c.json({ error: "One or both users not found" }, 404);
		}

		const sourceIdentities = await db.query.userIdentities.findMany({
			where: eq(userIdentities.userId, sourceUserId),
		});

		if (sourceIdentities.length === 0) {
			return c.json({ error: "Source user has no identities" }, 400);
		}

		await db
			.update(userIdentities)
			.set({
				userId: targetUserId,
				isPrimary: false,
				updatedAt: new Date(),
			})
			.where(eq(userIdentities.userId, sourceUserId));

		await db.delete(users).where(eq(users.id, sourceUserId));

		return c.json({
			message: "Users merged successfully",
			targetUserId,
			mergedIdentities: sourceIdentities.length,
		});
	} catch (error) {
		console.error("[API] Error merging users:", error);
		return c.json({ error: "Failed to merge users" }, 500);
	}
});

export default app;
