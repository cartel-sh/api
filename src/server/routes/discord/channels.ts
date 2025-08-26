import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db, channelSettings } from "../../../client";
import type { ChannelSetting } from "../../../schema";

const app = new Hono();

// GET /api/discord/channels/:guildId/:key
app.get("/:guildId/:key", async (c) => {
  const guildId = c.req.param("guildId");
  const key = c.req.param("key");
  
  try {
    const setting = await db.query.channelSettings.findFirst({
      where: and(
        eq(channelSettings.guildId, guildId),
        eq(channelSettings.key, key)
      ),
    });

    if (!setting) {
      return c.json({ error: "Channel setting not found" }, 404);
    }

    return c.json(setting as ChannelSetting);
  } catch (error) {
    console.error("[API] Error getting channel setting:", error);
    return c.json({ error: "Failed to get channel setting" }, 500);
  }
});

// GET /api/discord/channels/:guildId
app.get("/:guildId", async (c) => {
  const guildId = c.req.param("guildId");
  
  try {
    const settings = await db.query.channelSettings.findMany({
      where: eq(channelSettings.guildId, guildId),
    });

    return c.json(settings as ChannelSetting[]);
  } catch (error) {
    console.error("[API] Error getting channel settings:", error);
    return c.json({ error: "Failed to get channel settings" }, 500);
  }
});

// PUT /api/discord/channels/:guildId/:key
app.put(
  "/:guildId/:key",
  zValidator(
    "json",
    z.object({
      channelId: z.string(),
    }),
  ),
  async (c) => {
    const guildId = c.req.param("guildId");
    const key = c.req.param("key");
    const { channelId } = c.req.valid("json");
    
    try {
      // Check if setting exists
      const existing = await db.query.channelSettings.findFirst({
        where: and(
          eq(channelSettings.guildId, guildId),
          eq(channelSettings.key, key)
        ),
      });

      let result;
      if (existing) {
        // Update existing setting
        [result] = await db
          .update(channelSettings)
          .set({
            channelId,
            updatedAt: new Date(),
          })
          .where(and(
            eq(channelSettings.guildId, guildId),
            eq(channelSettings.key, key)
          ))
          .returning();
      } else {
        // Insert new setting
        [result] = await db
          .insert(channelSettings)
          .values({
            guildId,
            key,
            channelId,
          })
          .returning();
      }

      return c.json(result as ChannelSetting);
    } catch (error) {
      console.error("[API] Error updating channel setting:", error);
      return c.json({ error: "Failed to update channel setting" }, 500);
    }
  },
);

// DELETE /api/discord/channels/:guildId/:key
app.delete("/:guildId/:key", async (c) => {
  const guildId = c.req.param("guildId");
  const key = c.req.param("key");
  
  try {
    const [deleted] = await db
      .delete(channelSettings)
      .where(and(
        eq(channelSettings.guildId, guildId),
        eq(channelSettings.key, key)
      ))
      .returning();

    if (!deleted) {
      return c.json({ error: "Channel setting not found" }, 404);
    }

    return c.json({ success: true });
  } catch (error) {
    console.error("[API] Error deleting channel setting:", error);
    return c.json({ error: "Failed to delete channel setting" }, 500);
  }
});

// DELETE /api/discord/channels/:guildId
app.delete("/:guildId", async (c) => {
  const guildId = c.req.param("guildId");
  
  try {
    await db
      .delete(channelSettings)
      .where(eq(channelSettings.guildId, guildId));

    return c.json({ success: true });
  } catch (error) {
    console.error("[API] Error deleting channel settings:", error);
    return c.json({ error: "Failed to delete channel settings" }, 500);
  }
});

export default app;