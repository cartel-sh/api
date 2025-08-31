import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import { db, vanishingChannels } from "../../../client";
import { requestLogging } from "../../middleware/logging";
import {
	CreateVanishingChannelSchema,
	VanishingChannelSchema,
	VanishingChannelSuccessSchema,
	VanishingChannelStatsSchema,
	ErrorResponseSchema,
	type VanishingChannel,
} from "../../../shared/schemas";

type Variables = {
	userId?: string;
	logger?: any;
};

const app = new OpenAPIHono<{ Variables: Variables }>();

app.use("*", requestLogging());
const createVanishingChannelRoute = createRoute({
	method: "post",
	path: "/",
	description: "Configure a Discord channel to automatically delete messages after a specified duration",
	summary: "Create vanishing channel",
	request: {
		body: {
			content: {
				"application/json": {
					schema: CreateVanishingChannelSchema,
				},
			},
		},
	},
	responses: {
		200: {
			description: "Vanishing channel created or updated",
			content: {
				"application/json": {
					schema: VanishingChannelSuccessSchema,
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
	tags: ["Discord"],
});

app.openapi(createVanishingChannelRoute, async (c) => {
	const logger = c.get("logger");
	const { channelId, guildId, duration } = c.req.valid("json");

	logger.info("Creating vanishing channel configuration", {
		channelId,
		guildId,
		duration,
		durationHours: Math.round((duration / 3600) * 10) / 10,
	});

	try {
		logger.logDatabase("upsert", "vanishingChannels", {
			channelId,
			guildId,
			duration,
			action: "create_or_update_vanishing_channel",
		});
		await db
			.insert(vanishingChannels)
			.values({
				channelId,
				guildId,
				vanishAfter: duration,
				messagesDeleted: 0,
			})
			.onConflictDoUpdate({
				target: vanishingChannels.channelId,
				set: {
					guildId,
					vanishAfter: duration,
					updatedAt: new Date(),
				},
			});

		logger.info("Vanishing channel configured successfully", {
			channelId,
			guildId,
			duration,
		});

		return c.json({ success: true }, 200);
	} catch (error) {
		logger.error("Vanishing channel configuration failed", error);
		return c.json({ error: "Failed to set vanishing channel" }, 500);
	}
});

const deleteVanishingChannelRoute = createRoute({
	method: "delete",
	path: "/{channelId}",
	description: "Remove vanishing configuration from a Discord channel",
	summary: "Delete vanishing channel",
	request: {
		params: z.object({
			channelId: z.string(),
		}),
	},
	responses: {
		200: {
			description: "Vanishing channel deleted",
			content: {
				"application/json": {
					schema: VanishingChannelSuccessSchema,
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
	tags: ["Discord"],
});

app.openapi(deleteVanishingChannelRoute, async (c) => {
	const logger = c.get("logger");
	const { channelId } = c.req.valid("param");

	logger.info("Deleting vanishing channel configuration", { channelId });

	try {
		logger.logDatabase("delete", "vanishingChannels", {
			channelId,
		});
		await db
			.delete(vanishingChannels)
			.where(eq(vanishingChannels.channelId, channelId));

		logger.info("Vanishing channel configuration deleted successfully", { channelId });

		return c.json({ success: true }, 200);
	} catch (error) {
		logger.error("Vanishing channel deletion failed", error);
		return c.json({ error: "Failed to remove vanishing channel" }, 500);
	}
});

const listVanishingChannelsRoute = createRoute({
	method: "get",
	path: "/",
	description: "List all configured vanishing channels, optionally filtered by guild ID",
	summary: "List vanishing channels",
	request: {
		query: z.object({
			guildId: z.string().optional(),
		}),
	},
	responses: {
		200: {
			description: "List of vanishing channels",
			content: {
				"application/json": {
					schema: z.array(VanishingChannelSchema),
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
	tags: ["Discord"],
});

app.openapi(listVanishingChannelsRoute, async (c) => {
	const logger = c.get("logger");
	const { guildId } = c.req.valid("query");

	logger.info("Listing vanishing channels", {
		guildId: guildId || "all_guilds",
		filtered: !!guildId,
	});

	try {
		let channels;

		if (guildId) {
			logger.logDatabase("query", "vanishingChannels", {
				action: "find_by_guild_id",
				guildId,
			});
			channels = await db.query.vanishingChannels.findMany({
				where: eq(vanishingChannels.guildId, guildId),
			});
		} else {
			logger.logDatabase("query", "vanishingChannels", {
				action: "find_all",
			});
			channels = await db.query.vanishingChannels.findMany();
		}

		const formattedChannels: VanishingChannel[] = channels.map((channel) => ({
			channelId: channel.channelId,
			guildId: channel.guildId,
			vanishAfter: channel.vanishAfter,
			messagesDeleted: Number(channel.messagesDeleted) || 0,
			lastDeletion: channel.lastDeletion?.toISOString() || null,
			createdAt: channel.createdAt?.toISOString() || null,
			updatedAt: channel.updatedAt?.toISOString() || null,
		}));

		const totalMessages = formattedChannels.reduce((sum, ch) => sum + ch.messagesDeleted, 0);
		const guilds = new Set(formattedChannels.map(ch => ch.guildId)).size;

		logger.info("Vanishing channels retrieved successfully", {
			channelCount: formattedChannels.length,
			guildCount: guilds,
			totalMessagesDeleted: totalMessages,
			guildFilter: guildId || null,
		});

		return c.json(formattedChannels, 200);
	} catch (error) {
		logger.error("Vanishing channels listing failed", error);
		return c.json({ error: "Failed to get vanishing channels" }, 500);
	}
});

const getVanishingChannelRoute = createRoute({
	method: "get",
	path: "/{channelId}",
	description: "Get detailed information about a specific vanishing channel configuration",
	summary: "Get vanishing channel",
	request: {
		params: z.object({
			channelId: z.string(),
		}),
	},
	responses: {
		200: {
			description: "Vanishing channel details",
			content: {
				"application/json": {
					schema: VanishingChannelSchema,
				},
			},
		},
		404: {
			description: "Channel not found",
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
	tags: ["Discord"],
});

app.openapi(getVanishingChannelRoute, async (c) => {
	const logger = c.get("logger");
	const { channelId } = c.req.valid("param");

	logger.info("Getting vanishing channel details", { channelId });

	try {
		logger.logDatabase("query", "vanishingChannels", {
			action: "find_by_channel_id",
			channelId,
		});
		const channel = await db.query.vanishingChannels.findFirst({
			where: eq(vanishingChannels.channelId, channelId),
		});

		if (!channel) {
			logger.warn("Vanishing channel not found", { channelId });
			return c.json({ error: "Channel not found" }, 404);
		}

		const formattedChannel = {
			channelId: channel.channelId,
			guildId: channel.guildId,
			vanishAfter: channel.vanishAfter,
			messagesDeleted: Number(channel.messagesDeleted) || 0,
			lastDeletion: channel.lastDeletion?.toISOString() || null,
			createdAt: channel.createdAt?.toISOString() || null,
			updatedAt: channel.updatedAt?.toISOString() || null,
		};

		logger.info("Vanishing channel details retrieved successfully", {
			channelId,
			guildId: channel.guildId,
			vanishAfter: channel.vanishAfter,
			messagesDeleted: formattedChannel.messagesDeleted,
			lastDeletion: formattedChannel.lastDeletion,
		});

		return c.json(formattedChannel, 200);
	} catch (error) {
		logger.error("Vanishing channel details retrieval failed", error);
		return c.json({ error: "Failed to get vanishing channel" }, 500);
	}
});

const updateChannelStatsRoute = createRoute({
	method: "patch",
	path: "/{channelId}/stats",
	description: "Update the deletion statistics for a vanishing channel",
	summary: "Update channel stats",
	request: {
		params: z.object({
			channelId: z.string(),
		}),
		body: {
			content: {
				"application/json": {
					schema: z.object({
						deletedCount: z.number().positive(),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			description: "Stats updated successfully",
			content: {
				"application/json": {
					schema: VanishingChannelStatsSchema,
				},
			},
		},
		404: {
			description: "Channel not found",
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
	tags: ["Discord"],
});

app.openapi(updateChannelStatsRoute, async (c) => {
	const logger = c.get("logger");
	const { channelId } = c.req.valid("param");
	const { deletedCount } = c.req.valid("json");

	logger.info("Updating vanishing channel stats", {
		channelId,
		deletedCount,
	});

	try {
		logger.logDatabase("query", "vanishingChannels", {
			action: "find_current_channel",
			channelId,
		});
		const currentChannel = await db.query.vanishingChannels.findFirst({
			where: eq(vanishingChannels.channelId, channelId),
		});

		if (!currentChannel) {
			logger.warn("Channel not found for stats update", { channelId });
			return c.json({ error: "Channel not found" }, 404);
		}

		const previousCount = Number(currentChannel.messagesDeleted) || 0;
		const newCount = previousCount + deletedCount;

		logger.info("Calculating updated message count", {
			channelId,
			previousCount,
			deletedCount,
			newCount,
		});

		const lastDeletion = new Date();
		logger.logDatabase("update", "vanishingChannels", {
			channelId,
			newCount,
			lastDeletion: lastDeletion.toISOString(),
		});
		await db
			.update(vanishingChannels)
			.set({
				messagesDeleted: newCount,
				lastDeletion,
				updatedAt: new Date(),
			})
			.where(eq(vanishingChannels.channelId, channelId));

		logger.info("Vanishing channel stats updated successfully", {
			channelId,
			previousCount,
			newCount,
			deletedCount,
			lastDeletion: lastDeletion.toISOString(),
		});

		return c.json({ success: true, newCount }, 200);
	} catch (error) {
		logger.error("Vanishing channel stats update failed", error);
		return c.json({ error: "Failed to update channel stats" }, 500);
	}
});

export default app;
