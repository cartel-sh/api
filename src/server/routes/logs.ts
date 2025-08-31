import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { db, logs } from "../../client";
import type { UserRole } from "../../schema";
import { eq, and, desc, asc, gte, lte, like, sql } from "drizzle-orm";
import { requireRole, withJwtAuth } from "../middleware/auth";
import { requestLogging } from "../middleware/logging";
import {
	LogQuerySchema,
	LogEntrySchema,
	LogsListResponseSchema,
	LogStatsResponseSchema,
	LogCleanupResponseSchema,
	ErrorResponseSchema,
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
app.use("*", requireRole("admin"));

// Create a modified LogQuery schema for route parsing (string to number transforms)
const RouteLogQuerySchema = z.object({
	page: z.string().optional().default("1").transform((val) => Math.max(1, parseInt(val) || 1)),
	limit: z.string().optional().default("50").transform((val) => Math.min(1000, Math.max(1, parseInt(val) || 50))),
	level: z.enum(["info", "warn", "error", "fatal"]).optional(),
	startDate: z.string().datetime().optional(),
	endDate: z.string().datetime().optional(),
	userId: z.string().uuid().optional(),
	route: z.string().optional(),
	method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]).optional(),
	statusCode: z.string().optional().transform((val) => val ? parseInt(val) : undefined),
	search: z.string().optional(),
	category: z.string().optional(),
	operation: z.string().optional(),
	environment: z.string().optional(),
	service: z.string().optional(),
	errorName: z.string().optional(),
	tags: z.string().optional().transform((val) => val ? val.split(",").map(t => t.trim()) : undefined),
	sortBy: z.enum(["timestamp", "level", "route", "duration", "statusCode"]).optional().default("timestamp"),
	sortOrder: z.enum(["asc", "desc"]).optional().default("desc"),
});

// ============================================
// Routes
// ============================================

const listLogsRoute = createRoute({
	method: "get",
	path: "/",
	description: "List logs with filtering, search, and pagination. Admin only.",
	summary: "List logs",
	request: {
		query: RouteLogQuerySchema,
	},
	responses: {
		200: {
			description: "List of logs",
			content: {
				"application/json": {
					schema: LogsListResponseSchema,
				},
			},
		},
	},
});

app.openapi(listLogsRoute, async (c) => {
	const query = c.req.valid("query");
	const logger = c.get("logger");

	try {
		let whereConditions = [];

		// Level filter
		if (query.level) {
			whereConditions.push(eq(logs.level, query.level));
		}

		// Date range filters
		if (query.startDate) {
			whereConditions.push(gte(logs.timestamp, new Date(query.startDate)));
		}
		if (query.endDate) {
			whereConditions.push(lte(logs.timestamp, new Date(query.endDate)));
		}

		// User ID filter
		if (query.userId) {
			whereConditions.push(eq(logs.userId, query.userId));
		}

		// Route filter
		if (query.route) {
			whereConditions.push(like(logs.route, `%${query.route}%`));
		}

		// Method filter
		if (query.method) {
			whereConditions.push(eq(logs.method, query.method));
		}

		// Status code filter
		if (query.statusCode) {
			whereConditions.push(eq(logs.statusCode, query.statusCode));
		}

		// Category filter
		if (query.category) {
			whereConditions.push(eq(logs.category, query.category));
		}

		// Operation filter
		if (query.operation) {
			whereConditions.push(eq(logs.operation, query.operation));
		}

		// Environment filter
		if (query.environment) {
			whereConditions.push(eq(logs.environment, query.environment));
		}

		// Service filter
		if (query.service) {
			whereConditions.push(eq(logs.service, query.service));
		}

		// Error name filter
		if (query.errorName) {
			whereConditions.push(eq(logs.errorName, query.errorName));
		}

		// Tags filter
		if (query.tags && query.tags.length > 0) {
			whereConditions.push(sql`${logs.tags} && ${query.tags}`);
		}

		// Search filter (searches in message and error stack)
		if (query.search) {
			whereConditions.push(
				sql`(${logs.message} ILIKE ${'%' + query.search + '%'} OR ${logs.errorStack} ILIKE ${'%' + query.search + '%'})`
			);
		}

		// Build WHERE clause
		const whereClause = whereConditions.length > 0 ? and(...whereConditions) : undefined;

		// Sorting
		const sortColumn = {
			timestamp: logs.timestamp,
			level: logs.level,
			route: logs.route,
			duration: logs.duration,
			statusCode: logs.statusCode,
		}[query.sortBy];

		const orderBy = query.sortOrder === "asc" ? asc(sortColumn) : desc(sortColumn);

		// Get total count
		const totalResult = await db
			.select({ count: sql`count(*)`.mapWith(Number) })
			.from(logs)
			.where(whereClause);
		
		const total = totalResult[0]?.count || 0;

		// Get paginated results
		const offset = (query.page - 1) * query.limit;
		const logResults = await db
			.select()
			.from(logs)
			.where(whereClause)
			.orderBy(orderBy)
			.limit(query.limit)
			.offset(offset);

		const totalPages = Math.ceil(total / query.limit);

		logger.info("Retrieved logs", {
			count: logResults.length,
			total,
			page: query.page,
			filters: query,
		});

		return c.json({
			logs: logResults.map(log => ({
				...log,
				timestamp: log.timestamp.toISOString(),
				createdAt: log.createdAt?.toISOString() || null,
				tags: log.tags || [],
			})),
			pagination: {
				page: query.page,
				limit: query.limit,
				total,
				totalPages,
			},
		});
	} catch (error) {
		logger.error("Failed to retrieve logs", error);
		throw error;
	}
});

const getLogStatsRoute = createRoute({
	method: "get",
	path: "/stats",
	description: "Get logging statistics including counts by level, route, and recent errors. Admin only.",
	summary: "Get log statistics",
	responses: {
		200: {
			description: "Log statistics",
			content: {
				"application/json": {
					schema: LogStatsResponseSchema,
				},
			},
		},
	},
});

app.openapi(getLogStatsRoute, async (c) => {
	const logger = c.get("logger");

	try {
		// Get total count
		const totalResult = await db
			.select({ count: sql`count(*)`.mapWith(Number) })
			.from(logs);

		// Get counts by level
		const levelCounts = await db
			.select({
				level: logs.level,
				count: sql`count(*)`.mapWith(Number),
			})
			.from(logs)
			.groupBy(logs.level);

		// Get top routes by log count
		const routeCounts = await db
			.select({
				route: logs.route,
				count: sql`count(*)`.mapWith(Number),
			})
			.from(logs)
			.where(sql`${logs.route} IS NOT NULL`)
			.groupBy(logs.route)
			.orderBy(desc(sql`count(*)`))
			.limit(10);

		// Get recent errors
		const recentErrors = await db
			.select({
				errorName: logs.errorName,
				count: sql`count(*)`.mapWith(Number),
				lastOccurrence: sql`max(${logs.timestamp})`.mapWith(String),
			})
			.from(logs)
			.where(sql`${logs.errorName} IS NOT NULL`)
			.groupBy(logs.errorName)
			.orderBy(desc(sql`max(${logs.timestamp})`))
			.limit(10);

		// Format level counts
		const logsByLevel = {
			info: levelCounts.find(l => l.level === 'info')?.count || 0,
			warn: levelCounts.find(l => l.level === 'warn')?.count || 0,
			error: levelCounts.find(l => l.level === 'error')?.count || 0,
			fatal: levelCounts.find(l => l.level === 'fatal')?.count || 0,
		};

		logger.info("Retrieved log statistics", {
			totalLogs: totalResult[0]?.count || 0,
			levelCounts: logsByLevel,
			routeCount: routeCounts.length,
			errorCount: recentErrors.length,
		});

		return c.json({
			totalLogs: totalResult[0]?.count || 0,
			logsByLevel,
			logsByRoute: routeCounts.map(r => ({
				route: r.route || 'unknown',
				count: r.count,
			})),
			recentErrors: recentErrors.map(e => ({
				errorName: e.errorName || 'unknown',
				count: e.count,
				lastOccurrence: e.lastOccurrence || new Date().toISOString(),
			})),
		});
	} catch (error) {
		logger.error("Failed to retrieve log statistics", error);
		throw error;
	}
});

const deleteLogsRoute = createRoute({
	method: "delete",
	path: "/cleanup",
	description: "Delete logs older than specified number of days. Admin only.",
	summary: "Cleanup old logs",
	request: {
		query: z.object({
			days: z.string().default("30").transform((val) => Math.max(1, parseInt(val) || 30)),
		}),
	},
	responses: {
		200: {
			description: "Logs cleaned up successfully",
			content: {
				"application/json": {
					schema: LogCleanupResponseSchema,
				},
			},
		},
	},
});

app.openapi(deleteLogsRoute, async (c) => {
	const query = c.req.valid("query");
	const logger = c.get("logger");

	try {
		const cutoffDate = new Date();
		cutoffDate.setDate(cutoffDate.getDate() - query.days);

		// Count logs to be deleted
		const countResult = await db
			.select({ count: sql`count(*)`.mapWith(Number) })
			.from(logs)
			.where(lte(logs.timestamp, cutoffDate));

		const toDelete = countResult[0]?.count || 0;

		// Delete old logs
		await db
			.delete(logs)
			.where(lte(logs.timestamp, cutoffDate));

		logger.info("Cleaned up old logs", {
			days: query.days,
			cutoffDate: cutoffDate.toISOString(),
			deletedCount: toDelete,
		});

		return c.json({
			success: true,
			message: `Successfully deleted ${toDelete} logs older than ${query.days} days`,
			deletedCount: toDelete,
		});
	} catch (error) {
		logger.error("Failed to cleanup logs", error);
		throw error;
	}
});

export default app;