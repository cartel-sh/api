import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { desc, eq, sql } from "drizzle-orm";
import { db, applications, applicationVotes } from "../../../client";
import { requireJwtAuth } from "../../middleware/auth";

const app = new Hono();

// POST /api/applications
app.post(
  "/",
  zValidator(
    "json",
    z.object({
      messageId: z.string(),
      walletAddress: z.string(),
      ensName: z.string().nullable().optional(),
      github: z.string().nullable().optional(),
      farcaster: z.string().nullable().optional(),
      lens: z.string().nullable().optional(),
      twitter: z.string().nullable().optional(),
      excitement: z.string(),
      motivation: z.string(),
      signature: z.string(),
    }),
  ),
  async (c) => {
    const data = c.req.valid("json");
    
    try {
      // Get next application number
      const result = await db
        .select({
          max: sql<number>`COALESCE(MAX(${applications.applicationNumber}), 0)`,
        })
        .from(applications);
      
      const nextNumber = (result[0]?.max || 0) + 1;

      // Create application
      const [application] = await db
        .insert(applications)
        .values({
          ...data,
          applicationNumber: nextNumber,
        })
        .returning();
      
      return c.json({ 
        id: application!.id, 
        applicationNumber: nextNumber 
      });
    } catch (error) {
      console.error("[API] Error creating application:", error);
      return c.json({ error: "Failed to create application" }, 500);
    }
  },
);

// GET /api/applications/pending
app.get("/pending", async (c) => {
  try {
    const result = await db
      .select()
      .from(applications)
      .where(eq(applications.status, "pending"))
      .orderBy(desc(applications.submittedAt));
    
    return c.json(result);
  } catch (error) {
    console.error("[API] Error getting pending applications:", error);
    return c.json({ error: "Failed to get pending applications" }, 500);
  }
});

// GET /api/applications/by-message/:messageId
app.get("/by-message/:messageId", async (c) => {
  const messageId = c.req.param("messageId");
  
  try {
    const result = await db
      .select()
      .from(applications)
      .where(eq(applications.messageId, messageId));
    
    if (!result[0]) {
      return c.json({ error: "Application not found" }, 404);
    }
    
    return c.json(result[0]);
  } catch (error) {
    console.error("[API] Error getting application by message ID:", error);
    return c.json({ error: "Failed to get application" }, 500);
  }
});

// GET /api/applications/by-number/:number
app.get("/by-number/:number", async (c) => {
  const number = parseInt(c.req.param("number"));
  
  if (isNaN(number)) {
    return c.json({ error: "Invalid application number" }, 400);
  }
  
  try {
    const result = await db
      .select()
      .from(applications)
      .where(eq(applications.applicationNumber, number));
    
    if (!result[0]) {
      return c.json({ error: "Application not found" }, 404);
    }
    
    return c.json(result[0]);
  } catch (error) {
    console.error("[API] Error getting application by number:", error);
    return c.json({ error: "Failed to get application" }, 500);
  }
});

// PATCH /api/applications/:id/status
app.patch(
  "/:id/status",
  requireJwtAuth, // Require authentication to change status
  zValidator(
    "json",
    z.object({
      status: z.enum(["approved", "rejected"]),
    }),
  ),
  async (c) => {
    const id = c.req.param("id");
    const { status } = c.req.valid("json");
    
    try {
      await db
        .update(applications)
        .set({
          status,
          decidedAt: new Date(),
        })
        .where(eq(applications.id, id));
      
      return c.json({ success: true });
    } catch (error) {
      console.error("[API] Error updating application status:", error);
      return c.json({ error: "Failed to update application status" }, 500);
    }
  },
);

// DELETE /api/applications/:id
app.delete("/:id", requireJwtAuth, async (c) => {
  const id = c.req.param("id");
  
  try {
    await db
      .delete(applications)
      .where(eq(applications.id, id));
    
    return c.json({ success: true });
  } catch (error) {
    console.error("[API] Error deleting application:", error);
    return c.json({ error: "Failed to delete application" }, 500);
  }
});

// POST /api/applications/:id/votes
app.post(
  "/:id/votes",
  zValidator(
    "json",
    z.object({
      userId: z.string(),
      userName: z.string(),
      voteType: z.enum(["approve", "reject"]),
    }),
  ),
  async (c) => {
    const applicationId = c.req.param("id");
    const { userId, userName, voteType } = c.req.valid("json");
    
    try {
      await db
        .insert(applicationVotes)
        .values({
          applicationId,
          userId,
          userName,
          voteType,
        })
        .onConflictDoUpdate({
          target: [applicationVotes.applicationId, applicationVotes.userId],
          set: {
            voteType,
            userName,
          },
        });
      
      return c.json({ success: true });
    } catch (error) {
      console.error("[API] Error adding vote:", error);
      return c.json({ error: "Failed to add vote" }, 500);
    }
  },
);

// GET /api/applications/:id/votes
app.get("/:id/votes", async (c) => {
  const applicationId = c.req.param("id");
  
  try {
    const votes = await db
      .select()
      .from(applicationVotes)
      .where(eq(applicationVotes.applicationId, applicationId));

    const approvals = votes.filter((v) => v.voteType === "approve");
    const rejections = votes.filter((v) => v.voteType === "reject");

    return c.json({
      approvals,
      rejections,
      approvalCount: approvals.length,
      rejectionCount: rejections.length,
    });
  } catch (error) {
    console.error("[API] Error getting votes:", error);
    return c.json({ error: "Failed to get votes" }, 500);
  }
});

export default app;