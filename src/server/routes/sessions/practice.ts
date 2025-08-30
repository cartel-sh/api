import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { and, desc, eq, gte, isNull, lte, sql as sqlExpr } from "drizzle-orm";
import { DateTime } from "luxon";
import { db, practiceSessions, userIdentities, users } from "../../../client";
import { getUserByDiscordId } from "../../utils";
import {
	StartPracticeSessionSchema,
	StopPracticeSessionSchema,
	PracticeSessionSchema,
	PracticeStatsSchema,
	PracticeTotalHoursSchema,
	PracticeLeaderboardEntrySchema,
	ErrorResponseSchema,
} from "../../../shared/schemas";

const app = new OpenAPIHono();

const startPracticeSessionRoute = createRoute({
	method: "post",
	path: "/start",
	summary: "Start Practice Session",
	description: "Starts a new practice session or returns an existing active session for a user.",
	request: {
		body: {
			content: {
				"application/json": {
					schema: StartPracticeSessionSchema,
				},
			},
		},
	},
	responses: {
		200: {
			description: "Practice session started or existing session returned",
			content: {
				"application/json": {
					schema: PracticeSessionSchema,
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
		500: {
			description: "Internal server error",
			content: {
				"application/json": {
					schema: ErrorResponseSchema,
				},
			},
		},
	},
	tags: ["Sessions"],
});

app.openapi(startPracticeSessionRoute, async (c) => {
	const { discordId, userId: providedUserId, notes } = c.req.valid("json");

	try {
		let userId: string;
		if (providedUserId) {
			userId = providedUserId;
		} else if (discordId) {
			userId = await getUserByDiscordId(discordId);
		} else {
			return c.json(
				{ error: "Either discordId or userId must be provided" },
				400,
			);
		}

		const activeSession = await db.query.practiceSessions.findFirst({
			where: and(
				eq(practiceSessions.userId, userId),
				isNull(practiceSessions.endTime),
			),
		});

		if (activeSession) {
			return c.json({
			id: activeSession.id,
			userId: activeSession.userId,
			startTime: activeSession.startTime.toISOString(),
			endTime: activeSession.endTime?.toISOString() || null,
			duration: activeSession.duration,
			date: activeSession.date,
			notes: activeSession.notes,
		}, 200);
		}

		const now = DateTime.now();
		const [newSession] = await db
			.insert(practiceSessions)
			.values({
				userId,
				startTime: now.toJSDate(),
				date: now.toFormat("yyyy-MM-dd"),
				notes: notes || null,
			})
			.returning();

		if (!newSession) {
			return c.json({ error: "Failed to start practice session" }, 500);
		}

		return c.json({
			id: newSession.id,
			userId: newSession.userId,
			startTime: newSession.startTime.toISOString(),
			endTime: newSession.endTime?.toISOString() || null,
			duration: newSession.duration,
			date: newSession.date,
			notes: newSession.notes,
		}, 200);
	} catch (error) {
		console.error("[API] Error starting practice session:", error);
		return c.json({ error: "Failed to start practice session" }, 500);
	}
});

const stopPracticeSessionRoute = createRoute({
	method: "post",
	path: "/stop",
	summary: "Stop Practice Session",
	description: "Stops the currently active practice session for a user and calculates the total duration.",
	request: {
		body: {
			content: {
				"application/json": {
					schema: StopPracticeSessionSchema,
				},
			},
		},
	},
	responses: {
		200: {
			description: "Practice session stopped",
			content: {
				"application/json": {
					schema: PracticeSessionSchema,
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
		404: {
			description: "No active session found",
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
	tags: ["Sessions"],
});

app.openapi(stopPracticeSessionRoute, async (c) => {
	const { discordId, userId: providedUserId } = c.req.valid("json");

	try {
		let userId: string;
		if (providedUserId) {
			userId = providedUserId;
		} else if (discordId) {
			userId = await getUserByDiscordId(discordId);
		} else {
			return c.json(
				{ error: "Either discordId or userId must be provided" },
				400,
			);
		}

		const activeSession = await db.query.practiceSessions.findFirst({
			where: and(
				eq(practiceSessions.userId, userId),
				isNull(practiceSessions.endTime),
			),
		});

		if (!activeSession) {
			return c.json({ error: "No active session found" }, 404);
		}

		const endTime = DateTime.now();
		const startTime = DateTime.fromJSDate(activeSession.startTime);
		const duration = Math.floor(endTime.diff(startTime, "seconds").seconds);

		const [updatedSession] = await db
			.update(practiceSessions)
			.set({
				endTime: endTime.toJSDate(),
				duration,
			})
			.where(eq(practiceSessions.id, activeSession.id))
			.returning();

		if (!updatedSession) {
			return c.json({ error: "Failed to stop practice session" }, 500);
		}

		return c.json({
			id: updatedSession.id,
			userId: updatedSession.userId,
			startTime: updatedSession.startTime.toISOString(),
			endTime: updatedSession.endTime?.toISOString() || null,
			duration: updatedSession.duration,
			date: updatedSession.date,
			notes: updatedSession.notes,
		}, 200);
	} catch (error) {
		console.error("[API] Error stopping practice session:", error);
		return c.json({ error: "Failed to stop practice session" }, 500);
	}
});

const getDailyStatsDiscordRoute = createRoute({
	method: "get",
	path: "/stats/daily/discord/{discordId}",
	summary: "Daily Stats Discord",
	description: "Gets daily practice session statistics for a user by Discord ID.",
	request: {
		params: z.object({
			discordId: z.string(),
		}),
	},
	responses: {
		200: {
			description: "Daily practice statistics",
			content: {
				"application/json": {
					schema: PracticeStatsSchema,
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
	tags: ["Sessions"],
});

app.openapi(getDailyStatsDiscordRoute, async (c) => {
	const { discordId } = c.req.valid("param");

	try {
		const userId = await getUserByDiscordId(discordId);
		const today = DateTime.now().toFormat("yyyy-MM-dd");

		const result = await db
			.select({
				totalDuration: sqlExpr<number>`COALESCE(SUM(${practiceSessions.duration}), 0)`,
			})
			.from(practiceSessions)
			.where(
				and(
					eq(practiceSessions.userId, userId),
					eq(practiceSessions.date, today),
				),
			);

		const totalDuration = Number(result[0]?.totalDuration) || 0;
		return c.json({ totalDuration }, 200);
	} catch (error) {
		console.error("[API] Error getting daily stats:", error);
		return c.json({ error: "Failed to get daily stats" }, 500);
	}
});

const getDailyStatsUserRoute = createRoute({
	method: "get",
	path: "/stats/daily/user/{userId}",
	summary: "Daily Stats User",
	description: "Gets daily practice session statistics for a user by user ID.",
	request: {
		params: z.object({
			userId: z.string().uuid(),
		}),
	},
	responses: {
		200: {
			description: "Daily practice statistics",
			content: {
				"application/json": {
					schema: PracticeStatsSchema,
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
	tags: ["Sessions"],
});

app.openapi(getDailyStatsUserRoute, async (c) => {
	const { userId } = c.req.valid("param");

	try {
		const today = DateTime.now().toFormat("yyyy-MM-dd");

		const result = await db
			.select({
				totalDuration: sqlExpr<number>`COALESCE(SUM(${practiceSessions.duration}), 0)`,
			})
			.from(practiceSessions)
			.where(
				and(
					eq(practiceSessions.userId, userId),
					eq(practiceSessions.date, today),
				),
			);

		const totalDuration = Number(result[0]?.totalDuration) || 0;
		return c.json({ totalDuration }, 200);
	} catch (error) {
		console.error("[API] Error getting daily stats:", error);
		return c.json({ error: "Failed to get daily stats" }, 500);
	}
});

const getWeeklyStatsDiscordRoute = createRoute({
	method: "get",
	path: "/stats/weekly/discord/{discordId}",
	summary: "Weekly Stats Discord",
	description: "Gets weekly practice session statistics for a user by Discord ID.",
	request: {
		params: z.object({
			discordId: z.string(),
		}),
	},
	responses: {
		200: {
			description: "Weekly practice statistics by date",
			content: {
				"application/json": {
					schema: z.record(z.string(), z.number()),
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
	tags: ["Sessions"],
});

app.openapi(getWeeklyStatsDiscordRoute, async (c) => {
	const { discordId } = c.req.valid("param");

	try {
		const userId = await getUserByDiscordId(discordId);
		const today = DateTime.now();
		const weekAgo = today.minus({ days: 6 });
		const startDate = weekAgo.toFormat("yyyy-MM-dd");
		const endDate = today.toFormat("yyyy-MM-dd");

		const results = await db
			.select({
				date: practiceSessions.date,
				totalDuration: sqlExpr<number>`COALESCE(SUM(${practiceSessions.duration}), 0)`,
			})
			.from(practiceSessions)
			.where(
				and(
					eq(practiceSessions.userId, userId),
					gte(practiceSessions.date, startDate),
					lte(practiceSessions.date, endDate),
				),
			)
			.groupBy(practiceSessions.date);

		const statsMap: Record<string, number> = {};
		for (let i = 0; i < 7; i++) {
			const date = weekAgo.plus({ days: i }).toFormat("yyyy-MM-dd");
			statsMap[date] = 0;
		}

		for (const result of results) {
			if (result.date) {
				statsMap[result.date] = Number(result.totalDuration) || 0;
			}
		}

		return c.json(statsMap, 200);
	} catch (error) {
		console.error("[API] Error getting weekly stats:", error);
		return c.json({ error: "Failed to get weekly stats" }, 500);
	}
});

const getWeeklyStatsUserRoute = createRoute({
	method: "get",
	path: "/stats/weekly/user/{userId}",
	summary: "Weekly Stats User",
	description: "Gets weekly practice session statistics for a user by user ID.",
	request: {
		params: z.object({
			userId: z.string().uuid(),
		}),
	},
	responses: {
		200: {
			description: "Weekly practice statistics by date",
			content: {
				"application/json": {
					schema: z.record(z.string(), z.number()),
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
	tags: ["Sessions"],
});

app.openapi(getWeeklyStatsUserRoute, async (c) => {
	const { userId } = c.req.valid("param");

	try {
		const today = DateTime.now();
		const weekAgo = today.minus({ days: 6 });
		const startDate = weekAgo.toFormat("yyyy-MM-dd");
		const endDate = today.toFormat("yyyy-MM-dd");

		const results = await db
			.select({
				date: practiceSessions.date,
				totalDuration: sqlExpr<number>`COALESCE(SUM(${practiceSessions.duration}), 0)`,
			})
			.from(practiceSessions)
			.where(
				and(
					eq(practiceSessions.userId, userId),
					gte(practiceSessions.date, startDate),
					lte(practiceSessions.date, endDate),
				),
			)
			.groupBy(practiceSessions.date);

		const statsMap: Record<string, number> = {};
		for (let i = 0; i < 7; i++) {
			const date = weekAgo.plus({ days: i }).toFormat("yyyy-MM-dd");
			statsMap[date] = 0;
		}

		for (const result of results) {
			if (result.date) {
				statsMap[result.date] = Number(result.totalDuration) || 0;
			}
		}

		return c.json(statsMap, 200);
	} catch (error) {
		console.error("[API] Error getting weekly stats:", error);
		return c.json({ error: "Failed to get weekly stats" }, 500);
	}
});

const getMonthlyStatsDiscordRoute = createRoute({
	method: "get",
	path: "/stats/monthly/discord/{discordId}",
	summary: "Monthly Stats Discord",
	description: "Gets monthly practice session statistics for a user by Discord ID.",
	request: {
		params: z.object({
			discordId: z.string(),
		}),
	},
	responses: {
		200: {
			description: "Monthly practice statistics by date",
			content: {
				"application/json": {
					schema: z.record(z.string(), z.number()),
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
	tags: ["Sessions"],
});

app.openapi(getMonthlyStatsDiscordRoute, async (c) => {
	const { discordId } = c.req.valid("param");

	try {
		const userId = await getUserByDiscordId(discordId);
		const now = DateTime.now();
		const startOfMonth = now.startOf("month").toFormat("yyyy-MM-dd");
		const endOfMonth = now.endOf("month").toFormat("yyyy-MM-dd");

		const results = await db
			.select({
				date: practiceSessions.date,
				totalDuration: sqlExpr<number>`COALESCE(SUM(${practiceSessions.duration}), 0)`,
			})
			.from(practiceSessions)
			.where(
				and(
					eq(practiceSessions.userId, userId),
					gte(practiceSessions.date, startOfMonth),
					lte(practiceSessions.date, endOfMonth),
				),
			)
			.groupBy(practiceSessions.date);

		const statsMap: Record<string, number> = {};
		const daysInMonth = now.daysInMonth;
		for (let i = 1; i <= daysInMonth; i++) {
			const date = now.set({ day: i }).toFormat("yyyy-MM-dd");
			statsMap[date] = 0;
		}

		for (const result of results) {
			if (result.date) {
				statsMap[result.date] = Number(result.totalDuration) || 0;
			}
		}

		return c.json(statsMap, 200);
	} catch (error) {
		console.error("[API] Error getting monthly stats:", error);
		return c.json({ error: "Failed to get monthly stats" }, 500);
	}
});

const getMonthlyStatsUserRoute = createRoute({
	method: "get",
	path: "/stats/monthly/user/{userId}",
	summary: "Monthly Stats User",
	description: "Gets monthly practice session statistics for a user by user ID.",
	request: {
		params: z.object({
			userId: z.string().uuid(),
		}),
	},
	responses: {
		200: {
			description: "Monthly practice statistics by date",
			content: {
				"application/json": {
					schema: z.record(z.string(), z.number()),
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
	tags: ["Sessions"],
});

app.openapi(getMonthlyStatsUserRoute, async (c) => {
	const { userId } = c.req.valid("param");

	try {
		const now = DateTime.now();
		const startOfMonth = now.startOf("month").toFormat("yyyy-MM-dd");
		const endOfMonth = now.endOf("month").toFormat("yyyy-MM-dd");

		const results = await db
			.select({
				date: practiceSessions.date,
				totalDuration: sqlExpr<number>`COALESCE(SUM(${practiceSessions.duration}), 0)`,
			})
			.from(practiceSessions)
			.where(
				and(
					eq(practiceSessions.userId, userId),
					gte(practiceSessions.date, startOfMonth),
					lte(practiceSessions.date, endOfMonth),
				),
			)
			.groupBy(practiceSessions.date);

		const statsMap: Record<string, number> = {};
		const daysInMonth = now.daysInMonth;
		for (let i = 1; i <= daysInMonth; i++) {
			const date = now.set({ day: i }).toFormat("yyyy-MM-dd");
			statsMap[date] = 0;
		}

		for (const result of results) {
			if (result.date) {
				statsMap[result.date] = Number(result.totalDuration) || 0;
			}
		}

		return c.json(statsMap, 200);
	} catch (error) {
		console.error("[API] Error getting monthly stats:", error);
		return c.json({ error: "Failed to get monthly stats" }, 500);
	}
});

const getLeaderboardRoute = createRoute({
	method: "get",
	path: "/leaderboard",
	summary: "Practice Leaderboard",
	description: "Gets the top 10 users by total practice duration.",
	responses: {
		200: {
			description: "Top users by practice duration",
			content: {
				"application/json": {
					schema: z.array(PracticeLeaderboardEntrySchema),
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
	tags: ["Sessions"],
});

app.openapi(getLeaderboardRoute, async (c) => {
	try {
		const results = await db
			.select({
				identity: userIdentities.identity,
				totalDuration: sqlExpr<number>`COALESCE(SUM(${practiceSessions.duration}), 0)`,
			})
			.from(practiceSessions)
			.innerJoin(users, eq(practiceSessions.userId, users.id))
			.innerJoin(
				userIdentities,
				and(
					eq(userIdentities.userId, users.id),
					eq(userIdentities.platform, "discord"),
				),
			)
			.groupBy(userIdentities.identity)
			.orderBy(desc(sqlExpr`SUM(${practiceSessions.duration})`))
			.limit(10);

		const topUsers = results.map((r) => ({
			identity: r.identity,
			totalDuration: Number(r.totalDuration) || 0,
		}));

		return c.json(topUsers, 200);
	} catch (error) {
		console.error("[API] Error getting leaderboard:", error);
		return c.json({ error: "Failed to get leaderboard" }, 500);
	}
});

const getTotalHoursRoute = createRoute({
	method: "get",
	path: "/total-hours",
	summary: "Total Practice Hours",
	description: "Gets the total practice hours across all users.",
	responses: {
		200: {
			description: "Total practice hours",
			content: {
				"application/json": {
					schema: PracticeTotalHoursSchema,
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
	tags: ["Sessions"],
});

app.openapi(getTotalHoursRoute, async (c) => {
	try {
		const result = await db
			.select({
				totalDuration: sqlExpr<number>`COALESCE(SUM(${practiceSessions.duration}), 0)`,
			})
			.from(practiceSessions);

		const totalSeconds = Number(result[0]?.totalDuration) || 0;
		const totalHours = Math.round((totalSeconds / 3600) * 10) / 10;

		return c.json({ totalHours }, 200);
	} catch (error) {
		console.error("[API] Error getting total hours:", error);
		return c.json({ error: "Failed to get total hours" }, 500);
	}
});

export default app;