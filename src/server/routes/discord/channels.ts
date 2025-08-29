import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { and, eq } from "drizzle-orm";
import { db, channelSettings } from "../../../client";
import type { ChannelSetting } from "../../../schema";

const app = new OpenAPIHono();

const getChannelSettingRoute = createRoute({
	method: "get",
	path: "/{guildId}/{key}",
	description: "Retrieve a specific channel setting for a Discord guild",
	summary: "Get channel setting",
	request: {
		params: z.object({
			guildId: z.string(),
			key: z.string(),
		}),
	},
	responses: {
		200: {
			description: "Channel setting retrieved successfully",
			content: {
				"application/json": {
					schema: z.object({
						id: z.string(),
						guildId: z.string(),
						key: z.string(),
						channelId: z.string(),
						createdAt: z.string().nullable(),
						updatedAt: z.string().nullable(),
					}),
				},
			},
		},
		404: {
			description: "Channel setting not found",
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
	tags: ["Discord"],
});

app.openapi(getChannelSettingRoute, async (c) => {
	const { guildId, key } = c.req.valid("param");

	try {
		const setting = await db.query.channelSettings.findFirst({
			where: and(
				eq(channelSettings.guildId, guildId),
				eq(channelSettings.key, key),
			),
		});

		if (!setting) {
			return c.json({ error: "Channel setting not found" }, 404);
		}

		return c.json(setting as ChannelSetting, 200);
	} catch (error) {
		console.error("[API] Error getting channel setting:", error);
		return c.json({ error: "Failed to get channel setting" }, 500);
	}
});

const listChannelSettingsRoute = createRoute({
	method: "get",
	path: "/{guildId}",
	description: "List all channel settings for a Discord guild",
	summary: "List channel settings",
	request: {
		params: z.object({
			guildId: z.string(),
		}),
	},
	responses: {
		200: {
			description: "List of channel settings",
			content: {
				"application/json": {
					schema: z.array(
						z.object({
							id: z.string(),
							guildId: z.string(),
							key: z.string(),
							channelId: z.string(),
							createdAt: z.string().nullable(),
							updatedAt: z.string().nullable(),
						}),
					),
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
	tags: ["Discord"],
});

app.openapi(listChannelSettingsRoute, async (c) => {
	const { guildId } = c.req.valid("param");

	try {
		const settings = await db.query.channelSettings.findMany({
			where: eq(channelSettings.guildId, guildId),
		});

		return c.json(settings as ChannelSetting[], 200);
	} catch (error) {
		console.error("[API] Error getting channel settings:", error);
		return c.json({ error: "Failed to get channel settings" }, 500);
	}
});

const updateChannelSettingRoute = createRoute({
	method: "put",
	path: "/{guildId}/{key}",
	description: "Update or create a channel setting for a Discord guild",
	summary: "Update channel setting",
	request: {
		params: z.object({
			guildId: z.string(),
			key: z.string(),
		}),
		body: {
			content: {
				"application/json": {
					schema: z.object({
						channelId: z.string(),
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
		500: {
			description: "Internal server error",
			content: {
				"application/json": {
					schema: z.any(),
				},
			},
		},
	},
	tags: ["Discord"],
});

app.openapi(updateChannelSettingRoute, async (c) => {
	const guildId = c.req.valid("param").guildId;
	const key = c.req.valid("param").key;
	const { channelId } = c.req.valid("json");

	try {
		const existing = await db.query.channelSettings.findFirst({
			where: and(
				eq(channelSettings.guildId, guildId),
				eq(channelSettings.key, key),
			),
		});

		let result;
		if (existing) {
			[result] = await db
				.update(channelSettings)
				.set({
					channelId,
					updatedAt: new Date(),
				})
				.where(
					and(
						eq(channelSettings.guildId, guildId),
						eq(channelSettings.key, key),
					),
				)
				.returning();
		} else {
			[result] = await db
				.insert(channelSettings)
				.values({
					guildId,
					key,
					channelId,
				})
				.returning();
		}

		return c.json(result as ChannelSetting, 200);
	} catch (error) {
		console.error("[API] Error updating channel setting:", error);
		return c.json({ error: "Failed to update channel setting" }, 500);
	}
});

const deleteChannelSettingRoute = createRoute({
	method: "delete",
	path: "/{guildId}/{key}",
	description: "Delete a specific channel setting for a Discord guild",
	summary: "Delete channel setting",
	request: {
		params: z.object({
			guildId: z.string(),
			key: z.string(),
		}),
	},
	responses: {
		200: {
			description: "Channel setting deleted successfully",
			content: {
				"application/json": {
					schema: z.object({
						success: z.boolean(),
					}),
				},
			},
		},
		404: {
			description: "Channel setting not found",
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
	tags: ["Discord"],
});

app.openapi(deleteChannelSettingRoute, async (c) => {
	const { guildId, key } = c.req.valid("param");

	try {
		const [deleted] = await db
			.delete(channelSettings)
			.where(
				and(eq(channelSettings.guildId, guildId), eq(channelSettings.key, key)),
			)
			.returning();

		if (!deleted) {
			return c.json({ error: "Channel setting not found" }, 404);
		}

		return c.json({ success: true }, 200);
	} catch (error) {
		console.error("[API] Error deleting channel setting:", error);
		return c.json({ error: "Failed to delete channel setting" }, 500);
	}
});

const deleteAllChannelSettingsRoute = createRoute({
	method: "delete",
	path: "/{guildId}",
	description: "Delete all channel settings for a Discord guild",
	summary: "Delete all channel settings",
	request: {
		params: z.object({
			guildId: z.string(),
		}),
	},
	responses: {
		200: {
			description: "All channel settings deleted successfully",
			content: {
				"application/json": {
					schema: z.object({
						success: z.boolean(),
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
	tags: ["Discord"],
});

app.openapi(deleteAllChannelSettingsRoute, async (c) => {
	const { guildId } = c.req.valid("param");

	try {
		await db
			.delete(channelSettings)
			.where(eq(channelSettings.guildId, guildId));

		return c.json({ success: true }, 200);
	} catch (error) {
		console.error("[API] Error deleting channel settings:", error);
		return c.json({ error: "Failed to delete channel settings" }, 500);
	}
});

export default app;