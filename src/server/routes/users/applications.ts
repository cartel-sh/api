import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { desc, eq, sql } from "drizzle-orm";
import { db, applications, applicationVotes } from "../../../client";
import { requireJwtAuth } from "../../middleware/auth";
import {
	CreateApplicationSchema,
	ApplicationSchema,
	ApplicationVoteSchema,
	ErrorResponseSchema,
} from "../../../shared/schemas";

const app = new OpenAPIHono();
const createApplicationRoute = createRoute({
	method: "post",
	path: "/",
	summary: "Create Application",
	description: "Creates a new application with the provided details and assigns it a unique application number.",
	request: {
		body: {
			content: {
				"application/json": {
					schema: CreateApplicationSchema,
				},
			},
		},
	},
	responses: {
		200: {
			description: "Success",
			content: {
				"application/json": {
					schema: z.object({
						id: z.string(),
						applicationNumber: z.number(),
					}),
				},
			},
		},
		500: {
			description: "Internal server error",
			content: {
				"application/json": {
					schema: ErrorResponseSchema,
				},
			},
		},
	},
	tags: ["Applications"],
});

app.openapi(createApplicationRoute, async (c) => {
	const data = c.req.valid("json");

	try {
		const result = await db
			.select({
				max: sql<number>`COALESCE(MAX(${applications.applicationNumber}), 0)`,
			})
			.from(applications);

		const nextNumber = (result[0]?.max || 0) + 1;

		const [application] = await db
			.insert(applications)
			.values({
				...data,
				applicationNumber: nextNumber,
			})
			.returning();

		return c.json({
			id: application!.id,
			applicationNumber: nextNumber,
		}, 200);
	} catch (error) {
		console.error("[API] Error creating application:", error);
		return c.json({ error: "Failed to create application" }, 500);
	}
});

const getPendingApplicationsRoute = createRoute({
	method: "get",
	path: "/pending",
	summary: "Get Pending Applications",
	description: "Retrieves all applications with pending status ordered by submission date.",
	responses: {
		200: {
			description: "List of pending applications",
			content: {
				"application/json": {
					schema: z.array(ApplicationSchema),
				},
			},
		},
		500: {
			description: "Internal server error",
			content: {
				"application/json": {
					schema: ErrorResponseSchema,
				},
			},
		},
	},
	tags: ["Applications"],
});

app.openapi(getPendingApplicationsRoute, async (c) => {
	try {
		const result = await db
			.select()
			.from(applications)
			.where(eq(applications.status, "pending"))
			.orderBy(desc(applications.submittedAt));

		const formattedResult = result.map(app => ({
			...app,
			status: app.status || "pending",
			submittedAt: app.submittedAt?.toISOString(),
			decidedAt: app.decidedAt?.toISOString() || null,
		}));

		return c.json(formattedResult, 200);
	} catch (error) {
		console.error("[API] Error getting pending applications:", error);
		return c.json({ error: "Failed to get pending applications" }, 500);
	}
});

const getApplicationByMessageRoute = createRoute({
	method: "get",
	path: "/by-message/{messageId}",
	summary: "Get Application by Message",
	description: "Retrieves an application by its associated message ID.",
	request: {
		params: z.object({
			messageId: z.string(),
		}),
	},
	responses: {
		200: {
			description: "Application found",
			content: {
				"application/json": {
					schema: ApplicationSchema,
				},
			},
		},
		404: {
			description: "Application not found",
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
					schema: ErrorResponseSchema,
				},
			},
		},
	},
	tags: ["Applications"],
});

app.openapi(getApplicationByMessageRoute, async (c) => {
	const { messageId } = c.req.valid("param");

	try {
		const result = await db
			.select()
			.from(applications)
			.where(eq(applications.messageId, messageId));

		if (!result[0]) {
			return c.json({ error: "Application not found" }, 404);
		}

		const application = result[0];
		return c.json({
			id: application.id,
			messageId: application.messageId,
			walletAddress: application.walletAddress,
			ensName: application.ensName,
			github: application.github,
			farcaster: application.farcaster,
			lens: application.lens,
			twitter: application.twitter,
			excitement: application.excitement,
			motivation: application.motivation,
			signature: application.signature,
			applicationNumber: application.applicationNumber,
			status: application.status || "pending",
			submittedAt: application.submittedAt?.toISOString() || undefined,
			decidedAt: application.decidedAt?.toISOString() || null,
		}, 200);
	} catch (error) {
		console.error("[API] Error getting application by message ID:", error);
		return c.json({ error: "Failed to get application" }, 500);
	}
});

const getApplicationByNumberRoute = createRoute({
	method: "get",
	path: "/by-number/{number}",
	summary: "Get Application by Number",
	description: "Retrieves an application by its application number.",
	request: {
		params: z.object({
			number: z.string().regex(/^\d+$/, "Must be a number"),
		}),
	},
	responses: {
		200: {
			description: "Application found",
			content: {
				"application/json": {
					schema: ApplicationSchema,
				},
			},
		},
		400: {
			description: "Invalid application number",
			content: {
				"application/json": {
					schema: ErrorResponseSchema,
				},
			},
		},
		404: {
			description: "Application not found",
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
					schema: ErrorResponseSchema,
				},
			},
		},
	},
	tags: ["Applications"],
});

app.openapi(getApplicationByNumberRoute, async (c) => {
	const { number: numberStr } = c.req.valid("param");
	const number = parseInt(numberStr);

	try {
		const result = await db
			.select()
			.from(applications)
			.where(eq(applications.applicationNumber, number));

		if (!result[0]) {
			return c.json({ error: "Application not found" }, 404);
		}

		const application = result[0];
		return c.json({
			id: application.id,
			messageId: application.messageId,
			walletAddress: application.walletAddress,
			ensName: application.ensName,
			github: application.github,
			farcaster: application.farcaster,
			lens: application.lens,
			twitter: application.twitter,
			excitement: application.excitement,
			motivation: application.motivation,
			signature: application.signature,
			applicationNumber: application.applicationNumber,
			status: application.status || "pending",
			submittedAt: application.submittedAt?.toISOString() || undefined,
			decidedAt: application.decidedAt?.toISOString() || null,
		}, 200);
	} catch (error) {
		console.error("[API] Error getting application by number:", error);
		return c.json({ error: "Failed to get application" }, 500);
	}
});

const updateApplicationStatusRoute = createRoute({
	method: "patch",
	path: "/{id}/status",
	summary: "Update Application Status",
	description: "Updates the status of an application to approved or rejected (requires authentication).",
	middleware: [requireJwtAuth],
	request: {
		params: z.object({
			id: z.string(),
		}),
		body: {
			content: {
				"application/json": {
					schema: z.object({
						status: z.enum(["approved", "rejected"]),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			description: "Success",
			content: {
				"application/json": {
					schema: z.object({
						success: z.boolean(),
					}),
				},
			},
		},
		500: {
			description: "Internal server error",
			content: {
				"application/json": {
					schema: ErrorResponseSchema,
				},
			},
		},
	},
	tags: ["Applications"],
});

app.openapi(updateApplicationStatusRoute, async (c) => {
	const id = c.req.valid("param").id;
	const { status } = c.req.valid("json");

	try {
		await db
			.update(applications)
			.set({
				status,
				decidedAt: new Date(),
			})
			.where(eq(applications.id, id));

		return c.json({ success: true }, 200);
	} catch (error) {
		console.error("[API] Error updating application status:", error);
		return c.json({ error: "Failed to update application status" }, 500);
	}
});

const deleteApplicationRoute = createRoute({
	method: "delete",
	path: "/{id}",
	summary: "Delete Application",
	description: "Deletes an application by its ID (requires authentication).",
	middleware: [requireJwtAuth],
	request: {
		params: z.object({
			id: z.string(),
		}),
	},
	responses: {
		200: {
			description: "Application deleted successfully",
			content: {
				"application/json": {
					schema: z.object({
						success: z.boolean(),
					}),
				},
			},
		},
		500: {
			description: "Internal server error",
			content: {
				"application/json": {
					schema: ErrorResponseSchema,
				},
			},
		},
	},
	tags: ["Applications"],
});

app.openapi(deleteApplicationRoute, async (c) => {
	const { id } = c.req.valid("param");

	try {
		await db.delete(applications).where(eq(applications.id, id));

		return c.json({ success: true }, 200);
	} catch (error) {
		console.error("[API] Error deleting application:", error);
		return c.json({ error: "Failed to delete application" }, 500);
	}
});

// POST /api/applications/:id/votes
const addVoteRoute = createRoute({
	method: "post",
	path: "/{id}/votes",
	summary: "Add Application Vote",
	description: "Adds or updates a vote (approve/reject) for an application by a specific user.",
	request: {
		params: z.object({
			id: z.string(),
		}),
		body: {
			content: {
				"application/json": {
					schema: z.object({
						userId: z.string(),
						userName: z.string(),
						voteType: z.enum(["approve", "reject"]),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			description: "Success",
			content: {
				"application/json": {
					schema: z.object({
						success: z.boolean(),
					}),
				},
			},
		},
		500: {
			description: "Internal server error",
			content: {
				"application/json": {
					schema: ErrorResponseSchema,
				},
			},
		},
	},
	tags: ["Applications"],
});

app.openapi(addVoteRoute, async (c) => {
	const applicationId = c.req.valid("param").id;
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

		return c.json({ success: true }, 200);
	} catch (error) {
		console.error("[API] Error adding vote:", error);
		return c.json({ error: "Failed to add vote" }, 500);
	}
});
const getApplicationVotesRoute = createRoute({
	method: "get",
	path: "/{id}/votes",
	summary: "Get Application Votes",
	description: "Retrieves all votes for an application with counts for approvals and rejections.",
	request: {
		params: z.object({
			id: z.string(),
		}),
	},
	responses: {
		200: {
			description: "Application votes with counts",
			content: {
				"application/json": {
					schema: z.object({
						approvals: z.array(z.any()),
						rejections: z.array(z.any()),
						approvalCount: z.number(),
						rejectionCount: z.number(),
					}),
				},
			},
		},
		500: {
			description: "Internal server error",
			content: {
				"application/json": {
					schema: ErrorResponseSchema,
				},
			},
		},
	},
	tags: ["Applications"],
});

app.openapi(getApplicationVotesRoute, async (c) => {
	const { id: applicationId } = c.req.valid("param");

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
		}, 200);
	} catch (error) {
		console.error("[API] Error getting votes:", error);
		return c.json({ error: "Failed to get votes" }, 500);
	}
});

export default app;
