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

app.get("/by-evm/:address", async (c) => {
	const address = c.req.param("address").toLowerCase();

	try {
		const identity = await db.query.userIdentities.findFirst({
			where: and(
				eq(userIdentities.platform, "evm"),
				eq(userIdentities.identity, address),
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
			user: identity.user,
			identity: {
				platform: identity.platform,
				identity: identity.identity,
				isPrimary: identity.isPrimary,
			},
		});
	} catch (error) {
		console.error("[API] Error getting user by EVM address:", error);
		return c.json({ error: "Failed to get user" }, 500);
	}
});

app.get("/by-lens/:address", async (c) => {
	const address = c.req.param("address").toLowerCase();

	try {
		const identity = await db.query.userIdentities.findFirst({
			where: and(
				eq(userIdentities.platform, "lens"),
				eq(userIdentities.identity, address),
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
			user: identity.user,
			identity: {
				platform: identity.platform,
				identity: identity.identity,
				isPrimary: identity.isPrimary,
			},
		});
	} catch (error) {
		console.error("[API] Error getting user by Lens:", error);
		return c.json({ error: "Failed to get user" }, 500);
	}
});

app.get("/by-farcaster/:fid", async (c) => {
	const fid = c.req.param("fid");

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
			user: identity.user,
			identity: {
				platform: identity.platform,
				identity: identity.identity,
				isPrimary: identity.isPrimary,
			},
		});
	} catch (error) {
		console.error("[API] Error getting user by Farcaster FID:", error);
		return c.json({ error: "Failed to get user" }, 500);
	}
});

app.get("/by-discord/:discordId", async (c) => {
	const discordId = c.req.param("discordId");

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
			user: identity.user,
			identity: {
				platform: identity.platform,
				identity: identity.identity,
				isPrimary: identity.isPrimary,
			},
		});
	} catch (error) {
		console.error("[API] Error getting user by Discord ID:", error);
		return c.json({ error: "Failed to get user" }, 500);
	}
});

app.get("/by-telegram/:telegramId", async (c) => {
	const telegramId = c.req.param("telegramId");

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
			user: identity.user,
			identity: {
				platform: identity.platform,
				identity: identity.identity,
				isPrimary: identity.isPrimary,
			},
		});
	} catch (error) {
		console.error("[API] Error getting user by Telegram ID:", error);
		return c.json({ error: "Failed to get user" }, 500);
	}
});

const createIdentityRoute = createRoute({
	method: "post",
	path: "/",
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
			description: "Success",
			content: {
				"application/json": {
					schema: z.any(),
				},
			},
		},
		201: {
			description: "Success",
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
				user: existingIdentity.user,
				identity: existingIdentity,
				created: false,
			});
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
				user: newUser,
				identity: newIdentity,
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
