import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { db, projects, withUser } from "../../client";
import type { NewProject } from "../../schema";
import { eq, and, or, desc, ilike, arrayContains, sql } from "drizzle-orm";
import { requireScopes, withJwtAuth, requireJwtAuth } from "../middleware/auth";

type Variables = {
  apiKeyUserId?: string; // From API key (for rate limiting)
  apiKeyScopes?: string[];
  apiKeyId?: string;
  apiKeyType?: string;
  sessionUserId?: string; // From JWT (for authentication)
  userAddress?: string;
};

const app = new Hono<{ Variables: Variables }>();

// Apply optional JWT auth to all routes (API key is already extracted globally)
app.use("*", withJwtAuth);

const createProjectSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().min(1),
  githubUrl: z.string().url().optional().nullable(),
  deploymentUrl: z.string().url().optional().nullable(),
  tags: z.array(z.string()).default([]),
  isPublic: z.boolean().default(true),
});

const updateProjectSchema = createProjectSchema.partial();

const querySchema = z.object({
  search: z.string().optional(),
  tags: z.string().optional(),
  userId: z.string().optional(),
  public: z.enum(["true", "false", "all"]).default("true"),
  limit: z.coerce.number().default(50),
  offset: z.coerce.number().default(0),
});

app.get("/", zValidator("query", querySchema), async (c) => {
  const { search, tags, userId, public: publicFilter, limit, offset } = c.req.valid("query");
  const sessionUserId = c.get("sessionUserId"); // From JWT if present
  const scopes = c.get("apiKeyScopes") || [];
  const isAdmin = scopes.includes("admin") || scopes.includes("root");

  // If user is authenticated via JWT, use RLS
  if (sessionUserId) {
    const results = await withUser(sessionUserId, async (tx) => {
      let query = tx.select().from(projects);
      const conditions: any[] = [];
      
      // With RLS, the database will automatically filter based on the user
      // We just need to add search/filter conditions
      
      if (search) {
        conditions.push(
          or(
            ilike(projects.title, `%${search}%`),
            ilike(projects.description, `%${search}%`)
          )
        );
      }
      
      if (tags) {
        const tagArray = tags.split(",").map(t => t.trim());
        conditions.push(arrayContains(projects.tags, tagArray));
      }
      
      // If specific user filter, only show if it's the current user or public projects
      if (userId && userId !== sessionUserId) {
        conditions.push(eq(projects.isPublic, true));
        conditions.push(eq(projects.userId, userId));
      }
      
      return (conditions.length > 0
        ? query.where(and(...conditions))
        : query)
        .orderBy(desc(projects.createdAt))
        .limit(limit)
        .offset(offset);
    });
    
    return c.json(results);
  }

  // No JWT auth - only show public projects or filter by specific user
  const conditions: any[] = [];

  // Without authentication, only show public projects unless admin API key
  if (!isAdmin) {
    if (publicFilter === "all") {
      // Without JWT, can only see public projects
      conditions.push(eq(projects.isPublic, true));
    } else if (publicFilter === "false") {
      // Cannot see private projects without authentication
      return c.json([], 200); // Return empty array
    } else {
      conditions.push(eq(projects.isPublic, true));
    }
  } else if (publicFilter !== "all") {
    conditions.push(eq(projects.isPublic, publicFilter === "true"));
  }

  if (userId) {
    if (!isAdmin) {
      // Only show public projects for the specified user
      conditions.push(
        and(
          eq(projects.userId, userId),
          eq(projects.isPublic, true)
        )
      );
    } else {
      conditions.push(eq(projects.userId, userId));
    }
  }

  if (search) {
    conditions.push(
      or(
        ilike(projects.title, `%${search}%`),
        ilike(projects.description, `%${search}%`)
      )
    );
  }

  if (tags) {
    const tagArray = tags.split(",").map(t => t.trim());
    conditions.push(arrayContains(projects.tags, tagArray));
  }

  const query = db.select().from(projects);
  
  const results = await (conditions.length > 0
    ? query.where(and(...conditions))
    : query)
    .orderBy(desc(projects.createdAt))
    .limit(limit)
    .offset(offset);

  return c.json(results);
});

app.get("/:id", async (c) => {
  const projectId = c.req.param("id");
  const sessionUserId = c.get("sessionUserId"); 
  const scopes = c.get("apiKeyScopes") || [];
  const isAdmin = scopes.includes("admin") || scopes.includes("root");

  const project = await db.query.projects.findFirst({
    where: eq(projects.id, projectId),
    with: {
      user: true,
    },
  });

  if (!project) {
    return c.json({ error: "Project not found" }, 404);
  }

  // Check access: public projects are accessible to all, private only to owner or admin
  if (!project.isPublic && project.userId !== sessionUserId && !isAdmin) {
    return c.json({ error: "Access denied" }, 403);
  }

  return c.json(project);
});

app.post("/", requireJwtAuth, requireScopes("write"), zValidator("json", createProjectSchema), async (c) => {
  const data = c.req.valid("json");
  const sessionUserId = c.get("sessionUserId")!; // Must be authenticated via JWT

  const newProject: NewProject = {
    ...data,
    userId: sessionUserId,
    tags: data.tags || [],
  };

  // Use RLS to ensure user can only create their own projects
  const result = await withUser(sessionUserId, async (tx) => {
    const [project] = await tx.insert(projects).values(newProject).returning();
    return project;
  });

  return c.json(result, 201);
});

app.patch("/:id", requireJwtAuth, requireScopes("write"), zValidator("json", updateProjectSchema), async (c) => {
  const projectId = c.req.param("id");
  const updates = c.req.valid("json");
  const sessionUserId = c.get("sessionUserId")!;

  // RLS will ensure user can only update their own projects
  const result = await withUser(sessionUserId, async (tx) => {
    const [updated] = await tx
      .update(projects)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, projectId))
      .returning();
    return updated;
  });

  if (!result) {
    return c.json({ error: "Project not found or access denied" }, 404);
  }

  return c.json(result);
});

app.delete("/:id", requireJwtAuth, requireScopes("write"), async (c) => {
  const projectId = c.req.param("id");
  const sessionUserId = c.get("sessionUserId")!;

  // RLS will ensure user can only delete their own projects
  try {
    await withUser(sessionUserId, async (tx) => {
      await tx.delete(projects).where(eq(projects.id, projectId));
    });
    return c.json({ success: true });
  } catch (error) {
    return c.json({ error: "Project not found or access denied" }, 404);
  }
});

app.get("/user/:userId", async (c) => {
  const userId = c.req.param("userId");
  const sessionUserId = c.get("sessionUserId"); // From JWT
  const scopes = c.get("apiKeyScopes") || [];
  const isAdmin = scopes.includes("admin") || scopes.includes("root");

  let conditions: any;
  // Show all projects if: admin, or viewing own projects when authenticated
  if (!isAdmin && userId !== sessionUserId) {
    // Only show public projects for other users
    conditions = and(
      eq(projects.userId, userId),
      eq(projects.isPublic, true)
    );
  } else {
    conditions = eq(projects.userId, userId);
  }

  const userProjects = await db
    .select()
    .from(projects)
    .where(conditions)
    .orderBy(desc(projects.createdAt));

  return c.json(userProjects);
});

app.get("/tags/popular", async (c) => {
  const result = await db.execute(sql`
    SELECT tag, COUNT(*) as count
    FROM projects, unnest(tags) as tag
    WHERE is_public = true
    GROUP BY tag
    ORDER BY count DESC
    LIMIT 20
  `);

  return c.json(result);
});

export default app;