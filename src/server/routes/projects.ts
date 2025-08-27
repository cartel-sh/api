import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { db, projects } from "../../client";
import type { NewProject } from "../../schema";
import { eq, and, or, desc, ilike, arrayContains, sql } from "drizzle-orm";
import { apiKeyAuth, requireScopes } from "../middleware/auth";

type Variables = {
  userId: string;
  apiKeyScopes: string[];
  apiKeyId?: string;
  apiKeyType?: string;
};

const app = new Hono<{ Variables: Variables }>();

app.use("*", apiKeyAuth);

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
  const currentUserId = c.get("userId") as string;
  const scopes = c.get("apiKeyScopes") as string[];
  const isAdmin = scopes.includes("admin") || scopes.includes("root");

  const conditions: any[] = [];

  if (!isAdmin) {
    if (publicFilter === "all") {
      conditions.push(
        or(
          eq(projects.userId, currentUserId),
          eq(projects.isPublic, true)
        )
      );
    } else if (publicFilter === "false") {
      conditions.push(
        and(
          eq(projects.userId, currentUserId),
          eq(projects.isPublic, false)
        )
      );
    } else {
      conditions.push(eq(projects.isPublic, true));
    }
  } else if (publicFilter !== "all") {
    conditions.push(eq(projects.isPublic, publicFilter === "true"));
  }

  if (userId) {
    if (!isAdmin && userId !== currentUserId) {
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
  const currentUserId = c.get("userId") as string;
  const scopes = c.get("apiKeyScopes") as string[];
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

  if (!project.isPublic && project.userId !== currentUserId && !isAdmin) {
    return c.json({ error: "Access denied" }, 403);
  }

  return c.json(project);
});

app.post("/", requireScopes("write"), zValidator("json", createProjectSchema), async (c) => {
  const data = c.req.valid("json");
  const userId = c.get("userId") as string;

  const newProject: NewProject = {
    ...data,
    userId,
    tags: data.tags || [],
  };

  const [result] = await db.insert(projects).values(newProject).returning();
  return c.json(result, 201);
});

app.patch("/:id", requireScopes("write"), zValidator("json", updateProjectSchema), async (c) => {
  const projectId = c.req.param("id");
  const updates = c.req.valid("json");
  const currentUserId = c.get("userId") as string;
  const scopes = c.get("apiKeyScopes") as string[];
  const isAdmin = scopes.includes("admin") || scopes.includes("root");

  const existingProject = await db.query.projects.findFirst({
    where: eq(projects.id, projectId),
  });

  if (!existingProject) {
    return c.json({ error: "Project not found" }, 404);
  }

  if (existingProject.userId !== currentUserId && !isAdmin) {
    return c.json({ error: "Access denied" }, 403);
  }

  const [updated] = await db
    .update(projects)
    .set({
      ...updates,
      updatedAt: new Date(),
    })
    .where(eq(projects.id, projectId))
    .returning();

  return c.json(updated);
});

app.delete("/:id", requireScopes("write"), async (c) => {
  const projectId = c.req.param("id");
  const currentUserId = c.get("userId") as string;
  const scopes = c.get("apiKeyScopes") as string[];
  const isAdmin = scopes.includes("admin") || scopes.includes("root");

  const existingProject = await db.query.projects.findFirst({
    where: eq(projects.id, projectId),
  });

  if (!existingProject) {
    return c.json({ error: "Project not found" }, 404);
  }

  if (existingProject.userId !== currentUserId && !isAdmin) {
    return c.json({ error: "Access denied" }, 403);
  }

  await db.delete(projects).where(eq(projects.id, projectId));
  return c.json({ success: true });
});

app.get("/user/:userId", async (c) => {
  const userId = c.req.param("userId");
  const currentUserId = c.get("userId") as string;
  const scopes = c.get("apiKeyScopes") as string[];
  const isAdmin = scopes.includes("admin") || scopes.includes("root");

  let conditions: any;
  if (!isAdmin && userId !== currentUserId) {
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