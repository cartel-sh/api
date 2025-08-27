import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db, userIdentities } from "../../../client";

const app = new Hono();

// GET /api/users/identities/:userId - Get all identities for a user
app.get("/:userId", async (c) => {
  const userId = c.req.param("userId");
  
  try {
    const identities = await db.query.userIdentities.findMany({
      where: eq(userIdentities.userId, userId),
      orderBy: (userIdentities, { desc }) => [desc(userIdentities.isPrimary)]
    });
    
    if (!identities.length) {
      return c.json({ error: "No identities found for user" }, 404);
    }
    
    return c.json({ identities });
  } catch (error) {
    console.error("[API] Error getting user identities:", error);
    return c.json({ error: "Failed to get user identities" }, 500);
  }
});

export default app;