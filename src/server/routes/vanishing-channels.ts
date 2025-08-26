import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, vanishingChannels } from "../../client";
import type { VanishingChannel } from "../../schema";

const app = new Hono();

// POST /api/vanishing-channels
app.post(
  "/",
  zValidator(
    "json",
    z.object({
      channelId: z.string(),
      guildId: z.string(),
      duration: z.number().positive(),
    }),
  ),
  async (c) => {
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

      return c.json({ success: true });
    } catch (error) {
      console.error("[API] Error setting vanishing channel:", error);
      return c.json({ error: "Failed to set vanishing channel" }, 500);
    }
  },
);

// DELETE /api/vanishing-channels/:channelId
app.delete("/:channelId", async (c) => {
  const channelId = c.req.param("channelId");
  
  try {
    await db
      .delete(vanishingChannels)
      .where(eq(vanishingChannels.channelId, channelId));
    
    return c.json({ success: true });
  } catch (error) {
    console.error("[API] Error removing vanishing channel:", error);
    return c.json({ error: "Failed to remove vanishing channel" }, 500);
  }
});

// GET /api/vanishing-channels
app.get("/", async (c) => {
  const guildId = c.req.query("guildId");
  
  try {
    let channels;

    if (guildId) {
      channels = await db.query.vanishingChannels.findMany({
        where: eq(vanishingChannels.guildId, guildId),
      });
    } else {
      channels = await db.query.vanishingChannels.findMany();
    }

    // Ensure proper typing for messagesDeleted and lastDeletion
    const formattedChannels: VanishingChannel[] = channels.map((channel) => ({
      ...channel,
      messagesDeleted: Number(channel.messagesDeleted) || 0,
      lastDeletion: channel.lastDeletion || null,
    }));

    return c.json(formattedChannels);
  } catch (error) {
    console.error("[API] Error getting vanishing channels:", error);
    return c.json({ error: "Failed to get vanishing channels" }, 500);
  }
});

// GET /api/vanishing-channels/:channelId
app.get("/:channelId", async (c) => {
  const channelId = c.req.param("channelId");
  
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

    return c.json(formattedChannel);
  } catch (error) {
    console.error("[API] Error getting vanishing channel:", error);
    return c.json({ error: "Failed to get vanishing channel" }, 500);
  }
});

// PATCH /api/vanishing-channels/:channelId/stats
app.patch(
  "/:channelId/stats",
  zValidator(
    "json",
    z.object({
      deletedCount: z.number().positive(),
    }),
  ),
  async (c) => {
    const channelId = c.req.param("channelId");
    const { deletedCount } = c.req.valid("json");
    
    try {
      // First get current count
      const currentChannel = await db.query.vanishingChannels.findFirst({
        where: eq(vanishingChannels.channelId, channelId),
      });

      if (!currentChannel) {
        return c.json({ error: "Channel not found" }, 404);
      }

      const newCount = (Number(currentChannel.messagesDeleted) || 0) + deletedCount;

      await db
        .update(vanishingChannels)
        .set({
          messagesDeleted: newCount,
          lastDeletion: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(vanishingChannels.channelId, channelId));

      return c.json({ success: true, newCount });
    } catch (error) {
      console.error("[API] Error updating vanishing channel stats:", error);
      return c.json({ error: "Failed to update channel stats" }, 500);
    }
  },
);

export default app;