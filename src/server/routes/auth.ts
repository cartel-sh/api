import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
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

// In-memory nonce storage per client (consider Redis for production)
// Key format: `${clientId}:${address}` or just `${address}` for legacy
const nonceStore = new Map<string, { nonce: string; expires: number; clientId?: string }>();

// Clean expired nonces periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, data] of nonceStore.entries()) {
    if (data.expires < now) {
      nonceStore.delete(key);
    }
  }
}, 60 * 1000); // Every minute

// Generate nonce for SIWE (legacy endpoint - kept for backwards compatibility)
app.post(
  "/nonce",
  zValidator(
    "json",
    z.object({
      address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    })
  ),
  async (c) => {
    const { address } = c.req.valid("json");
    const nonce = generateNonce();
    
    // Store nonce with 5 minute expiry (legacy format)
    nonceStore.set(address.toLowerCase(), {
      nonce,
      expires: Date.now() + 5 * 60 * 1000,
    });
    
    return c.json({ nonce });
  }
);

// Verify SIWE signature and create session
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
    
    try {
      const siweMessage = new SiweMessage(message);
      let allowedOrigins: string[] = [];
      let clientId: string | undefined;
      let clientName: string | undefined;
      
      // If API key provided, validate and get client configuration
      if (apiKey) {
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
        
        clientId = apiKeyData.id;
        clientName = apiKeyData.clientName || undefined;
        allowedOrigins = apiKeyData.allowedOrigins || [];
        
        // Update last used timestamp
        db.update(apiKeys)
          .set({ lastUsedAt: now })
          .where(eq(apiKeys.id, apiKeyData.id))
          .execute()
          .catch(console.error);
      } else {
        // Legacy flow - use environment domain
        const domain = process.env.SIWE_DOMAIN || Bun.env.SIWE_DOMAIN || "localhost:3003";
        allowedOrigins = [domain];
      }
      
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
      const now = new Date();
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
      
      // For client-generated nonces, we just verify freshness
      // Clients should generate unique nonces (e.g., UUID or timestamp-based)
      // We can optionally store and check for replay attacks
      const nonceKey = clientId ? `${clientId}:${siweMessage.address.toLowerCase()}` : siweMessage.address.toLowerCase();
      const storedNonce = nonceStore.get(nonceKey);
      
      // If we have a stored nonce (legacy flow), verify it
      if (storedNonce) {
        if (storedNonce.nonce !== siweMessage.nonce) {
          return c.json({ error: "Invalid nonce" }, 400);
        }
        if (storedNonce.expires < Date.now()) {
          nonceStore.delete(nonceKey);
          return c.json({ error: "Nonce expired" }, 400);
        }
      } else if (!clientId) {
        // Legacy flow requires stored nonce
        return c.json({ error: "Invalid or missing nonce" }, 400);
      }
      // For client-generated nonces, we trust the client to generate unique values
      
      // Verify signature
      const result = await siweMessage.verify({ signature });
      
      if (!result.success) {
        return c.json({ error: "Invalid signature" }, 401);
      }
      
      // Remove used nonce if stored
      if (storedNonce) {
        nonceStore.delete(nonceKey);
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
          clientId: clientId || undefined,
          clientName: clientName || undefined,
          iat: Math.floor(Date.now() / 1000),
        },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRY }
      );
      
      return c.json({
        token,
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

// Get current user from JWT
app.get("/me", async (c) => {
  const authorization = c.req.header("Authorization");
  
  if (!authorization?.startsWith("Bearer ")) {
    return c.json({ error: "Not authenticated" }, 401);
  }
  
  const token = authorization.slice(7);
  
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

// Helper function to generate nonce
function generateNonce(length = 16): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";
  for (let i = 0; i < length; i++) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}

export default app;