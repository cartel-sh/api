import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
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

const app = new OpenAPIHono<{ Variables: Variables }>();

const JWT_SECRET = process.env.JWT_SECRET || Bun.env.JWT_SECRET || "development-secret-key-change-this-in-production-minimum-32-chars";
const JWT_EXPIRY = "7d";

const verifyRoute = createRoute({
  method: "post",
  path: "/verify",
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            message: z.string().describe("SIWE message string"),
            signature: z.string().describe("Signature from wallet"),
          }),
        },
      },
    },
    headers: z.object({
      "X-API-Key": z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: "Successfully authenticated",
      content: {
        "application/json": {
          schema: z.object({
            userId: z.string(),
            address: z.string(),
            clientName: z.string().optional(),
            message: z.string(),
          }),
        },
      },
    },
    400: {
      description: "Bad request",
      content: {
        "application/json": {
          schema: z.object({
            error: z.string(),
            message: z.string().optional(),
          }),
        },
      },
    },
    401: {
      description: "Unauthorized",
      content: {
        "application/json": {
          schema: z.object({
            error: z.string(),
          }),
        },
      },
    },
    500: {
      description: "Internal server error",
      content: {
        "application/json": {
          schema: z.object({
            error: z.string(),
          }),
        },
      },
    },
  },
  tags: ["Authentication"],
});

app.openapi(verifyRoute, async (c) => {
    const { message, signature } = c.req.valid("json");
    const apiKey = c.req.header("X-API-Key");
    
    if (!apiKey) {
      return c.json({ error: "API key required" }, 401);
    }
    
    try {
      const siweMessage = new SiweMessage(message);
      
      if (!isValidApiKeyFormat(apiKey)) {
        return c.json({ error: "Invalid API key format" }, 401);
      }
      
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
      
      db.update(apiKeys)
        .set({ lastUsedAt: now })
        .where(eq(apiKeys.id, apiKeyData.id))
        .execute()
        .catch(console.error);
      
      if (allowedOrigins.length > 0) {
        const isValidOrigin = allowedOrigins.some(origin => {
          if (siweMessage.domain === origin) return true;
          if (siweMessage.uri && siweMessage.uri.startsWith(origin)) return true;
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
      
      const result = await siweMessage.verify({ signature });
      
      if (!result.success) {
        return c.json({ error: "Invalid signature" }, 401);
      }
      
      const address = siweMessage.address.toLowerCase();
      
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
      }, 200);
    } catch (error) {
      console.error("SIWE verification error:", error);
      return c.json({ error: "Authentication failed" }, 500);
    }
  }
);

const getMeRoute = createRoute({
  method: "get",
  path: "/me",
  security: [
    {
      bearerAuth: [],
    },
  ],
  responses: {
    200: {
      description: "Current user information",
      content: {
        "application/json": {
          schema: z.object({
            userId: z.string(),
            address: z.string(),
            user: z.any(),
          }),
        },
      },
    },
    401: {
      description: "Not authenticated or invalid token",
      content: {
        "application/json": {
          schema: z.object({
            error: z.string(),
          }),
        },
      },
    },
    404: {
      description: "User not found",
      content: {
        "application/json": {
          schema: z.object({
            error: z.string(),
          }),
        },
      },
    },
  },
  tags: ["Authentication"],
});

app.openapi(getMeRoute, async (c) => {
  const token = getCookie(c, "cartel-seal") || 
    (c.req.header("Authorization")?.startsWith("Bearer ") 
      ? c.req.header("Authorization")!.slice(7) 
      : null);
  
  if (!token) {
    return c.json({ error: "Not authenticated" }, 401);
  }
  
  try {
    const payload = jwt.verify(token, JWT_SECRET) as any;
    
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
    }, 200);
  } catch (error) {
    return c.json({ error: "Invalid or expired token" }, 401);
  }
});

const logoutRoute = createRoute({
  method: "post",
  path: "/logout",
  responses: {
    200: {
      description: "Successfully logged out",
      content: {
        "application/json": {
          schema: z.object({
            message: z.string(),
          }),
        },
      },
    },
  },
  tags: ["Authentication"],
});

app.openapi(logoutRoute, (c) => {
  deleteCookie(c, "cartel-seal", {
    path: "/",
  });
  
  return c.json({ message: "Logged out successfully" }, 200);
});

export default app;