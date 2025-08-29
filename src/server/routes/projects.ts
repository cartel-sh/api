import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { db, projects, withUser } from "../../client";
import type { NewProject } from "../../schema";
import { eq, and, or, desc, ilike, arrayContains, sql } from "drizzle-orm";
import { requireScopes, withJwtAuth, requireJwtAuth } from "../middleware/auth";

type Variables = {
	apiKeyUserId?: string;
	apiKeyScopes?: string[];
	apiKeyId?: string;
	apiKeyType?: string;
	sessionUserId?: string;
	userAddress?: string;
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
	const sessionUserId = c.get("sessionUserId");
	const scopes = c.get("apiKeyScopes") || [];
	const isAdmin = scopes.includes("admin") || scopes.includes("root");

	if (sessionUserId) {
		const results = await withUser(sessionUserId, async (tx) => {
			let query = tx.select().from(projects);
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

			if (userId && userId !== sessionUserId) {
				conditions.push(eq(projects.isPublic, true));
				conditions.push(eq(projects.userId, userId));
			}

			return (conditions.length > 0 ? query.where(and(...conditions)) : query)
				.orderBy(desc(projects.createdAt))
				.limit(limit)
				.offset(offset);
		});

		return c.json(results);
	}

	const conditions: any[] = [];

	if (!isAdmin) {
		if (publicFilter === "all") {
			conditions.push(eq(projects.isPublic, true));
		} else if (publicFilter === "false") {
			return c.json([], 200);
		} else {
			conditions.push(eq(projects.isPublic, true));
		}
	} else if (publicFilter !== "all") {
		conditions.push(eq(projects.isPublic, publicFilter === "true"));
	}

	if (userId) {
		if (!isAdmin) {
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

	const query = db.select().from(projects);

	const results = await (conditions.length > 0
		? query.where(and(...conditions))
		: query
	)
		.orderBy(desc(projects.createdAt))
		.limit(limit)
		.offset(offset);

	return c.json(results);
});

const getProjectRoute = createRoute({
	method: "get",
	path: "/{id}",
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

	if (!project.isPublic && project.userId !== sessionUserId && !isAdmin) {
		return c.json({ error: "Access denied" }, 403);
	}

	return c.json(project, 200);
});

const createProjectRoute = createRoute({
	method: "post",
	path: "/",
	middleware: [requireJwtAuth, requireScopes("write")],
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
	const sessionUserId = c.get("sessionUserId")!;

	const newProject: NewProject = {
		...data,
		userId: sessionUserId,
		tags: data.tags || [],
	};

	const result = await withUser(sessionUserId, async (tx) => {
		const [project] = await tx.insert(projects).values(newProject).returning();
		return project;
	});

	return c.json(result, 201);
});

const updateProjectRoute = createRoute({
	method: "patch",
	path: "/{id}",
	middleware: [requireJwtAuth, requireScopes("write")],
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
	const sessionUserId = c.get("sessionUserId")!;

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

const deleteProjectRoute = createRoute({
	method: "delete",
	path: "/{id}",
	middleware: [requireJwtAuth, requireScopes("write")],
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
	const sessionUserId = c.get("sessionUserId")!;

	try {
		await withUser(sessionUserId, async (tx) => {
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
	const sessionUserId = c.get("sessionUserId");
	const scopes = c.get("apiKeyScopes") || [];
	const isAdmin = scopes.includes("admin") || scopes.includes("root");

	let conditions: any;
	if (!isAdmin && userId !== sessionUserId) {
		conditions = and(eq(projects.userId, userId), eq(projects.isPublic, true));
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

const getPopularTagsRoute = createRoute({
	method: "get",
	path: "/tags/popular",
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
