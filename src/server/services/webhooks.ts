import { eq, and, sql } from "drizzle-orm";
import { db, webhookSubscriptions, webhookDeliveries } from "../../client";
import type { 
	WebhookEventType, 
	WebhookEventPayload,
	DBWebhookSubscription,
	NewWebhookDelivery 
} from "../../shared/schemas";

export interface WebhookEvent {
	eventType: WebhookEventType;
	eventId: string;
	data: any;
	timestamp?: Date;
}

export class WebhookService {
	private static instance: WebhookService;
	private readonly maxRetries = 5;
	private readonly baseRetryDelay = 1000; // 1 second

	static getInstance(): WebhookService {
		if (!WebhookService.instance) {
			WebhookService.instance = new WebhookService();
		}
		return WebhookService.instance;
	}

	/**
	 * Trigger webhooks for a specific event
	 */
	async triggerWebhooks(event: WebhookEvent): Promise<void> {
		const { eventType, eventId, data, timestamp = new Date() } = event;

		// Find all active subscriptions for this event type
		const subscriptions = await db
			.select()
			.from(webhookSubscriptions)
			.where(
				and(
					eq(webhookSubscriptions.isActive, true),
					sql`${eventType} = ANY(${webhookSubscriptions.events})`
				)
			);

		if (subscriptions.length === 0) {
			console.log(`No webhook subscriptions found for event type: ${eventType}`);
			return;
		}

		console.log(`Found ${subscriptions.length} webhook subscriptions for event: ${eventType}`);

		const payload: WebhookEventPayload = {
			eventType,
			eventId,
			timestamp: timestamp.toISOString(),
			data,
			metadata: {
				source: "api",
				version: "1.0",
			},
		};

		const deliveries = subscriptions.map(subscription => 
			this.deliverWebhook(subscription, payload, eventId)
		);

		await Promise.allSettled(deliveries);
	}

	/**
	 * Deliver a webhook to a specific subscription
	 */
	private async deliverWebhook(
		subscription: DBWebhookSubscription,
		payload: WebhookEventPayload,
		eventId: string
	): Promise<void> {
		const metadata = subscription.metadata || {};
		const timeout = metadata.timeout || 10000;
		const maxAttempts = metadata.retryAttempts || 3;

		const [delivery] = await db
			.insert(webhookDeliveries)
			.values({
				webhookId: subscription.id,
				eventType: payload.eventType,
				eventId,
				payload,
				url: subscription.url,
				attempts: 1,
			})
			.returning();

		let success = false;
		let attempt = 1;

		while (attempt <= maxAttempts && !success) {
			try {
				console.log(`Delivering webhook ${subscription.name} (attempt ${attempt}/${maxAttempts})`);
				
				const response = await this.makeWebhookRequest(
					subscription.url,
					payload,
					subscription.secret || undefined,
					timeout
				);

				if (response.success) {
					await db
						.update(webhookDeliveries)
						.set({
							statusCode: response.statusCode,
							responseBody: response.responseBody?.substring(0, 1000), // Truncate response
							deliveredAt: new Date(),
							attempts: attempt,
						})
						.where(eq(webhookDeliveries.id, delivery!.id));

					console.log(`Webhook ${subscription.name} delivered successfully`);
					success = true;
				} else {
					throw new Error(`HTTP ${response.statusCode}: ${response.error}`);
				}
			} catch (error) {
				console.warn(`Webhook ${subscription.name} delivery failed (attempt ${attempt}): ${error}`);
				
				if (attempt === maxAttempts) {
					await db
						.update(webhookDeliveries)
						.set({
							statusCode: error instanceof Error && 'statusCode' in error ? (error as any).statusCode : null,
							failedAt: new Date(),
							attempts: attempt,
							error: error instanceof Error ? error.message : String(error),
						})
						.where(eq(webhookDeliveries.id, delivery!.id));
				} else {
					const retryDelay = metadata.retryDelay || this.calculateRetryDelay(attempt);
					const nextRetryAt = new Date(Date.now() + retryDelay);

					await db
						.update(webhookDeliveries)
						.set({
							attempts: attempt,
							nextRetryAt,
							error: error instanceof Error ? error.message : String(error),
						})
						.where(eq(webhookDeliveries.id, delivery!.id));

					await new Promise(resolve => setTimeout(resolve, retryDelay));
				}

				attempt++;
			}
		}
	}

	/**
	 * Make HTTP request to webhook URL
	 */
	private async makeWebhookRequest(
		url: string,
		payload: WebhookEventPayload,
		secret?: string,
		timeout: number = 10000
	): Promise<{
		success: boolean;
		statusCode?: number;
		responseBody?: string;
		error?: string;
	}> {
		try {
			const headers: Record<string, string> = {
				"Content-Type": "application/json",
				"User-Agent": "Cartel-Webhook/1.0",
			};

			if (secret) {
				headers["Authorization"] = `Bearer ${secret}`;
			}

			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), timeout);

			const response = await fetch(url, {
				method: "POST",
				headers,
				body: JSON.stringify(payload),
				signal: controller.signal,
			});

			clearTimeout(timeoutId);

			const responseBody = await response.text();

			return {
				success: response.ok,
				statusCode: response.status,
				responseBody,
				error: response.ok ? undefined : `HTTP ${response.status}`,
			};
		} catch (error) {
			if (error instanceof Error && error.name === 'AbortError') {
				return {
					success: false,
					error: 'Request timeout',
				};
			}

			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}

	/**
	 * Calculate exponential backoff retry delay
	 */
	private calculateRetryDelay(attempt: number): number {
		return Math.min(this.baseRetryDelay * Math.pow(2, attempt - 1), 30000); // Max 30 seconds
	}

	/**
	 * Test a webhook subscription with sample data
	 */
	async testWebhook(
		subscription: DBWebhookSubscription,
		eventType: WebhookEventType = "application_created",
		testData?: any
	): Promise<{ success: boolean; error?: string; statusCode?: number }> {
		const payload: WebhookEventPayload = {
			eventType,
			eventId: `test-${Date.now()}`,
			timestamp: new Date().toISOString(),
			data: testData || this.getTestData(eventType),
			metadata: {
				source: "api",
				version: "1.0",
			},
		};

		const result = await this.makeWebhookRequest(
			subscription.url,
			payload,
			subscription.secret || undefined,
			subscription.metadata?.timeout || 10000
		);

		return {
			success: result.success,
			error: result.error,
			statusCode: result.statusCode,
		};
	}

	/**
	 * Get sample test data for different event types
	 */
	private getTestData(eventType: WebhookEventType): any {
		switch (eventType) {
			case "application_created":
				return {
					applicationId: "test-app-id",
					applicationNumber: 999,
					walletAddress: "0x1234567890123456789012345678901234567890",
					ensName: "test.eth",
					excitement: "This is a test application for webhook testing",
					motivation: "Testing webhook functionality",
				};
			case "user_registered":
				return {
					userId: "test-user-id",
					address: "0x1234567890123456789012345678901234567890",
					ensName: "test.eth",
					role: "authenticated",
				};
			case "project_created":
				return {
					projectId: "test-project-id",
					title: "Test Project",
					description: "A test project for webhook testing",
					tags: ["test", "webhook"],
				};
			default:
				return { message: `Test event for ${eventType}` };
		}
	}

	/**
	 * Retry failed webhook deliveries
	 */
	async retryFailedDeliveries(): Promise<void> {
		const failedDeliveries = await db
			.select({
				delivery: webhookDeliveries,
				subscription: webhookSubscriptions,
			})
			.from(webhookDeliveries)
			.innerJoin(
				webhookSubscriptions,
				eq(webhookDeliveries.webhookId, webhookSubscriptions.id)
			)
			.where(
				and(
					sql`${webhookDeliveries.nextRetryAt} <= NOW()`,
					sql`${webhookDeliveries.attempts} < 5`,
					eq(webhookSubscriptions.isActive, true)
				)
			);

		console.log(`Retrying ${failedDeliveries.length} failed webhook deliveries`);

		for (const { delivery, subscription } of failedDeliveries) {
			await this.deliverWebhook(
				subscription,
				delivery.payload as WebhookEventPayload,
				delivery.eventId
			);
		}
	}
}

// Export singleton instance
export const webhookService = WebhookService.getInstance();