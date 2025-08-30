import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { db, projects, withUser } from "../../client";
import type { NewProject, UserRole } from "../../schema";
import { eq, and, or, desc, ilike, arrayContains, sql } from "drizzle-orm";
import { requireAuth, withJwtAuth, requireJwtAuth } from "../middleware/auth";

type Variables = {
	userId?: string;
	userRole?: UserRole;
	apiKeyId?: string;
	apiKeyType?: string;
	clientName?: string;
};

const app = new OpenAPIHono<{ Variables: Variables }>();

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

const listProjectsRoute = createRoute({
	method: "get",
	path: "/",
	description: "List projects with optional filtering by search terms, tags, user, and visibility",
	summary: "List projects",
	request: {
		query: querySchema,
	},
	responses: {
		200: {
			description: "List of projects",
			content: {
				"application/json": {
					schema: z.array(
						z.object({
							id: z.string(),
							title: z.string(),
							description: z.string(),
							githubUrl: z.string().nullable(),
							deploymentUrl: z.string().nullable(),
							tags: z.array(z.string()).nullable(),
							isPublic: z.boolean(),
							userId: z.string(),
							createdAt: z.string().nullable(),
							updatedAt: z.string().nullable(),
						}),
					),
				},
			},
		},
	},
	tags: ["Projects"],
});

app.openapi(listProjectsRoute, async (c) => {
	const {
		search,
		tags,
		userId,
		public: publicFilter,
		limit,
		offset,
	} = c.req.valid("query");
	const currentUserId = c.get("userId");
	const userRole = c.get("userRole") as UserRole | undefined;
	const isAdmin = userRole === 'admin';
	const isMember = userRole === 'member';

	if (currentUserId) {
		const results = await withUser(currentUserId, userRole || null, async (tx) => {
			const conditions: any[] = [];

			if (search) {
				conditions.push(
					or(
						ilike(projects.title, `%${search}%`),
						ilike(projects.description, `%${search}%`),
					),
				);
			}

			if (tags) {
				const tagArray = tags.split(",").map((t) => t.trim());
				conditions.push(arrayContains(projects.tags, tagArray));
			}

			if (userId && userId !== currentUserId) {
				// When querying another user's projects, respect visibility
				if (!isAdmin && !isMember) {
					conditions.push(eq(projects.isPublic, true));
				}
				conditions.push(eq(projects.userId, userId));
			}

			const query = tx.select().from(projects);
			const finalQuery = conditions.length > 0
				? query.where(and(...conditions))
				: query;

			return await finalQuery
				.orderBy(desc(projects.createdAt))
				.limit(limit)
				.offset(offset);
		});

		return c.json(results);
	}

	// For unauthenticated requests, use withUser with null role (defaults to public)
	const results = await withUser(null, null, async (tx) => {
		const conditions: any[] = [];

		if (!isAdmin && !isMember) {
			// Public users can only see public projects
			if (publicFilter === "false") {
				return [];
			}
			conditions.push(eq(projects.isPublic, true));
		} else if (publicFilter !== "all") {
			conditions.push(eq(projects.isPublic, publicFilter === "true"));
		}

		if (userId) {
			if (!isAdmin && !isMember) {
				conditions.push(
					and(eq(projects.userId, userId), eq(projects.isPublic, true)),
				);
			} else {
				conditions.push(eq(projects.userId, userId));
			}
		}

		if (search) {
			conditions.push(
				or(
					ilike(projects.title, `%${search}%`),
					ilike(projects.description, `%${search}%`),
				),
			);
		}

		if (tags) {
			const tagArray = tags.split(",").map((t) => t.trim());
			conditions.push(arrayContains(projects.tags, tagArray));
		}

		const query = tx.select().from(projects);
		const finalQuery = conditions.length > 0
			? query.where(and(...conditions))
			: query;

		return await finalQuery
			.orderBy(desc(projects.createdAt))
			.limit(limit)
			.offset(offset);
	});

	return c.json(results);
});

const getProjectRoute = createRoute({
	method: "get",
	path: "/{id}",
	description: "Retrieve detailed information about a specific project by its ID",
	summary: "Get project details",
	request: {
		params: z.object({
			id: z.string(),
		}),
	},
	responses: {
		200: {
			description: "Project details",
			content: {
				"application/json": {
					schema: z.object({
						id: z.string(),
						title: z.string(),
						description: z.string(),
						githubUrl: z.string().nullable(),
						deploymentUrl: z.string().nullable(),
						tags: z.array(z.string()).nullable(),
						isPublic: z.boolean(),
						userId: z.string(),
						createdAt: z.string().nullable(),
						updatedAt: z.string().nullable(),
						user: z.any().optional(),
					}),
				},
			},
		},
		404: {
			description: "Project not found",
			content: {
				"application/json": {
					schema: z.object({
						error: z.string(),
					}),
				},
			},
		},
		403: {
			description: "Access denied",
			content: {
				"application/json": {
					schema: z.object({
						error: z.string(),
					}),
				},
			},
		},
	},
	tags: ["Projects"],
});

app.openapi(getProjectRoute, async (c) => {
	const { id: projectId } = c.req.valid("param") as { id: string };
	const currentUserId = c.get("userId");
	const userRole = c.get("userRole") as UserRole | undefined;

	// Use withUser to apply RLS policies
	const project = await withUser(currentUserId || null, userRole || null, async (tx) => {
		return tx.query.projects.findFirst({
			where: eq(projects.id, projectId),
			with: {
				user: true,
			},
		});
	});

	if (!project) {
		return c.json({ error: "Project not found or access denied" }, 404);
	}

	return c.json(project, 200);
});

const createProjectRoute = createRoute({
	method: "post",
	path: "/",
	description: "Create a new project for the authenticated user",
	summary: "Create project",
	middleware: [requireJwtAuth, requireAuth],
	request: {
		body: {
			content: {
				"application/json": {
					schema: createProjectSchema,
				},
			},
		},
	},
	responses: {
		201: {
			description: "Project created",
			content: {
				"application/json": {
					schema: z.object({
						id: z.string(),
						title: z.string(),
						description: z.string(),
						githubUrl: z.string().nullable(),
						deploymentUrl: z.string().nullable(),
						tags: z.array(z.string()).nullable(),
						isPublic: z.boolean(),
						userId: z.string(),
						createdAt: z.string().nullable(),
						updatedAt: z.string().nullable(),
					}),
				},
			},
		},
		401: {
			description: "Authentication required",
			content: {
				"application/json": {
					schema: z.object({
						error: z.string(),
					}),
				},
			},
		},
	},
	tags: ["Projects"],
});

app.openapi(createProjectRoute, async (c) => {
	const data = c.req.valid("json");
	const currentUserId = c.get("userId")!;
	const userRole = c.get("userRole")!;

	const newProject: NewProject = {
		...data,
		userId: currentUserId,
		tags: data.tags || [],
	};

	const result = await withUser(currentUserId, userRole, async (tx) => {
		const [project] = await tx.insert(projects).values(newProject).returning();
		return project;
	});

	return c.json(result, 201);
});

const updateProjectRoute = createRoute({
	method: "patch",
	path: "/{id}",
	description: "Update an existing project owned by the authenticated user",
	summary: "Update project",
	middleware: [requireJwtAuth, requireAuth],
	request: {
		params: z.object({
			id: z.string(),
		}),
		body: {
			content: {
				"application/json": {
					schema: updateProjectSchema,
				},
			},
		},
	},
	responses: {
		200: {
			description: "Project updated",
			content: {
				"application/json": {
					schema: z.object({
						id: z.string(),
						title: z.string(),
						description: z.string(),
						githubUrl: z.string().nullable(),
						deploymentUrl: z.string().nullable(),
						tags: z.array(z.string()).nullable(),
						isPublic: z.boolean(),
						userId: z.string(),
						createdAt: z.string().nullable(),
						updatedAt: z.string().nullable(),
					}),
				},
			},
		},
		404: {
			description: "Project not found or access denied",
			content: {
				"application/json": {
					schema: z.object({
						error: z.string(),
					}),
				},
			},
		},
	},
	tags: ["Projects"],
});

app.openapi(updateProjectRoute, async (c) => {
	const { id: projectId } = c.req.valid("param");
	const updates = c.req.valid("json");
	const currentUserId = c.get("userId")!;
	const userRole = c.get("userRole")!;

	const result = await withUser(currentUserId, userRole, async (tx) => {
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

const deleteProjectRoute = createRoute({
	method: "delete",
	path: "/{id}",
	description: "Delete a project owned by the authenticated user",
	summary: "Delete project",
	middleware: [requireJwtAuth, requireAuth],
	request: {
		params: z.object({
			id: z.string(),
		}),
	},
	responses: {
		200: {
			description: "Project deleted",
			content: {
				"application/json": {
					schema: z.object({
						success: z.boolean(),
					}),
				},
			},
		},
		404: {
			description: "Project not found or access denied",
			content: {
				"application/json": {
					schema: z.object({
						error: z.string(),
					}),
				},
			},
		},
	},
	tags: ["Projects"],
});

app.openapi(deleteProjectRoute, async (c) => {
	const { id: projectId } = c.req.valid("param");
	const currentUserId = c.get("userId")!;
	const userRole = c.get("userRole")!;

	try {
		await withUser(currentUserId, userRole, async (tx) => {
			await tx.delete(projects).where(eq(projects.id, projectId));
		});
		return c.json({ success: true }, 200);
	} catch (error) {
		return c.json({ error: "Project not found or access denied" }, 404);
	}
});

const getUserProjectsRoute = createRoute({
	method: "get",
	path: "/user/{userId}",
	description: "List all projects belonging to a specific user",
	summary: "Get user projects",
	request: {
		params: z.object({
			userId: z.string(),
		}),
	},
	responses: {
		200: {
			description: "User's projects",
			content: {
				"application/json": {
					schema: z.array(
						z.object({
							id: z.string(),
							title: z.string(),
							description: z.string(),
							githubUrl: z.string().nullable(),
							deploymentUrl: z.string().nullable(),
							tags: z.array(z.string()).nullable(),
							isPublic: z.boolean(),
							userId: z.string(),
							createdAt: z.string().nullable(),
							updatedAt: z.string().nullable(),
						}),
					),
				},
			},
		},
	},
	tags: ["Projects"],
});

app.openapi(getUserProjectsRoute, async (c) => {
	const { userId } = c.req.valid("param");
	const currentUserId = c.get("userId");
	const userRole = c.get("userRole") as UserRole | undefined;

	// Use withUser to apply RLS policies
	const userProjects = await withUser(currentUserId || null, userRole || null, async (tx) => {
		return tx
			.select()
			.from(projects)
			.where(eq(projects.userId, userId))
			.orderBy(desc(projects.createdAt));
	});

	return c.json(userProjects);
});

const getPopularTagsRoute = createRoute({
	method: "get",
	path: "/tags/popular",
	description: "Retrieve the most popular tags used across all public projects",
	summary: "Get popular tags",
	responses: {
		200: {
			description: "Popular project tags",
			content: {
				"application/json": {
					schema: z.array(
						z.object({
							tag: z.string(),
							count: z.number(),
						}),
					),
				},
			},
		},
	},
	tags: ["Projects"],
});

app.openapi(getPopularTagsRoute, async (c) => {
	const result = await db.execute(sql`
    SELECT tag, COUNT(*) as count
    FROM projects, unnest(tags) as tag
    WHERE is_public = true
    GROUP BY tag
    ORDER BY count DESC
    LIMIT 20
  `);

	const rows = result as unknown as { tag: string; count: number }[];
	return c.json(rows);
});

export default app;
