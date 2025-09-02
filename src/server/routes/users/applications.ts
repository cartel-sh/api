import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { desc, eq, sql } from "drizzle-orm";
import { db, applications, applicationVotes } from "../../../client";
import { requestLogging } from "../../middleware/logging";
import {
	CreateApplicationSchema,
	ApplicationSchema,
	ApplicationVoteSchema,
	ErrorResponseSchema,
} from "../../../shared/schemas";

type Variables = {
	userId?: string;
	logger?: any;
};

const app = new OpenAPIHono<{ Variables: Variables }>();

app.use("*", requestLogging());
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
	const logger = c.get("logger");
	const data = c.req.valid("json");

	logger.info("Creating new application", {
		hasWalletAddress: !!data.walletAddress,
		hasGithub: !!data.github,
		hasFarcaster: !!data.farcaster,
		hasTwitter: !!data.twitter,
		excitementLength: data.excitement?.length || 0,
		motivationLength: data.motivation?.length || 0,
	});

	try {
		logger.logDatabase("query", "applications", {
			action: "get_max_application_number",
		});
		const result = await db
			.select({
				max: sql<number>`COALESCE(MAX(${applications.applicationNumber}), 0)`,
			})
			.from(applications);

		const nextNumber = (result[0]?.max || 0) + 1;
		logger.debug("Assigning application number", {
			currentMax: result[0]?.max || 0,
			nextNumber,
		});

		logger.logDatabase("insert", "applications", {
			applicationNumber: nextNumber,
			walletAddress: data.walletAddress ? "***masked***" : undefined,
		});
		const [application] = await db
			.insert(applications)
			.values({
				...data,
				applicationNumber: nextNumber,
			})
			.returning();

		if (!application) {
			logger.error("Failed to create application: no application returned");
			return c.json({ error: "Failed to create application" }, 500);
		}

		logger.info("Application created successfully", {
			applicationId: application.id,
			applicationNumber: nextNumber,
			walletAddress: data.walletAddress ? "***masked***" : undefined,
		});

		return c.json({
			id: application.id,
			applicationNumber: nextNumber,
		}, 200);
	} catch (error) {
		logger.error("Application creation failed", error);
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
	const logger = c.get("logger");

	logger.info("Getting pending applications");

	try {
		logger.logDatabase("query", "applications", {
			action: "get_pending",
			status: "pending",
			orderBy: "submittedAt DESC",
		});
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

		logger.info("Pending applications retrieved successfully", {
			count: result.length,
			oldestSubmission: result[result.length - 1]?.submittedAt?.toISOString(),
			newestSubmission: result[0]?.submittedAt?.toISOString(),
		});

		return c.json(formattedResult, 200);
	} catch (error) {
		logger.error("Pending applications retrieval failed", error);
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
	const logger = c.get("logger");
	const { messageId } = c.req.valid("param");

	logger.info("Getting application by message ID", { messageId });

	try {
		logger.logDatabase("query", "applications", {
			action: "get_by_message_id",
			messageId,
		});
		const result = await db
			.select()
			.from(applications)
			.where(eq(applications.messageId, messageId));

		if (!result[0]) {
			logger.warn("Application not found by message ID", { messageId });
			return c.json({ error: "Application not found" }, 404);
		}

		const application = result[0];
		logger.info("Application retrieved successfully by message ID", {
			applicationId: application.id,
			applicationNumber: application.applicationNumber,
			status: application.status,
			submittedAt: application.submittedAt?.toISOString(),
		});

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
		logger.error("Application retrieval by message ID failed", error);
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
	const logger = c.get("logger");
	const { number: numberStr } = c.req.valid("param");
	const number = parseInt(numberStr);

	logger.info("Getting application by number", { applicationNumber: number });

	try {
		logger.logDatabase("query", "applications", {
			action: "get_by_application_number",
			applicationNumber: number,
		});
		const result = await db
			.select()
			.from(applications)
			.where(eq(applications.applicationNumber, number));

		if (!result[0]) {
			logger.warn("Application not found by number", { applicationNumber: number });
			return c.json({ error: "Application not found" }, 404);
		}

		const application = result[0];
		logger.info("Application retrieved successfully by number", {
			applicationId: application.id,
			applicationNumber: number,
			status: application.status,
			submittedAt: application.submittedAt?.toISOString(),
		});

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
		logger.error("Application retrieval by number failed", error);
		return c.json({ error: "Failed to get application" }, 500);
	}
});

const updateApplicationStatusRoute = createRoute({
	method: "patch",
	path: "/{id}/status",
	summary: "Update Application Status",
	description: "Updates the status of an application to approved or rejected (requires authentication).",
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
	const logger = c.get("logger");
	const id = c.req.valid("param").id;
	const { status } = c.req.valid("json");

	logger.info("Updating application status", {
		applicationId: id,
		newStatus: status,
	});

	try {
		const decidedAt = new Date();
		logger.logDatabase("update", "applications", {
			applicationId: id,
			status,
			decidedAt: decidedAt.toISOString(),
		});
		await db
			.update(applications)
			.set({
				status,
				decidedAt,
			})
			.where(eq(applications.id, id));

		logger.info("Application status updated successfully", {
			applicationId: id,
			status,
			decidedAt: decidedAt.toISOString(),
		});

		return c.json({ success: true }, 200);
	} catch (error) {
		logger.error("Application status update failed", error);
		return c.json({ error: "Failed to update application status" }, 500);
	}
});

const deleteApplicationRoute = createRoute({
	method: "delete",
	path: "/{id}",
	summary: "Delete Application",
	description: "Deletes an application by its ID (requires authentication).",
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
	const logger = c.get("logger");
	const { id } = c.req.valid("param");

	logger.info("Deleting application", { applicationId: id });

	try {
		logger.logDatabase("delete", "applications", {
			applicationId: id,
		});
		await db.delete(applications).where(eq(applications.id, id));

		logger.info("Application deleted successfully", { applicationId: id });

		return c.json({ success: true }, 200);
	} catch (error) {
		logger.error("Application deletion failed", error);
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
	const logger = c.get("logger");
	const applicationId = c.req.valid("param").id;
	const { userId, userName, voteType } = c.req.valid("json");

	logger.info("Adding vote to application", {
		applicationId,
		userId,
		userName,
		voteType,
	});

	try {
		logger.logDatabase("upsert", "applicationVotes", {
			applicationId,
			userId,
			voteType,
			action: "insert_or_update_vote",
		});
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

		logger.info("Vote added/updated successfully", {
			applicationId,
			userId,
			voteType,
		});

		return c.json({ success: true }, 200);
	} catch (error) {
		logger.error("Vote addition failed", error);
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
	const logger = c.get("logger");
	const { id: applicationId } = c.req.valid("param");

	logger.info("Getting votes for application", { applicationId });

	try {
		logger.logDatabase("query", "applicationVotes", {
			action: "get_votes_by_application",
			applicationId,
		});
		const votes = await db
			.select()
			.from(applicationVotes)
			.where(eq(applicationVotes.applicationId, applicationId));

		const approvals = votes.filter((v) => v.voteType === "approve");
		const rejections = votes.filter((v) => v.voteType === "reject");

		logger.info("Application votes retrieved successfully", {
			applicationId,
			totalVotes: votes.length,
			approvalCount: approvals.length,
			rejectionCount: rejections.length,
			approvalPercentage: votes.length > 0 ? Math.round((approvals.length / votes.length) * 100) : 0,
		});

		return c.json({
			approvals,
			rejections,
			approvalCount: approvals.length,
			rejectionCount: rejections.length,
		}, 200);
	} catch (error) {
		logger.error("Application votes retrieval failed", error);
		return c.json({ error: "Failed to get votes" }, 500);
	}
});

export default app;
