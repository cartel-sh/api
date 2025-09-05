import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { db } from "../../client";
import { treasuries, projects, projectTreasuries, users } from "../../schema";
import { eq, and, desc, sql } from "drizzle-orm";
import type { NewTreasury } from "../../schema";
import {
	TreasurySchema,
	CreateTreasurySchema,
	ProjectTreasurySchema,
	AddProjectTreasurySchema,
	TreasuryQuerySchema,
	TreasuryWithProjectsSchema,
} from "../../shared/schemas";

// Define the context variables that our auth middleware provides
type Variables = {
	userId?: string;
	userRole?: string;
};

const app = new OpenAPIHono<{ Variables: Variables }>();


// List all treasuries
const listTreasuries = createRoute({
	method: "get",
	path: "/",
	description: "List all active treasuries with optional filtering by chain or type",
	summary: "List treasuries",
	request: {
		query: TreasuryQuerySchema,
	},
	responses: {
		200: {
			description: "List of treasuries",
			content: {
				"application/json": {
					schema: z.array(TreasurySchema),
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
	tags: ["Treasuries"],
});

app.openapi(listTreasuries, async (c) => {
	const { chain, type, limit = 50, offset = 0 } = c.req.valid("query");
	
	try {
		let whereClause = eq(treasuries.isActive, true);
		
		if (chain) {
			whereClause = and(whereClause, eq(treasuries.chain, chain))!;
		}
		
		if (type) {
			whereClause = and(whereClause, eq(treasuries.type, type))!;
		}
		
		const results = await db
			.select()
			.from(treasuries)
			.where(whereClause)
			.limit(limit)
			.offset(offset);
		
		// Transform results to ensure owners is always an array
		const transformedResults = results.map(treasury => ({
			...treasury,
			owners: treasury.owners || []
		}));
		
		return c.json(transformedResults, 200);
	} catch (error) {
		console.error("Error listing treasuries:", error);
		return c.json({ error: "Failed to list treasuries" }, 500);
	}
});

// Get treasury by ID
const getTreasury = createRoute({
	method: "get",
	path: "/{id}",
	description: "Get a specific treasury by its ID including associated projects",
	summary: "Get treasury",
	request: {
		params: z.object({
			id: z.string().uuid().describe("Treasury ID"),
		}),
	},
	responses: {
		200: {
			description: "Treasury details",
			content: {
				"application/json": {
					schema: TreasuryWithProjectsSchema,
				},
			},
		},
		404: {
			description: "Treasury not found",
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
	tags: ["Treasuries"],
});

app.openapi(getTreasury, async (c) => {
	const { id } = c.req.valid("param");
	
	try {
		const [treasury] = await db
			.select()
			.from(treasuries)
			.where(eq(treasuries.id, id))
			.limit(1);
		
		if (!treasury) {
			return c.json({ error: "Treasury not found" }, 404);
		}
		
		// Get associated projects
		const projectLinks = await db
			.select({
				id: projects.id,
				title: projects.title,
				description: projects.description,
				role: projectTreasuries.role,
				projectDescription: projectTreasuries.description,
			})
			.from(projectTreasuries)
			.innerJoin(projects, eq(projectTreasuries.projectId, projects.id))
			.where(eq(projectTreasuries.treasuryId, id));
		
		return c.json({
			...treasury,
			owners: treasury.owners || [],
			projects: projectLinks,
		}, 200);
	} catch (error) {
		console.error("Error getting treasury:", error);
		return c.json({ error: "Failed to get treasury" }, 500);
	}
});

// Create treasury (admin only)
const createTreasury = createRoute({
	method: "post",
	path: "/",
	description: "Create a new treasury (admin only)",
	summary: "Create treasury",
	request: {
		body: {
			content: {
				"application/json": {
					schema: CreateTreasurySchema,
				},
			},
		},
	},
	responses: {
		201: {
			description: "Treasury created successfully",
			content: {
				"application/json": {
					schema: TreasurySchema,
				},
			},
		},
		400: {
			description: "Invalid request data",
			content: {
				"application/json": {
					schema: z.object({
						error: z.string(),
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
	tags: ["Treasuries"],
});

app.openapi(createTreasury, async (c) => {
	const userId = c.get("userId");
	const userRole = c.get("userRole");
	
	if (!userId || userRole !== "admin") {
		return c.json({ error: "Admin access required" }, 401);
	}
	
	const data = c.req.valid("json");
	
	try {
		const [newTreasury] = await db
			.insert(treasuries)
			.values({
				...data,
				owners: data.owners || [],
			} as NewTreasury)
			.returning();
		
		return c.json(newTreasury, 201);
	} catch (error: any) {
		console.error("Error creating treasury:", error);
		if (error.code === "23505") {
			return c.json({ error: "Treasury with this address already exists" }, 400);
		}
		return c.json({ error: "Failed to create treasury" }, 500);
	}
});

// Update treasury (admin only)
const updateTreasury = createRoute({
	method: "patch",
	path: "/{id}",
	description: "Update treasury information (admin only)",
	summary: "Update treasury",
	request: {
		params: z.object({
			id: z.string().uuid().describe("Treasury ID"),
		}),
		body: {
			content: {
				"application/json": {
					schema: CreateTreasurySchema.partial(),
				},
			},
		},
	},
	responses: {
		200: {
			description: "Treasury updated successfully",
			content: {
				"application/json": {
					schema: TreasurySchema,
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
		404: {
			description: "Treasury not found",
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
	tags: ["Treasuries"],
});

app.openapi(updateTreasury, async (c) => {
	const userId = c.get("userId");
	const userRole = c.get("userRole");
	
	if (!userId || userRole !== "admin") {
		return c.json({ error: "Admin access required" }, 401);
	}
	
	const { id } = c.req.valid("param");
	const data = c.req.valid("json");
	
	try {
		const [updated] = await db
			.update(treasuries)
			.set({
				...data,
				updatedAt: new Date(),
			})
			.where(eq(treasuries.id, id))
			.returning();
		
		if (!updated) {
			return c.json({ error: "Treasury not found" }, 404);
		}
		
		return c.json({
			...updated,
			owners: updated.owners || []
		}, 200);
	} catch (error) {
		console.error("Error updating treasury:", error);
		return c.json({ error: "Failed to update treasury" }, 500);
	}
});

// List project treasuries
const listProjectTreasuries = createRoute({
	method: "get",
	path: "/projects/{projectId}",
	description: "List all treasuries associated with a specific project",
	summary: "List project treasuries",
	request: {
		params: z.object({
			projectId: z.string().uuid().describe("Project ID"),
		}),
	},
	responses: {
		200: {
			description: "List of project treasuries",
			content: {
				"application/json": {
					schema: z.array(ProjectTreasurySchema),
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
	tags: ["Treasuries"],
});

app.openapi(listProjectTreasuries, async (c) => {
	const { projectId } = c.req.valid("param");
	
	try {
		const results = await db
			.select({
				projectId: projectTreasuries.projectId,
				treasuryId: projectTreasuries.treasuryId,
				addedBy: projectTreasuries.addedBy,
				role: projectTreasuries.role,
				description: projectTreasuries.description,
				createdAt: projectTreasuries.createdAt,
				treasury: treasuries,
			})
			.from(projectTreasuries)
			.innerJoin(treasuries, eq(projectTreasuries.treasuryId, treasuries.id))
			.where(eq(projectTreasuries.projectId, projectId));
		
		// Transform the results to ensure owners is always an array
		const transformedResults = results.map(result => ({
			...result,
			treasury: result.treasury ? {
				...result.treasury,
				owners: result.treasury.owners || []
			} : result.treasury
		}));
		
		return c.json(transformedResults, 200);
	} catch (error) {
		console.error("Error listing project treasuries:", error);
		return c.json({ error: "Failed to list project treasuries" }, 500);
	}
});

// Add treasury to project
const addProjectTreasury = createRoute({
	method: "post",
	path: "/projects/{projectId}",
	description: "Add a treasury to a project (project owner only)",
	summary: "Add project treasury",
	request: {
		params: z.object({
			projectId: z.string().uuid().describe("Project ID"),
		}),
		body: {
			content: {
				"application/json": {
					schema: AddProjectTreasurySchema,
				},
			},
		},
	},
	responses: {
		201: {
			description: "Treasury added to project",
			content: {
				"application/json": {
					schema: ProjectTreasurySchema,
				},
			},
		},
		400: {
			description: "Invalid request",
			content: {
				"application/json": {
					schema: z.object({
						error: z.string(),
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
	tags: ["Treasuries"],
});

app.openapi(addProjectTreasury, async (c) => {
	const userId = c.get("userId");
	
	if (!userId) {
		return c.json({ error: "Authentication required" }, 401);
	}
	
	const { projectId } = c.req.valid("param");
	const data = c.req.valid("json");
	
	try {
		// Check if user owns the project
		const [project] = await db
			.select()
			.from(projects)
			.where(and(
				eq(projects.id, projectId),
				eq(projects.userId, userId)
			))
			.limit(1);
		
		if (!project) {
			return c.json({ error: "Project not found or unauthorized" }, 401);
		}
		
		let treasuryId = data.treasuryId;
		
		// If no treasuryId provided, check if we should create a new treasury
		if (!treasuryId && data.address && data.name) {
			// Check if treasury with this address already exists
			const [existingTreasury] = await db
				.select()
				.from(treasuries)
				.where(eq(treasuries.address, data.address))
				.limit(1);
			
			if (existingTreasury) {
				treasuryId = existingTreasury.id;
			} else {
				const treasuryData: any = {
					address: data.address,
					name: data.name,
					purpose: data.purpose,
					chain: data.chain || "mainnet",
					type: data.type || "safe",
					owners: data.owners || [],
				};

				if (data.type === "safe" || !data.type) {
					if (data.threshold) {
						treasuryData.threshold = data.threshold;
					}
					if (data.metadata) {
						treasuryData.metadata = data.metadata;
					}
				}

				try {
					const [newTreasury] = await db
						.insert(treasuries)
						.values(treasuryData)
						.returning();
					
					if (!newTreasury) {
						return c.json({ error: "Failed to create treasury" }, 500);
					}
					
					treasuryId = newTreasury.id;
				} catch (insertError: any) {
					console.error("Treasury creation error:", insertError);
					
					// Provide more specific error messages
					if (insertError.code === "23505") {
						return c.json({ error: "Treasury with this address already exists" }, 400);
					}
					
					return c.json({ 
						error: "Failed to create treasury", 
						details: insertError.message || "Database insertion failed"
					}, 500);
				}
			}
		}
		
		if (!treasuryId) {
			return c.json({ error: "Treasury ID or address/name required" }, 400);
		}
		
		const linkResult = await db
			.insert(projectTreasuries)
			.values({
				projectId,
				treasuryId,
				addedBy: userId,
				role: data.role || "primary",
				description: data.description,
			})
			.returning();
		
		if (!linkResult || linkResult.length === 0) {
			return c.json({ error: "Failed to link treasury to project" }, 500);
		}
		
		const link = linkResult[0];
		if (!link) {
			return c.json({ error: "Failed to link treasury to project" }, 500);
		}
		
		const treasuryResult = await db
			.select()
			.from(treasuries)
			.where(eq(treasuries.id, treasuryId))
			.limit(1);
		
		const treasury = treasuryResult[0];
		
		if (!treasury) {
			return c.json({ error: "Treasury not found after linking" }, 500);
		}
		
		return c.json({
			projectId: link.projectId,
			treasuryId: link.treasuryId,
			addedBy: link.addedBy,
			role: link.role,
			description: link.description,
			createdAt: link.createdAt?.toISOString() || null,
			treasury: {
				...treasury,
				owners: treasury.owners || []
			},
		}, 201);
	} catch (error: any) {
		console.error("Error adding treasury to project:", error);
		if (error.code === "23505") {
			return c.json({ error: "Treasury already linked to this project" }, 400);
		}
		return c.json({ error: "Failed to add treasury to project" }, 500);
	}
});

const removeProjectTreasury = createRoute({
	method: "delete",
	path: "/projects/{projectId}/{treasuryId}",
	description: "Remove a treasury from a project (project owner only)",
	summary: "Remove project treasury",
	request: {
		params: z.object({
			projectId: z.string().uuid().describe("Project ID"),
			treasuryId: z.string().uuid().describe("Treasury ID"),
		}),
	},
	responses: {
		204: {
			description: "Treasury removed from project",
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
		404: {
			description: "Link not found",
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
	tags: ["Treasuries"],
});

app.openapi(removeProjectTreasury, async (c) => {
	const userId = c.get("userId");
	
	if (!userId) {
		return c.json({ error: "Authentication required" }, 401);
	}
	
	const { projectId, treasuryId } = c.req.valid("param");
	
	try {
		// Check if user owns the project
		const [project] = await db
			.select()
			.from(projects)
			.where(and(
				eq(projects.id, projectId),
				eq(projects.userId, userId)
			))
			.limit(1);
		
		if (!project) {
			return c.json({ error: "Project not found or unauthorized" }, 401);
		}
		
		await db
			.delete(projectTreasuries)
			.where(and(
				eq(projectTreasuries.projectId, projectId),
				eq(projectTreasuries.treasuryId, treasuryId)
			));
		
		return c.body(null, 204);
	} catch (error) {
		console.error("Error removing treasury from project:", error);
		return c.json({ error: "Failed to remove treasury from project" }, 500);
	}
});

export default app;