import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { and, eq, sql } from "drizzle-orm";
import { db, userIdentities, users } from "../../../client";

const app = new Hono();

// Platform enum for validation
const PlatformEnum = z.enum(["discord", "evm", "lens", "farcaster", "telegram"]);

// POST /api/admin/identities/connect - Connect a new identity to an existing user
const connectIdentitySchema = z.object({
  userId: z.string().uuid(),
  platform: PlatformEnum,
  identity: z.string().min(1),
  isPrimary: z.boolean().optional().default(false)
});

app.post("/connect", zValidator("json", connectIdentitySchema), async (c) => {
  const { userId, platform, identity, isPrimary } = c.req.valid("json");
  
  try {
    // Normalize identity based on platform
    const normalizedIdentity = platform === "evm" || platform === "lens" 
      ? identity.toLowerCase() 
      : identity;
    
    // Check if user exists
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId)
    });
    
    if (!user) {
      return c.json({ error: "User not found" }, 404);
    }
    
    // Check if identity already exists (for any user)
    const existingIdentity = await db.query.userIdentities.findFirst({
      where: and(
        eq(userIdentities.platform, platform),
        eq(userIdentities.identity, normalizedIdentity)
      )
    });
    
    if (existingIdentity) {
      if (existingIdentity.userId === userId) {
        return c.json({ error: "Identity already connected to this user" }, 400);
      }
      return c.json({ error: "Identity already connected to another user" }, 400);
    }
    
    // If setting as primary, unset other primary identities for this user
    if (isPrimary) {
      await db.update(userIdentities)
        .set({ isPrimary: false, updatedAt: new Date() })
        .where(and(
          eq(userIdentities.userId, userId),
          eq(userIdentities.isPrimary, true)
        ));
    }
    
    // Connect the identity
    const [newIdentity] = await db.insert(userIdentities).values({
      userId,
      platform,
      identity: normalizedIdentity,
      isPrimary
    }).returning();
    
    return c.json({ 
      message: "Identity connected successfully",
      identity: newIdentity
    }, 201);
  } catch (error) {
    console.error("[API] Error connecting identity:", error);
    return c.json({ error: "Failed to connect identity" }, 500);
  }
});

// DELETE /api/admin/identities/disconnect - Disconnect an identity from a user
const disconnectIdentitySchema = z.object({
  platform: PlatformEnum,
  identity: z.string().min(1)
});

app.delete("/disconnect", zValidator("json", disconnectIdentitySchema), async (c) => {
  const { platform, identity } = c.req.valid("json");
  
  try {
    // Normalize identity based on platform
    const normalizedIdentity = platform === "evm" || platform === "lens" 
      ? identity.toLowerCase() 
      : identity;
    
    // Find the identity
    const existingIdentity = await db.query.userIdentities.findFirst({
      where: and(
        eq(userIdentities.platform, platform),
        eq(userIdentities.identity, normalizedIdentity)
      )
    });
    
    if (!existingIdentity) {
      return c.json({ error: "Identity not found" }, 404);
    }
    
    // Check if this is the user's only identity
    const identityCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(userIdentities)
      .where(eq(userIdentities.userId, existingIdentity.userId));
    
    if (identityCount[0]?.count === 1) {
      return c.json({ error: "Cannot disconnect user's only identity" }, 400);
    }
    
    // Delete the identity
    await db.delete(userIdentities)
      .where(and(
        eq(userIdentities.platform, platform),
        eq(userIdentities.identity, normalizedIdentity)
      ));
    
    // If this was primary, set another identity as primary
    if (existingIdentity.isPrimary) {
      const remainingIdentity = await db.query.userIdentities.findFirst({
        where: eq(userIdentities.userId, existingIdentity.userId)
      });
      
      if (remainingIdentity) {
        await db.update(userIdentities)
          .set({ isPrimary: true, updatedAt: new Date() })
          .where(and(
            eq(userIdentities.platform, remainingIdentity.platform),
            eq(userIdentities.identity, remainingIdentity.identity)
          ));
      }
    }
    
    return c.json({ 
      message: "Identity disconnected successfully",
      userId: existingIdentity.userId
    });
  } catch (error) {
    console.error("[API] Error disconnecting identity:", error);
    return c.json({ error: "Failed to disconnect identity" }, 500);
  }
});

// PUT /api/admin/identities/set-primary - Set an identity as primary for a user
const setPrimarySchema = z.object({
  platform: PlatformEnum,
  identity: z.string().min(1)
});

app.put("/set-primary", zValidator("json", setPrimarySchema), async (c) => {
  const { platform, identity } = c.req.valid("json");
  
  try {
    // Normalize identity based on platform
    const normalizedIdentity = platform === "evm" || platform === "lens" 
      ? identity.toLowerCase() 
      : identity;
    
    // Find the identity
    const existingIdentity = await db.query.userIdentities.findFirst({
      where: and(
        eq(userIdentities.platform, platform),
        eq(userIdentities.identity, normalizedIdentity)
      )
    });
    
    if (!existingIdentity) {
      return c.json({ error: "Identity not found" }, 404);
    }
    
    if (existingIdentity.isPrimary) {
      return c.json({ message: "Identity is already primary" });
    }
    
    // Unset other primary identities for this user
    await db.update(userIdentities)
      .set({ isPrimary: false, updatedAt: new Date() })
      .where(and(
        eq(userIdentities.userId, existingIdentity.userId),
        eq(userIdentities.isPrimary, true)
      ));
    
    // Set this identity as primary
    await db.update(userIdentities)
      .set({ isPrimary: true, updatedAt: new Date() })
      .where(and(
        eq(userIdentities.platform, platform),
        eq(userIdentities.identity, normalizedIdentity)
      ));
    
    return c.json({ 
      message: "Identity set as primary successfully",
      userId: existingIdentity.userId
    });
  } catch (error) {
    console.error("[API] Error setting primary identity:", error);
    return c.json({ error: "Failed to set primary identity" }, 500);
  }
});

// POST /api/admin/identities/merge-users - Merge two users by moving all identities to one user
const mergeUsersSchema = z.object({
  sourceUserId: z.string().uuid(),
  targetUserId: z.string().uuid()
});

app.post("/merge-users", zValidator("json", mergeUsersSchema), async (c) => {
  const { sourceUserId, targetUserId } = c.req.valid("json");
  
  if (sourceUserId === targetUserId) {
    return c.json({ error: "Cannot merge user with itself" }, 400);
  }
  
  try {
    // Check if both users exist
    const [sourceUser, targetUser] = await Promise.all([
      db.query.users.findFirst({ where: eq(users.id, sourceUserId) }),
      db.query.users.findFirst({ where: eq(users.id, targetUserId) })
    ]);
    
    if (!sourceUser || !targetUser) {
      return c.json({ error: "One or both users not found" }, 404);
    }
    
    // Get all identities from source user
    const sourceIdentities = await db.query.userIdentities.findMany({
      where: eq(userIdentities.userId, sourceUserId)
    });
    
    if (sourceIdentities.length === 0) {
      return c.json({ error: "Source user has no identities" }, 400);
    }
    
    // Move all identities to target user
    await db.update(userIdentities)
      .set({ 
        userId: targetUserId, 
        isPrimary: false, // Reset primary status when merging
        updatedAt: new Date() 
      })
      .where(eq(userIdentities.userId, sourceUserId));
    
    // Delete the source user (cascades to other related data)
    await db.delete(users).where(eq(users.id, sourceUserId));
    
    return c.json({ 
      message: "Users merged successfully",
      targetUserId,
      mergedIdentities: sourceIdentities.length
    });
  } catch (error) {
    console.error("[API] Error merging users:", error);
    return c.json({ error: "Failed to merge users" }, 500);
  }
});

export default app;