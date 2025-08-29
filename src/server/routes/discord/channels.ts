import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { and, eq } from "drizzle-orm";
import { db, channelSettings } from "../../../client";
import type { ChannelSetting } from "../../../schema";

const app = new OpenAPIHono();
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

const updateChannelSettingRoute = createRoute({
  method: "put",
  path: "/{guildId}/{key}",
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
          eq(channelSettings.key, key)
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
          .where(and(
            eq(channelSettings.guildId, guildId),
            eq(channelSettings.key, key)
          ))
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

      return c.json(result as ChannelSetting);
    } catch (error) {
      console.error("[API] Error updating channel setting:", error);
      return c.json({ error: "Failed to update channel setting" }, 500);
    }
  },
);

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