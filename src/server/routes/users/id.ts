import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { and, eq } from "drizzle-orm";
import { db, userIdentities, users } from "../../../client";

const app = new Hono();

// Platform enum for validation
const PlatformEnum = z.enum(["discord", "evm", "lens", "farcaster", "telegram"]);

// GET /api/users/id/by-evm/:address - Get user by EVM address
app.get("/by-evm/:address", async (c) => {
  const address = c.req.param("address").toLowerCase();
  
  try {
    const identity = await db.query.userIdentities.findFirst({
      where: and(
        eq(userIdentities.platform, "evm"),
        eq(userIdentities.identity, address)
      ),
      with: {
        user: true
      }
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
        isPrimary: identity.isPrimary
      }
    });
  } catch (error) {
    console.error("[API] Error getting user by EVM address:", error);
    return c.json({ error: "Failed to get user" }, 500);
  }
});

// GET /api/users/id/by-lens/:address - Get user by Lens handle/address
app.get("/by-lens/:address", async (c) => {
  const address = c.req.param("address").toLowerCase();
  
  try {
    const identity = await db.query.userIdentities.findFirst({
      where: and(
        eq(userIdentities.platform, "lens"),
        eq(userIdentities.identity, address)
      ),
      with: {
        user: true
      }
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
        isPrimary: identity.isPrimary
      }
    });
  } catch (error) {
    console.error("[API] Error getting user by Lens:", error);
    return c.json({ error: "Failed to get user" }, 500);
  }
});

// GET /api/users/id/by-farcaster/:fid - Get user by Farcaster FID
app.get("/by-farcaster/:fid", async (c) => {
  const fid = c.req.param("fid");
  
  try {
    const identity = await db.query.userIdentities.findFirst({
      where: and(
        eq(userIdentities.platform, "farcaster"),
        eq(userIdentities.identity, fid)
      ),
      with: {
        user: true
      }
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
        isPrimary: identity.isPrimary
      }
    });
  } catch (error) {
    console.error("[API] Error getting user by Farcaster FID:", error);
    return c.json({ error: "Failed to get user" }, 500);
  }
});

// GET /api/users/id/by-discord/:discordId - Get user by Discord ID
app.get("/by-discord/:discordId", async (c) => {
  const discordId = c.req.param("discordId");
  
  try {
    const identity = await db.query.userIdentities.findFirst({
      where: and(
        eq(userIdentities.platform, "discord"),
        eq(userIdentities.identity, discordId)
      ),
      with: {
        user: true
      }
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
        isPrimary: identity.isPrimary
      }
    });
  } catch (error) {
    console.error("[API] Error getting user by Discord ID:", error);
    return c.json({ error: "Failed to get user" }, 500);
  }
});

// GET /api/users/id/by-telegram/:telegramId - Get user by Telegram ID
app.get("/by-telegram/:telegramId", async (c) => {
  const telegramId = c.req.param("telegramId");
  
  try {
    const identity = await db.query.userIdentities.findFirst({
      where: and(
        eq(userIdentities.platform, "telegram"),
        eq(userIdentities.identity, telegramId)
      ),
      with: {
        user: true
      }
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
        isPrimary: identity.isPrimary
      }
    });
  } catch (error) {
    console.error("[API] Error getting user by Telegram ID:", error);
    return c.json({ error: "Failed to get user" }, 500);
  }
});


// POST /api/users/id - Create or get user with identity (auto-creates user if needed)
const createIdentitySchema = z.object({
  platform: PlatformEnum,
  identity: z.string().min(1),
  isPrimary: z.boolean().optional().default(false)
});

app.post("/", zValidator("json", createIdentitySchema), async (c) => {
  const { platform, identity, isPrimary } = c.req.valid("json");
  
  try {
    // Normalize identity based on platform
    const normalizedIdentity = platform === "evm" || platform === "lens" 
      ? identity.toLowerCase() 
      : identity;
    
    // Check if identity already exists
    const existingIdentity = await db.query.userIdentities.findFirst({
      where: and(
        eq(userIdentities.platform, platform),
        eq(userIdentities.identity, normalizedIdentity)
      ),
      with: {
        user: true
      }
    });
    
    if (existingIdentity) {
      return c.json({ 
        userId: existingIdentity.userId,
        user: existingIdentity.user,
        identity: existingIdentity,
        created: false
      });
    }
    
    // Create new user and identity
    const [newUser] = await db.insert(users).values({}).returning();
    
    if (!newUser) {
      return c.json({ error: "Failed to create user" }, 500);
    }
    
    const [newIdentity] = await db.insert(userIdentities).values({
      userId: newUser.id,
      platform,
      identity: normalizedIdentity,
      isPrimary: isPrimary || true // First identity is primary by default
    }).returning();
    
    return c.json({ 
      userId: newUser.id,
      user: newUser,
      identity: newIdentity,
      created: true
    }, 201);
  } catch (error) {
    console.error("[API] Error creating identity:", error);
    return c.json({ error: "Failed to create identity" }, 500);
  }
});

export default app;