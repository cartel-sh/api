import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { db } from "../../client";
import { treasuries, projects, projectTreasuries, users } from "../../schema";
import { eq, and, desc, sql } from "drizzle-orm";
import type { Treasury, NewTreasury, ProjectTreasury, NewProjectTreasury } from "../../schema";

// Define the context variables that our auth middleware provides
type Variables = {
	userId?: string;
	userRole?: string;
};

const app = new OpenAPIHono<{ Variables: Variables }>();

const treasurySchema = z.object({
	id: z.string().uuid(),
	address: z.string(),
	name: z.string(),
	purpose: z.string().nullable(),
	chain: z.string(),
	type: z.string(),
	threshold: z.number().nullable(),
	owners: z.array(z.string()).nullable(),
	metadata: z.object({
		version: z.string().optional(),
		modules: z.array(z.string()).optional(),
		guard: z.string().optional(),
		fallbackHandler: z.string().optional(),
		nonce: z.number().optional(),
	}).nullable(),
	isActive: z.boolean(),
	createdAt: z.string().nullable(),
	updatedAt: z.string().nullable(),
});

const createTreasurySchema = z.object({
	address: z.string().describe("Ethereum address of the treasury"),
	name: z.string().describe("Name of the treasury"),
	purpose: z.string().optional().describe("Purpose or description of the treasury"),
	chain: z.string().default("mainnet").describe("Blockchain network"),
	type: z.string().default("safe").describe("Type of treasury (safe, multisig, eoa)"),
	threshold: z.number().optional().describe("Required signatures for Safe"),
	owners: z.array(z.string()).optional().describe("List of owner addresses"),
	metadata: z.object({
		version: z.string().optional(),
		modules: z.array(z.string()).optional(),
		guard: z.string().optional(),
		fallbackHandler: z.string().optional(),
		nonce: z.number().optional(),
	}).optional(),
});

const projectTreasurySchema = z.object({
	projectId: z.string().uuid(),
	treasuryId: z.string().uuid(),
	addedBy: z.string().uuid(),
	role: z.string(),
	description: z.string().nullable(),
	createdAt: z.string().nullable(),
	treasury: treasurySchema.optional(),
});

// List all treasuries
const listTreasuries = createRoute({
	method: "get",
	path: "/",
	description: "List all active treasuries with optional filtering by chain or type",
	summary: "List treasuries",
	request: {
		query: z.object({
			chain: z.string().optional().describe("Filter by blockchain network"),
			type: z.string().optional().describe("Filter by treasury type"),
			limit: z.coerce.number().optional().describe("Number of results to return"),
			offset: z.coerce.number().optional().describe("Number of results to skip"),
		}),
	},
	responses: {
		200: {
			description: "List of treasuries",
			content: {
				"application/json": {
					schema: z.array(treasurySchema),
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
		
		return c.json(results, 200);
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
					schema: treasurySchema.extend({
						projects: z.array(z.object({
							id: z.string().uuid(),
							title: z.string(),
							description: z.string(),
							role: z.string(),
							projectDescription: z.string().nullable(),
						})).optional(),
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
					schema: createTreasurySchema,
				},
			},
		},
	},
	responses: {
		201: {
			description: "Treasury created successfully",
			content: {
				"application/json": {
					schema: treasurySchema,
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
					schema: createTreasurySchema.partial(),
				},
			},
		},
	},
	responses: {
		200: {
			description: "Treasury updated successfully",
			content: {
				"application/json": {
					schema: treasurySchema,
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
		
		return c.json(updated, 200);
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
					schema: z.array(projectTreasurySchema),
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
		
		return c.json(results, 200);
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
					schema: z.object({
						treasuryId: z.string().uuid().optional().describe("Existing treasury ID"),
						address: z.string().optional().describe("Treasury address for new treasury"),
						name: z.string().optional().describe("Name for new treasury"),
						purpose: z.string().optional().describe("Purpose for new treasury"),
						chain: z.string().default("mainnet").optional(),
						type: z.string().default("safe").optional(),
						role: z.string().default("primary").describe("Role of treasury in project"),
						description: z.string().optional().describe("Project-specific description"),
					}),
				},
			},
		},
	},
	responses: {
		201: {
			description: "Treasury added to project",
			content: {
				"application/json": {
					schema: projectTreasurySchema,
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
				// Create new treasury
				const [newTreasury] = await db
					.insert(treasuries)
					.values({
						address: data.address,
						name: data.name,
						purpose: data.purpose,
						chain: data.chain || "mainnet",
						type: data.type || "safe",
						owners: [],
					})
					.returning();
				
				if (!newTreasury) {
					return c.json({ error: "Failed to create treasury" }, 500);
				}
				
				treasuryId = newTreasury.id;
			}
		}
		
		if (!treasuryId) {
			return c.json({ error: "Treasury ID or address/name required" }, 400);
		}
		
		// Add treasury to project
		const [link] = await db
			.insert(projectTreasuries)
			.values({
				projectId,
				treasuryId,
				addedBy: userId,
				role: data.role || "primary",
				description: data.description,
			})
			.returning();
		
		// Get the treasury details
		const [treasury] = await db
			.select()
			.from(treasuries)
			.where(eq(treasuries.id, treasuryId))
			.limit(1);
		
		return c.json({
			...link,
			treasury,
		}, 201);
	} catch (error: any) {
		console.error("Error adding treasury to project:", error);
		if (error.code === "23505") {
			return c.json({ error: "Treasury already linked to this project" }, 400);
		}
		return c.json({ error: "Failed to add treasury to project" }, 500);
	}
});

// Remove treasury from project
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
		
		// Remove the link
		const result = await db
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