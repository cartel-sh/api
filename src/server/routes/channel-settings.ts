import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, channelSettings } from "../../client";
import type { ChannelSetting } from "../../schema";

const app = new Hono();

// PUT /api/channel-settings/:guildId
app.put(
  "/:guildId",
  zValidator(
    "json",
    z.object({
      voiceChannelId: z.string(),
      textChannelId: z.string(),
    }),
  ),
  async (c) => {
    const guildId = c.req.param("guildId");
    const { voiceChannelId, textChannelId } = c.req.valid("json");
    
    try {
      const result = await db
        .insert(channelSettings)
        .values({
          guildId,
          voiceChannelId,
          textChannelId,
        })
        .onConflictDoUpdate({
          target: channelSettings.guildId,
          set: {
            voiceChannelId,
            textChannelId,
            updatedAt: new Date(),
          },
        })
        .returning();

      return c.json(result[0] as ChannelSetting);
    } catch (error) {
      console.error("[API] Error setting channels:", error);
      return c.json({ error: "Failed to set channels" }, 500);
    }
  },
);

// GET /api/channel-settings/:guildId
app.get("/:guildId", async (c) => {
  const guildId = c.req.param("guildId");
  
  try {
    const settings = await db.query.channelSettings.findFirst({
      where: eq(channelSettings.guildId, guildId),
    });

    if (!settings) {
      return c.json({ error: "Settings not found" }, 404);
    }

    return c.json(settings as ChannelSetting);
  } catch (error) {
    console.error("[API] Error getting channels:", error);
    return c.json({ error: "Failed to get channels" }, 500);
  }
});

export default app;