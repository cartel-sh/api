import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { db, projects, withUser } from "../../client";
import type { NewProject, UserRole } from "../../schema";
import { eq, and, or, desc, ilike, arrayContains, sql } from "drizzle-orm";
import { requireAuth, withJwtAuth, requireJwtAuth } from "../middleware/auth";
import { requestLogging } from "../middleware/logging";
import {
	CreateProjectSchema,
	UpdateProjectSchema,
	ProjectSchema,
	ProjectWithUserSchema,
	ProjectQuerySchema,
	ProjectListResponseSchema,
	PopularTagsResponseSchema,
	ErrorResponseSchema,
	ErrorWithDetailsResponseSchema,
	SuccessResponseSchema,
} from "../../shared/schemas";

type Variables = {
	userId?: string;
	userRole?: UserRole;
	apiKeyId?: string;
	apiKeyType?: string;
	clientName?: string;
	logger?: any;
};

const app = new OpenAPIHono<{ Variables: Variables }>();

app.use("*", requestLogging());
app.use("*", withJwtAuth);

const listProjectsRoute = createRoute({
	method: "get",
	path: "/",
	description: "List projects with optional filtering by search terms, tags, user, and visibility",
	summary: "List projects",
	request: {
		query: ProjectQuerySchema,
	},
	responses: {
		200: {
			description: "List of projects",
			content: {
				"application/json": {
					schema: ProjectListResponseSchema,
				},
			},
		},
		500: {
			description: "Internal server error",
			content: {
				"application/json": {
					schema: ErrorWithDetailsResponseSchema,
				},
			},
		},
	},
	tags: ["Projects"],
});

app.openapi(listProjectsRoute, async (c) => {
	const logger = c.get("logger");
	try {
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

		logger.info("Listing projects", { 
			search, 
			tags, 
			userId, 
			publicFilter, 
			limit, 
			offset,
			currentUserId,
			userRole,
		});

	if (currentUserId) {
		logger.logDatabase("query", "projects", { 
			authenticated: true,
			filters: { search, tags, userId, publicFilter }
		});
		
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

		logger.info("Projects query completed", { 
			resultCount: results.length,
			authenticated: true
		});
		return c.json(results);
	}

	// For unauthenticated requests, use withUser with null role (defaults to public)
	const results = await withUser(null, null, async (tx) => {
		const conditions: any[] = [];

		// For unauthenticated users, only show public projects
		if (publicFilter === "false") {
			return [];
		}
		conditions.push(eq(projects.isPublic, true));

		if (userId) {
			conditions.push(
				and(eq(projects.userId, userId), eq(projects.isPublic, true)),
			);
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
	} catch (error) {
		logger.error("Projects listing failed", error);
		return c.json({ error: "Internal server error" }, 500);
	}
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
					schema: ProjectWithUserSchema,
				},
			},
		},
		404: {
			description: "Project not found",
			content: {
				"application/json": {
					schema: ErrorResponseSchema,
				},
			},
		},
		403: {
			description: "Access denied",
			content: {
				"application/json": {
					schema: ErrorResponseSchema,
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
					schema: CreateProjectSchema,
				},
			},
		},
	},
	responses: {
		201: {
			description: "Project created",
			content: {
				"application/json": {
					schema: ProjectSchema,
				},
			},
		},
		401: {
			description: "Authentication required",
			content: {
				"application/json": {
					schema: ErrorResponseSchema,
				},
			},
		},
		500: {
			description: "Internal server error",
			content: {
				"application/json": {
					schema: ErrorWithDetailsResponseSchema,
				},
			},
		},
	},
	tags: ["Projects"],
});

app.openapi(createProjectRoute, async (c) => {
	const logger = c.get("logger");
	try {
		const data = c.req.valid("json");
		const currentUserId = c.get("userId")!;
		const userRole = c.get("userRole")!;

		logger.info("Creating new project", { 
			userId: currentUserId, 
			userRole,
			title: data.title,
			isPublic: data.isPublic 
		});

		const newProject: NewProject = {
			...data,
			userId: currentUserId,
			tags: data.tags || [],
		};

		logger.debug("Creating project with data", {
			title: newProject.title,
			userId: currentUserId,
			tagsCount: newProject.tags?.length || 0,
		});

		const result = await withUser(currentUserId, userRole, async (tx) => {
			logger.logDatabase("insert", "projects", {
				userId: currentUserId,
				title: newProject.title,
			});
			const [project] = await tx.insert(projects).values(newProject).returning();
			logger.debug("Project inserted successfully", {
				projectId: project.id,
				title: project.title,
			});
			return project;
		});

		return c.json(result, 201);
	} catch (error) {
		logger.error("Project creation failed", error);
		const errorMessage = error instanceof Error ? error.message : String(error);
		return c.json({ error: "Internal server error", details: errorMessage }, 500);
	}
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
					schema: UpdateProjectSchema,
				},
			},
		},
	},
	responses: {
		200: {
			description: "Project updated",
			content: {
				"application/json": {
					schema: ProjectSchema,
				},
			},
		},
		404: {
			description: "Project not found or access denied",
			content: {
				"application/json": {
					schema: ErrorResponseSchema,
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
					schema: SuccessResponseSchema,
				},
			},
		},
		404: {
			description: "Project not found or access denied",
			content: {
				"application/json": {
					schema: ErrorResponseSchema,
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
					schema: ProjectListResponseSchema,
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
					schema: PopularTagsResponseSchema,
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
