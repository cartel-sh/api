// @ts-nocheck
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { eq, and, desc, sql } from "drizzle-orm";
import { db, webhookSubscriptions, webhookDeliveries } from "../../client";
import { requestLogging } from "../middleware/logging";
import { webhookService } from "../services/webhooks";
import {
	CreateWebhookSubscriptionSchema,
	UpdateWebhookSubscriptionSchema,
	WebhookSubscriptionSchema,
	WebhookDeliverySchema,
	WebhookQuerySchema,
	WebhookDeliveryQuerySchema,
	TestWebhookSchema,
	ErrorResponseSchema,
	SuccessResponseSchema,
	WebhookEventTypes,
} from "../../shared/schemas";

type Variables = {
	userId?: string;
	userRole?: string;
	apiKeyId?: string;
	logger?: any;
};

const app = new OpenAPIHono<{ Variables: Variables }>();

app.use("*", requestLogging());

// Create webhook subscription
const createWebhookRoute = createRoute({
	method: "post",
	path: "/",
	summary: "Create Webhook Subscription",
	description: "Create a new webhook subscription to receive events",
	security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
	request: {
		body: {
			content: {
				"application/json": {
					schema: CreateWebhookSubscriptionSchema,
				},
			},
		},
	},
	responses: {
		201: {
			description: "Webhook subscription created",
			content: {
				"application/json": {
					schema: WebhookSubscriptionSchema,
				},
			},
		},
		400: {
			description: "Bad request",
			content: {
				"application/json": {
					schema: ErrorResponseSchema,
				},
			},
		},
		401: {
			description: "Unauthorized",
			content: {
				"application/json": {
					schema: ErrorResponseSchema,
				},
			},
		},
	},
	tags: ["Webhooks"],
});

app.openapi(createWebhookRoute, async (c) => {
	const logger = c.get("logger");
	const userId = c.get("userId");
	const apiKeyId = c.get("apiKeyId");
	const data = c.req.valid("json") as any;

	if (!userId && !apiKeyId) {
		return c.json({ error: "Authentication required" }, 401);
	}

	logger.info("Creating webhook subscription", {
		userId,
		apiKeyId,
		name: data.name,
		events: data.events,
		url: data.url?.replace(/^https?:\/\/[^/]+/, '[REDACTED]'), // Mask domain for privacy
	});

	try {
		const insertData = { ...data };
		if (userId) {
			insertData.createdBy = userId;
		}

		const [webhook] = await db
			.insert(webhookSubscriptions)
			.values(insertData)
			.returning();

		if (!webhook) {
			logger.error("Failed to create webhook subscription");
			return c.json({ error: "Failed to create webhook subscription" }, 500);
		}

		logger.info("Webhook subscription created", {
			webhookId: webhook.id,
			name: webhook.name,
		});

		return c.json({
			...webhook,
			createdAt: webhook.createdAt?.toISOString(),
			updatedAt: webhook.updatedAt?.toISOString(),
		}, 201);
	} catch (error) {
		logger.error("Webhook subscription creation failed", error);
		return c.json({ error: "Failed to create webhook subscription" }, 500);
	}
});

// List webhook subscriptions
const listWebhooksRoute = createRoute({
	method: "get",
	path: "/",
	summary: "List Webhook Subscriptions",
	description: "List all webhook subscriptions for the authenticated user",
	security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
	request: {
		query: WebhookQuerySchema,
	},
	responses: {
		200: {
			description: "List of webhook subscriptions",
			content: {
				"application/json": {
					schema: z.array(WebhookSubscriptionSchema),
				},
			},
		},
		401: {
			description: "Unauthorized",
			content: {
				"application/json": {
					schema: ErrorResponseSchema,
				},
			},
		},
	},
	tags: ["Webhooks"],
});

app.openapi(listWebhooksRoute, async (c) => {
	const logger = c.get("logger");
	const userId = c.get("userId");
	const apiKeyId = c.get("apiKeyId");
	const query = c.req.valid("query") as any;
	const { events, active, limit, offset } = query;

	if (!userId && !apiKeyId) {
		return c.json({ error: "Authentication required" }, 401);
	}

	logger.info("Listing webhook subscriptions", { userId, apiKeyId, active, limit, offset });

	try {
		const conditions = [];
		if (userId) {
			conditions.push(eq(webhookSubscriptions.createdBy, userId));
		}

		if (active === "true") {
			conditions.push(eq(webhookSubscriptions.isActive, true));
		} else if (active === "false") {
			conditions.push(eq(webhookSubscriptions.isActive, false));
		}

		if (events) {
			const eventTypes = events.split(",");
			conditions.push(sql`${webhookSubscriptions.events} && ${eventTypes}`);
		}

		const webhooks = await db
			.select()
			.from(webhookSubscriptions)
			.where(and(...conditions))
			.orderBy(desc(webhookSubscriptions.createdAt))
			.limit(limit)
			.offset(offset);

		const formattedWebhooks = webhooks.map(webhook => ({
			...webhook,
			createdAt: webhook.createdAt?.toISOString(),
			updatedAt: webhook.updatedAt?.toISOString(),
		}));

		logger.info("Webhook subscriptions retrieved", { count: webhooks.length });
		return c.json(formattedWebhooks, 200);
	} catch (error) {
		logger.error("Failed to list webhook subscriptions", error);
		return c.json({ error: "Failed to list webhook subscriptions" }, 500);
	}
});

// Get specific webhook subscription
const getWebhookRoute = createRoute({
	method: "get",
	path: "/{id}",
	summary: "Get Webhook Subscription",
	description: "Get a specific webhook subscription by ID",
	security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
	request: {
		params: z.object({
			id: z.string().uuid(),
		}),
	},
	responses: {
		200: {
			description: "Webhook subscription details",
			content: {
				"application/json": {
					schema: WebhookSubscriptionSchema,
				},
			},
		},
		404: {
			description: "Webhook not found",
			content: {
				"application/json": {
					schema: ErrorResponseSchema,
				},
			},
		},
		401: {
			description: "Unauthorized",
			content: {
				"application/json": {
					schema: ErrorResponseSchema,
				},
			},
		},
	},
	tags: ["Webhooks"],
});

app.openapi(getWebhookRoute, async (c) => {
	const logger = c.get("logger");
	const userId = c.get("userId");
	const apiKeyId = c.get("apiKeyId");
	const { id } = c.req.valid("param") as any;

	if (!userId && !apiKeyId) {
		return c.json({ error: "Authentication required" }, 401);
	}

	try {
		const conditions = [eq(webhookSubscriptions.id, id)];
		if (userId) {
			conditions.push(eq(webhookSubscriptions.createdBy, userId));
		}

		const [webhook] = await db
			.select()
			.from(webhookSubscriptions)
			.where(and(...conditions));

		if (!webhook) {
			return c.json({ error: "Webhook subscription not found" }, 404);
		}

		return c.json({
			...webhook,
			createdAt: webhook.createdAt?.toISOString(),
			updatedAt: webhook.updatedAt?.toISOString(),
		}, 200);
	} catch (error) {
		logger.error("Failed to get webhook subscription", error);
		return c.json({ error: "Failed to get webhook subscription" }, 500);
	}
});

// Update webhook subscription
const updateWebhookRoute = createRoute({
	method: "put",
	path: "/{id}",
	summary: "Update Webhook Subscription",
	description: "Update an existing webhook subscription",
	security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
	request: {
		params: z.object({
			id: z.string().uuid(),
		}),
		body: {
			content: {
				"application/json": {
					schema: UpdateWebhookSubscriptionSchema,
				},
			},
		},
	},
	responses: {
		200: {
			description: "Webhook subscription updated",
			content: {
				"application/json": {
					schema: WebhookSubscriptionSchema,
				},
			},
		},
		404: {
			description: "Webhook not found",
			content: {
				"application/json": {
					schema: ErrorResponseSchema,
				},
			},
		},
		401: {
			description: "Unauthorized",
			content: {
				"application/json": {
					schema: ErrorResponseSchema,
				},
			},
		},
	},
	tags: ["Webhooks"],
});

app.openapi(updateWebhookRoute, async (c) => {
	const logger = c.get("logger");
	const userId = c.get("userId");
	const apiKeyId = c.get("apiKeyId");
	const { id } = c.req.valid("param") as any;
	const data = c.req.valid("json") as any;

	if (!userId && !apiKeyId) {
		return c.json({ error: "Authentication required" }, 401);
	}

	logger.info("Updating webhook subscription", { webhookId: id, userId, apiKeyId });

	try {
		const conditions = [eq(webhookSubscriptions.id, id)];
		if (userId) {
			conditions.push(eq(webhookSubscriptions.createdBy, userId));
		}

		const [webhook] = await db
			.update(webhookSubscriptions)
			.set({
				...data,
				updatedAt: new Date(),
			})
			.where(and(...conditions))
			.returning();

		if (!webhook) {
			return c.json({ error: "Webhook subscription not found" }, 404);
		}

		logger.info("Webhook subscription updated", { webhookId: id });

		return c.json({
			...webhook,
			createdAt: webhook.createdAt?.toISOString(),
			updatedAt: webhook.updatedAt?.toISOString(),
		}, 200);
	} catch (error) {
		logger.error("Failed to update webhook subscription", error);
		return c.json({ error: "Failed to update webhook subscription" }, 500);
	}
});

// Delete webhook subscription
const deleteWebhookRoute = createRoute({
	method: "delete",
	path: "/{id}",
	summary: "Delete Webhook Subscription",
	description: "Delete a webhook subscription",
	security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
	request: {
		params: z.object({
			id: z.string().uuid(),
		}),
	},
	responses: {
		200: {
			description: "Webhook subscription deleted",
			content: {
				"application/json": {
					schema: SuccessResponseSchema,
				},
			},
		},
		404: {
			description: "Webhook not found",
			content: {
				"application/json": {
					schema: ErrorResponseSchema,
				},
			},
		},
		401: {
			description: "Unauthorized",
			content: {
				"application/json": {
					schema: ErrorResponseSchema,
				},
			},
		},
	},
	tags: ["Webhooks"],
});

app.openapi(deleteWebhookRoute, async (c) => {
	const logger = c.get("logger");
	const userId = c.get("userId");
	const apiKeyId = c.get("apiKeyId");
	const { id } = c.req.valid("param") as any;

	if (!userId && !apiKeyId) {
		return c.json({ error: "Authentication required" }, 401);
	}

	logger.info("Deleting webhook subscription", { webhookId: id, userId, apiKeyId });

	try {
		const conditions = [eq(webhookSubscriptions.id, id)];
		if (userId) {
			conditions.push(eq(webhookSubscriptions.createdBy, userId));
		}

		const webhook = await db
			.select()
			.from(webhookSubscriptions)
			.where(and(...conditions))
			.limit(1);

		if (webhook.length === 0) {
			return c.json({ error: "Webhook subscription not found" }, 404);
		}

		await db
			.delete(webhookSubscriptions)
			.where(
				and(
					eq(webhookSubscriptions.id, id),
					eq(webhookSubscriptions.createdBy, createdBy)
				)
			);

		logger.info("Webhook subscription deleted", { webhookId: id });
		return c.json({ success: true }, 200);
	} catch (error) {
		logger.error("Failed to delete webhook subscription", error);
		return c.json({ error: "Failed to delete webhook subscription" }, 500);
	}
});

// Test webhook
const testWebhookRoute = createRoute({
	method: "post",
	path: "/{id}/test",
	summary: "Test Webhook Subscription",
	description: "Send a test event to a webhook subscription",
	security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
	request: {
		params: z.object({
			id: z.string().uuid(),
		}),
		body: {
			content: {
				"application/json": {
					schema: TestWebhookSchema,
				},
			},
		},
	},
	responses: {
		200: {
			description: "Test webhook sent",
			content: {
				"application/json": {
					schema: z.object({
						success: z.boolean(),
						statusCode: z.number().optional(),
						error: z.string().optional(),
					}),
				},
			},
		},
		404: {
			description: "Webhook not found",
			content: {
				"application/json": {
					schema: ErrorResponseSchema,
				},
			},
		},
		401: {
			description: "Unauthorized",
			content: {
				"application/json": {
					schema: ErrorResponseSchema,
				},
			},
		},
	},
	tags: ["Webhooks"],
});

app.openapi(testWebhookRoute, async (c) => {
	const logger = c.get("logger");
	const userId = c.get("userId");
	const apiKeyId = c.get("apiKeyId");
	const { id } = c.req.valid("param") as any;
	const { eventType, testData } = c.req.valid("json") as any;

	if (!userId && !apiKeyId) {
		return c.json({ error: "Authentication required" }, 401);
	}

	logger.info("Testing webhook subscription", { webhookId: id, eventType, userId, apiKeyId });

	try {
		const conditions = [eq(webhookSubscriptions.id, id)];
		if (userId) {
			conditions.push(eq(webhookSubscriptions.createdBy, userId));
		}

		const [webhook] = await db
			.select()
			.from(webhookSubscriptions)
			.where(and(...conditions));

		if (!webhook) {
			return c.json({ error: "Webhook subscription not found" }, 404);
		}

		const result = await webhookService.testWebhook(webhook, eventType, testData);

		logger.info("Webhook test completed", {
			webhookId: id,
			success: result.success,
			statusCode: result.statusCode,
		});

		return c.json(result, 200);
	} catch (error) {
		logger.error("Failed to test webhook", error);
		return c.json({ error: "Failed to test webhook" }, 500);
	}
});

// List webhook deliveries
const listDeliveriesRoute = createRoute({
	method: "get",
	path: "/{id}/deliveries",
	summary: "List Webhook Deliveries",
	description: "List delivery attempts for a webhook subscription",
	security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
	request: {
		params: z.object({
			id: z.string().uuid(),
		}),
		query: WebhookDeliveryQuerySchema,
	},
	responses: {
		200: {
			description: "List of webhook deliveries",
			content: {
				"application/json": {
					schema: z.array(WebhookDeliverySchema),
				},
			},
		},
		404: {
			description: "Webhook not found",
			content: {
				"application/json": {
					schema: ErrorResponseSchema,
				},
			},
		},
		401: {
			description: "Unauthorized",
			content: {
				"application/json": {
					schema: ErrorResponseSchema,
				},
			},
		},
	},
	tags: ["Webhooks"],
});

app.openapi(listDeliveriesRoute, async (c) => {
	const logger = c.get("logger");
	const userId = c.get("userId");
	const apiKeyId = c.get("apiKeyId");
	const { id } = c.req.valid("param") as any;
	const { eventType, status, limit, offset } = c.req.valid("query") as any;

	if (!userId && !apiKeyId) {
		return c.json({ error: "Authentication required" }, 401);
	}

	try {
		const conditions = [eq(webhookSubscriptions.id, id)];
		if (userId) {
			conditions.push(eq(webhookSubscriptions.createdBy, userId));
		}

		const [webhook] = await db
			.select()
			.from(webhookSubscriptions)
			.where(and(...conditions));

		if (!webhook) {
			return c.json({ error: "Webhook subscription not found" }, 404);
		}

		const deliveryConditions = [eq(webhookDeliveries.webhookId, id)];

		if (eventType) {
			deliveryConditions.push(eq(webhookDeliveries.eventType, eventType));
		}

		if (status) {
			switch (status) {
				case "success":
					deliveryConditions.push(sql`${webhookDeliveries.deliveredAt} IS NOT NULL`);
					break;
				case "failed":
					deliveryConditions.push(sql`${webhookDeliveries.failedAt} IS NOT NULL`);
					break;
				case "pending":
					deliveryConditions.push(sql`${webhookDeliveries.nextRetryAt} IS NOT NULL`);
					break;
			}
		}

		const deliveries = await db
			.select()
			.from(webhookDeliveries)
			.where(and(...deliveryConditions))
			.orderBy(desc(webhookDeliveries.createdAt))
			.limit(limit)
			.offset(offset);

		const formattedDeliveries = deliveries.map(delivery => ({
			...delivery,
			deliveredAt: delivery.deliveredAt?.toISOString() || null,
			failedAt: delivery.failedAt?.toISOString() || null,
			nextRetryAt: delivery.nextRetryAt?.toISOString() || null,
			createdAt: delivery.createdAt?.toISOString(),
		}));

		logger.info("Webhook deliveries retrieved", {
			webhookId: id,
			count: deliveries.length,
		});

		return c.json(formattedDeliveries, 200);
	} catch (error) {
		logger.error("Failed to list webhook deliveries", error);
		return c.json({ error: "Failed to list webhook deliveries" }, 500);
	}
});

// List available event types
const listEventTypesRoute = createRoute({
	method: "get",
	path: "/events",
	summary: "List Event Types",
	description: "List all available webhook event types",
	responses: {
		200: {
			description: "List of available event types",
			content: {
				"application/json": {
					schema: z.object({
						eventTypes: z.array(WebhookEventTypes),
					}),
				},
			},
		},
	},
	tags: ["Webhooks"],
});

app.openapi(listEventTypesRoute, async (c) => {
	return c.json({
		eventTypes: WebhookEventTypes.options,
	}, 200);
});

export default app;