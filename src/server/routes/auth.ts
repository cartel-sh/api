import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { SiweMessage } from "siwe";
import jwt from "jsonwebtoken";
import { db, users, userIdentities, apiKeys } from "../../client";
import { eq, and, or, isNull, gte } from "drizzle-orm";
import { hashApiKey, getApiKeyPrefix, isValidApiKeyFormat } from "../utils/crypto";

type Variables = {
  userId?: string;
  userAddress?: string;
  apiKeyId?: string;
  clientName?: string;
  allowedOrigins?: string[];
};

const app = new Hono<{ Variables: Variables }>();

// JWT configuration
const JWT_SECRET = process.env.JWT_SECRET || Bun.env.JWT_SECRET || "development-secret-key-change-this-in-production-minimum-32-chars";
const JWT_EXPIRY = "7d";

// Verify SIWE signature and create session (requires API key)
app.post(
  "/verify",
  zValidator(
    "json",
    z.object({
      message: z.string(),
      signature: z.string(),
    })
  ),
  async (c) => {
    const { message, signature } = c.req.valid("json");
    const apiKey = c.req.header("X-API-Key");
    
    // API key is required
    if (!apiKey) {
      return c.json({ error: "API key required" }, 401);
    }
    
    try {
      const siweMessage = new SiweMessage(message);
      
      // Validate API key format
      if (!isValidApiKeyFormat(apiKey)) {
        return c.json({ error: "Invalid API key format" }, 401);
      }
      
      // Get API key from database
      const keyPrefix = getApiKeyPrefix(apiKey);
      const keyHash = hashApiKey(apiKey);
      const now = new Date();
      
      const apiKeyData = await db.query.apiKeys.findFirst({
        where: and(
          eq(apiKeys.keyPrefix, keyPrefix),
          eq(apiKeys.keyHash, keyHash),
          eq(apiKeys.isActive, true),
          or(
            isNull(apiKeys.expiresAt),
            gte(apiKeys.expiresAt, now)
          )
        ),
      });
      
      if (!apiKeyData) {
        return c.json({ error: "Invalid API key" }, 401);
      }
      
      const clientId = apiKeyData.id;
      const clientName = apiKeyData.clientName || undefined;
      const allowedOrigins = apiKeyData.allowedOrigins || [];
      
      // Update last used timestamp
      db.update(apiKeys)
        .set({ lastUsedAt: now })
        .where(eq(apiKeys.id, apiKeyData.id))
        .execute()
        .catch(console.error);
      
      // Verify domain/URI against allowed origins
      if (allowedOrigins.length > 0) {
        const isValidOrigin = allowedOrigins.some(origin => {
          // Check if domain matches
          if (siweMessage.domain === origin) return true;
          // Check if URI starts with the origin
          if (siweMessage.uri && siweMessage.uri.startsWith(origin)) return true;
          // Handle wildcard subdomains (*.example.com)
          if (origin.startsWith("*.")) {
            const baseDomain = origin.slice(2);
            return siweMessage.domain.endsWith(baseDomain);
          }
          return false;
        });
        
        if (!isValidOrigin) {
          return c.json({ 
            error: "Invalid domain/URI", 
            message: `Domain ${siweMessage.domain} not in allowed origins`
          }, 400);
        }
      }
      
      // Verify timestamp (not expired, not too far in future)
      if (siweMessage.expirationTime) {
        const expiry = new Date(siweMessage.expirationTime);
        if (expiry < now) {
          return c.json({ error: "Message expired" }, 400);
        }
      }
      if (siweMessage.notBefore) {
        const notBefore = new Date(siweMessage.notBefore);
        if (notBefore > now) {
          return c.json({ error: "Message not yet valid" }, 400);
        }
      }
      
      // Verify signature
      const result = await siweMessage.verify({ signature });
      
      if (!result.success) {
        return c.json({ error: "Invalid signature" }, 401);
      }
      
      // Find or create user
      const address = siweMessage.address.toLowerCase();
      
      // Check if identity exists
      let identity = await db.query.userIdentities.findFirst({
        where: and(
          eq(userIdentities.platform, "evm"),
          eq(userIdentities.identity, address)
        ),
        with: {
          user: true,
        },
      });
      
      let userId: string;
      
      if (!identity) {
        // Create new user and identity
        const [newUser] = await db.insert(users).values({}).returning();
        if (!newUser) {
          throw new Error("Failed to create user");
        }
        userId = newUser.id;
        
        await db.insert(userIdentities).values({
          userId,
          platform: "evm",
          identity: address,
          isPrimary: true,
        });
      } else {
        userId = identity.userId;
      }
      
      // Generate JWT
      const token = jwt.sign(
        { 
          userId,
          address,
          clientId,
          clientName,
          iat: Math.floor(Date.now() / 1000),
        },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRY }
      );
      
      // Set JWT as httpOnly cookie
      setCookie(c, "cartel-seal", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "Lax",
        maxAge: 7 * 24 * 60 * 60, // 7 days in seconds
        path: "/",
      });
      
      return c.json({
        userId,
        address,
        clientName,
        message: "Successfully authenticated",
      });
    } catch (error) {
      console.error("SIWE verification error:", error);
      return c.json({ error: "Authentication failed" }, 500);
    }
  }
);

// Get current user from JWT (cookie or header)
app.get("/me", async (c) => {
  // Try cookie first, then Authorization header
  const token = getCookie(c, "cartel-seal") || 
    (c.req.header("Authorization")?.startsWith("Bearer ") 
      ? c.req.header("Authorization")!.slice(7) 
      : null);
  
  if (!token) {
    return c.json({ error: "Not authenticated" }, 401);
  }
  
  try {
    const payload = jwt.verify(token, JWT_SECRET) as any;
    
    // Get user details
    const user = await db.query.users.findFirst({
      where: eq(users.id, payload.userId),
      with: {
        identities: {
          where: eq(userIdentities.platform, "evm"),
        },
      },
    });
    
    if (!user) {
      return c.json({ error: "User not found" }, 404);
    }
    
    return c.json({
      userId: payload.userId,
      address: payload.address,
      user,
    });
  } catch (error) {
    return c.json({ error: "Invalid or expired token" }, 401);
  }
});

// Logout endpoint - clear cookie
app.post("/logout", (c) => {
  deleteCookie(c, "cartel-seal", {
    path: "/",
  });
  
  return c.json({ message: "Logged out successfully" });
});

export default app;