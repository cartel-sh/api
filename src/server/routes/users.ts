import { Hono } from "hono";
import { getUserByDiscordId } from "../utils";

const app = new Hono();

// GET /api/users/by-discord/:discordId
app.get("/by-discord/:discordId", async (c) => {
  const discordId = c.req.param("discordId");
  
  try {
    const userId = await getUserByDiscordId(discordId);
    return c.json({ userId });
  } catch (error) {
    console.error("[API] Error getting user by Discord ID:", error);
    return c.json({ error: "Failed to get or create user" }, 500);
  }
});

export default app;