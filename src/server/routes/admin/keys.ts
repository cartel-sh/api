import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { db, apiKeys, users } from "../../../client";
import { generateApiKey, hashApiKey, getApiKeyPrefix } from "../../utils/crypto";
import { requireJwtAuth } from "../../middleware/auth";

const app = new Hono();

// All admin routes require JWT authentication
// TODO: Add admin role check once roles are implemented
app.use("*", requireJwtAuth);

// POST /api/admin/keys - Generate new API key
app.post(
  "/",
  zValidator(
    "json",
    z.object({
      userId: z.string().uuid(),
      name: z.string().min(1).max(100),
      description: z.string().optional(),
      scopes: z.array(z.string()).default(["read", "write"]),
      expiresIn: z.number().optional(), // seconds until expiration
    }),
  ),
  async (c) => {
    const { userId, name, description, scopes, expiresIn } = c.req.valid("json");
    
    try {
      // Check if user exists
      const user = await db.query.users.findFirst({
        where: eq(users.id, userId),
      });
      
      if (!user) {
        return c.json({ error: "User not found" }, 404);
      }
      
      // Generate new API key
      const apiKey = generateApiKey();
      const keyPrefix = getApiKeyPrefix(apiKey);
      const keyHash = hashApiKey(apiKey);
      
      // Calculate expiration
      const expiresAt = expiresIn 
        ? new Date(Date.now() + expiresIn * 1000)
        : null;
      
      // Insert into database
      const result = await db
        .insert(apiKeys)
        .values({
          userId,
          name,
          description,
          keyPrefix,
          keyHash,
          scopes,
          expiresAt,
        })
        .returning();
      
      const newKey = result[0];
      if (!newKey) {
        return c.json({ error: "Failed to create API key" }, 500);
      }
      
      // Return the key only once
      return c.json({
        id: newKey.id,
        userId: newKey.userId,
        name: newKey.name,
        description: newKey.description,
        scopes: newKey.scopes,
        expiresAt: newKey.expiresAt,
        apiKey, // This is the only time the full key is shown
        message: "Save this API key securely. It will not be shown again.",
      });
    } catch (error) {
      console.error("[API] Error creating API key:", error);
      return c.json({ error: "Failed to create API key" }, 500);
    }
  },
);

// GET /api/admin/keys - List all keys (without showing actual keys)
app.get("/", async (c) => {
  const userId = c.req.query("userId");
  
  try {
    let keys: any[];
    
    if (userId) {
      keys = await db.query.apiKeys.findMany({
        where: eq(apiKeys.userId, userId),
        orderBy: [desc(apiKeys.createdAt)],
        with: {
          user: {
            with: {
              identities: true,
            },
          },
        },
      });
    } else {
      keys = await db.query.apiKeys.findMany({
        orderBy: [desc(apiKeys.createdAt)],
        with: {
          user: {
            with: {
              identities: true,
            },
          },
        },
      });
    }
    
    // Don't return the hash, only the prefix for identification
    const sanitizedKeys = keys.map((key) => ({
      id: key.id,
      userId: key.userId,
      name: key.name,
      description: key.description,
      keyPrefix: `cartel_${key.keyPrefix}...`,
      scopes: key.scopes,
      lastUsedAt: key.lastUsedAt,
      expiresAt: key.expiresAt,
      isActive: key.isActive,
      createdAt: key.createdAt,
      user: key.user ? {
        id: key.user.id,
        identities: key.user.identities,
      } : undefined,
    }));
    
    return c.json(sanitizedKeys);
  } catch (error) {
    console.error("[API] Error listing API keys:", error);
    return c.json({ error: "Failed to list API keys" }, 500);
  }
});

// GET /api/admin/keys/:id - Get specific key details
app.get("/:id", async (c) => {
  const keyId = c.req.param("id");
  
  try {
    const key = await db.query.apiKeys.findFirst({
      where: eq(apiKeys.id, keyId),
      with: {
        user: {
          with: {
            identities: true,
          },
        },
      },
    });
    
    if (!key) {
      return c.json({ error: "API key not found" }, 404);
    }
    
    // Don't return the hash
    return c.json({
      id: key.id,
      userId: key.userId,
      name: key.name,
      description: key.description,
      keyPrefix: `cartel_${key.keyPrefix}...`,
      scopes: key.scopes,
      lastUsedAt: key.lastUsedAt,
      expiresAt: key.expiresAt,
      isActive: key.isActive,
      createdAt: key.createdAt,
      updatedAt: key.updatedAt,
      user: {
        id: key.user.id,
        identities: key.user.identities,
      },
    });
  } catch (error) {
    console.error("[API] Error getting API key:", error);
    return c.json({ error: "Failed to get API key" }, 500);
  }
});

// PATCH /api/admin/keys/:id - Update key details
app.patch(
  "/:id",
  zValidator(
    "json",
    z.object({
      name: z.string().min(1).max(100).optional(),
      description: z.string().optional(),
      scopes: z.array(z.string()).optional(),
      isActive: z.boolean().optional(),
      expiresAt: z.string().datetime().nullable().optional(),
    }),
  ),
  async (c) => {
    const keyId = c.req.param("id");
    const updates = c.req.valid("json");
    
    try {
      const [updated] = await db
        .update(apiKeys)
        .set({
          ...updates,
          expiresAt: updates.expiresAt ? new Date(updates.expiresAt) : undefined,
          updatedAt: new Date(),
        })
        .where(eq(apiKeys.id, keyId))
        .returning();
      
      if (!updated) {
        return c.json({ error: "API key not found" }, 404);
      }
      
      return c.json({
        id: updated.id,
        name: updated.name,
        description: updated.description,
        scopes: updated.scopes,
        isActive: updated.isActive,
        expiresAt: updated.expiresAt,
      });
    } catch (error) {
      console.error("[API] Error updating API key:", error);
      return c.json({ error: "Failed to update API key" }, 500);
    }
  },
);

// DELETE /api/admin/keys/:id - Soft delete (deactivate) key
app.delete("/:id", async (c) => {
  const keyId = c.req.param("id");
  
  try {
    const [deactivated] = await db
      .update(apiKeys)
      .set({
        isActive: false,
        updatedAt: new Date(),
      })
      .where(eq(apiKeys.id, keyId))
      .returning();
    
    if (!deactivated) {
      return c.json({ error: "API key not found" }, 404);
    }
    
    return c.json({ 
      success: true,
      message: "API key deactivated successfully"
    });
  } catch (error) {
    console.error("[API] Error deactivating API key:", error);
    return c.json({ error: "Failed to deactivate API key" }, 500);
  }
});

// POST /api/admin/keys/:id/rotate - Rotate a key
app.post("/:id/rotate", async (c) => {
  const keyId = c.req.param("id");
  const gracePeriod = parseInt(c.req.query("gracePeriod") || "300"); // 5 minutes default
  
  try {
    // Get existing key
    const existingKey = await db.query.apiKeys.findFirst({
      where: eq(apiKeys.id, keyId),
    });
    
    if (!existingKey) {
      return c.json({ error: "API key not found" }, 404);
    }
    
    // Generate new key
    const newApiKey = generateApiKey();
    const newKeyPrefix = getApiKeyPrefix(newApiKey);
    const newKeyHash = hashApiKey(newApiKey);
    
    // Start transaction
    await db.transaction(async (tx) => {
      // Set expiration on old key
      await tx
        .update(apiKeys)
        .set({
          expiresAt: new Date(Date.now() + gracePeriod * 1000),
          updatedAt: new Date(),
        })
        .where(eq(apiKeys.id, keyId));
      
      // Create new key
      await tx.insert(apiKeys).values({
        userId: existingKey.userId,
        name: `${existingKey.name} (rotated)`,
        description: `Rotated from ${existingKey.keyPrefix}`,
        keyPrefix: newKeyPrefix,
        keyHash: newKeyHash,
        scopes: existingKey.scopes,
        expiresAt: existingKey.expiresAt,
      });
    });
    
    return c.json({
      newApiKey,
      message: `New API key generated. Old key will expire in ${gracePeriod} seconds.`,
      expiresAt: new Date(Date.now() + gracePeriod * 1000),
    });
  } catch (error) {
    console.error("[API] Error rotating API key:", error);
    return c.json({ error: "Failed to rotate API key" }, 500);
  }
});

export default app;