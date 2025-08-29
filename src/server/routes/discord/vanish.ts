import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import { db, vanishingChannels } from "../../../client";
import type { VanishingChannel } from "../../../schema";

const app = new OpenAPIHono();
const createVanishingChannelRoute = createRoute({
	method: "post",
	path: "/",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						channelId: z.string().describe("Discord channel ID"),
						guildId: z.string().describe("Discord guild ID"),
						duration: z
							.number()
							.positive()
							.describe("Vanish duration in seconds"),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			description: "Vanishing channel created or updated",
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

app.openapi(createVanishingChannelRoute, async (c) => {
	const { channelId, guildId, duration } = c.req.valid("json");

	try {
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

		return c.json({ success: true }, 200);
	} catch (error) {
		console.error("[API] Error setting vanishing channel:", error);
		return c.json({ error: "Failed to set vanishing channel" }, 500);
	}
});

const deleteVanishingChannelRoute = createRoute({
	method: "delete",
	path: "/{channelId}",
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

app.openapi(deleteVanishingChannelRoute, async (c) => {
	const { channelId } = c.req.valid("param");

	try {
		await db
			.delete(vanishingChannels)
			.where(eq(vanishingChannels.channelId, channelId));

		return c.json({ success: true }, 200);
	} catch (error) {
		console.error("[API] Error removing vanishing channel:", error);
		return c.json({ error: "Failed to remove vanishing channel" }, 500);
	}
});

const listVanishingChannelsRoute = createRoute({
	method: "get",
	path: "/",
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
					schema: z.array(
						z.object({
							channelId: z.string(),
							guildId: z.string(),
							vanishAfter: z.number(),
							messagesDeleted: z.number(),
							lastDeletion: z.string().nullable(),
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

app.openapi(listVanishingChannelsRoute, async (c) => {
	const { guildId } = c.req.valid("query");

	try {
		let channels;

		if (guildId) {
			channels = await db.query.vanishingChannels.findMany({
				where: eq(vanishingChannels.guildId, guildId),
			});
		} else {
			channels = await db.query.vanishingChannels.findMany();
		}

		const formattedChannels: VanishingChannel[] = channels.map((channel) => ({
			...channel,
			messagesDeleted: Number(channel.messagesDeleted) || 0,
			lastDeletion: channel.lastDeletion || null,
		}));

		return c.json(formattedChannels, 200);
	} catch (error) {
		console.error("[API] Error getting vanishing channels:", error);
		return c.json({ error: "Failed to get vanishing channels" }, 500);
	}
});

const getVanishingChannelRoute = createRoute({
	method: "get",
	path: "/{channelId}",
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
					schema: z.object({
						channelId: z.string(),
						guildId: z.string(),
						vanishAfter: z.number(),
						messagesDeleted: z.number(),
						lastDeletion: z.string().nullable(),
						createdAt: z.string().nullable(),
						updatedAt: z.string().nullable(),
					}),
				},
			},
		},
		404: {
			description: "Channel not found",
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

app.openapi(getVanishingChannelRoute, async (c) => {
	const { channelId } = c.req.valid("param");

	try {
		const channel = await db.query.vanishingChannels.findFirst({
			where: eq(vanishingChannels.channelId, channelId),
		});

		if (!channel) {
			return c.json({ error: "Channel not found" }, 404);
		}

		const formattedChannel = {
			...channel,
			messagesDeleted: Number(channel.messagesDeleted) || 0,
			lastDeletion: channel.lastDeletion || null,
		};

		return c.json(formattedChannel, 200);
	} catch (error) {
		console.error("[API] Error getting vanishing channel:", error);
		return c.json({ error: "Failed to get vanishing channel" }, 500);
	}
});

const updateChannelStatsRoute = createRoute({
	method: "patch",
	path: "/{channelId}/stats",
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
					schema: z.object({
						success: z.boolean(),
						newCount: z.number(),
					}),
				},
			},
		},
		404: {
			description: "Channel not found",
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

app.openapi(updateChannelStatsRoute, async (c) => {
	const { channelId } = c.req.valid("param");
	const { deletedCount } = c.req.valid("json");

	try {
		const currentChannel = await db.query.vanishingChannels.findFirst({
			where: eq(vanishingChannels.channelId, channelId),
		});

		if (!currentChannel) {
			return c.json({ error: "Channel not found" }, 404);
		}

		const newCount =
			(Number(currentChannel.messagesDeleted) || 0) + deletedCount;

		await db
			.update(vanishingChannels)
			.set({
				messagesDeleted: newCount,
				lastDeletion: new Date(),
				updatedAt: new Date(),
			})
			.where(eq(vanishingChannels.channelId, channelId));

		return c.json({ success: true, newCount }, 200);
	} catch (error) {
		console.error("[API] Error updating vanishing channel stats:", error);
		return c.json({ error: "Failed to update channel stats" }, 500);
	}
});

export default app;
