import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { SiweMessage } from "siwe";
import jwt from "jsonwebtoken";
import { db, users, userIdentities } from "../../client";
import { eq, and } from "drizzle-orm";

type Variables = {
  userId?: string;
  userAddress?: string;
};

const app = new Hono<{ Variables: Variables }>();

// JWT configuration
const JWT_SECRET = process.env.JWT_SECRET || Bun.env.JWT_SECRET || "development-secret-key-change-this-in-production-minimum-32-chars";
const JWT_EXPIRY = "7d";

// In-memory nonce storage (consider Redis for production)
const nonceStore = new Map<string, { nonce: string; expires: number }>();

// Clean expired nonces periodically
setInterval(() => {
  const now = Date.now();
  for (const [address, data] of nonceStore.entries()) {
    if (data.expires < now) {
      nonceStore.delete(address);
    }
  }
}, 60 * 1000); // Every minute

// Generate nonce for SIWE
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
    
    // Store nonce with 5 minute expiry
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
    
    try {
      const siweMessage = new SiweMessage(message);
      const domain = process.env.SIWE_DOMAIN || Bun.env.SIWE_DOMAIN || "localhost:3003";
      
      // Verify domain
      if (siweMessage.domain !== domain) {
        return c.json({ error: "Invalid domain" }, 400);
      }
      
      // Check nonce
      const storedNonce = nonceStore.get(siweMessage.address.toLowerCase());
      if (!storedNonce || storedNonce.nonce !== siweMessage.nonce) {
        return c.json({ error: "Invalid nonce" }, 400);
      }
      
      // Check nonce expiry
      if (storedNonce.expires < Date.now()) {
        nonceStore.delete(siweMessage.address.toLowerCase());
        return c.json({ error: "Nonce expired" }, 400);
      }
      
      // Verify signature
      const result = await siweMessage.verify({ signature });
      
      if (!result.success) {
        return c.json({ error: "Invalid signature" }, 401);
      }
      
      // Remove used nonce
      nonceStore.delete(siweMessage.address.toLowerCase());
      
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
          iat: Math.floor(Date.now() / 1000),
        },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRY }
      );
      
      return c.json({
        token,
        userId,
        address,
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