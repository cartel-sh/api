import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { and, desc, eq, gte, isNull, lte, sql as sqlExpr } from "drizzle-orm";
import { DateTime } from "luxon";
import { db, practiceSessions, userIdentities, users } from "../../../client";
import type { PracticeSession } from "../../../schema";
import { getUserByDiscordId } from "../../utils";

const app = new OpenAPIHono();
const startPracticeSessionRoute = createRoute({
	method: "post",
	path: "/start",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z
						.object({
							discordId: z.string().optional(),
							userId: z.string().uuid().optional(),
							notes: z.string().optional(),
						})
						.refine((data) => data.discordId || data.userId, {
							message: "Either discordId or userId must be provided",
						}),
				},
			},
		},
	},
	responses: {
		200: {
			description: "Practice session started or existing session returned",
			content: {
				"application/json": {
					schema: z.object({
						id: z.string(),
						userId: z.string(),
						startTime: z.string(),
						endTime: z.string().nullable(),
						duration: z.number().nullable(),
						date: z.string(),
						notes: z.string().nullable(),
					}),
				},
			},
		},
		400: {
			description: "Bad request",
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
			return c.json(activeSession as PracticeSession, 200);
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

		return c.json(newSession as PracticeSession, 200);
	} catch (error) {
		console.error("[API] Error starting practice session:", error);
		return c.json({ error: "Failed to start practice session" }, 500);
	}
});
const stopPracticeSessionRoute = createRoute({
	method: "post",
	path: "/stop",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z
						.object({
							discordId: z.string().optional(),
							userId: z.string().uuid().optional(),
						})
						.refine((data) => data.discordId || data.userId, {
							message: "Either discordId or userId must be provided",
						}),
				},
			},
		},
	},
	responses: {
		200: {
			description: "Practice session stopped",
			content: {
				"application/json": {
					schema: z.object({
						id: z.string(),
						userId: z.string(),
						startTime: z.string(),
						endTime: z.string().nullable(),
						duration: z.number().nullable(),
						date: z.string(),
						notes: z.string().nullable(),
					}),
				},
			},
		},
		400: {
			description: "Bad request",
			content: {
				"application/json": {
					schema: z.object({
						error: z.string(),
					}),
				},
			},
		},
		404: {
			description: "No active session found",
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

		return c.json(updatedSession as PracticeSession, 200);
	} catch (error) {
		console.error("[API] Error stopping practice session:", error);
		return c.json({ error: "Failed to stop practice session" }, 500);
	}
});

app.get("/stats/daily/discord/:discordId", async (c) => {
	const discordId = c.req.param("discordId");

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

app.get("/stats/daily/user/:userId", async (c) => {
	const userId = c.req.param("userId");

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

app.get("/stats/weekly/discord/:discordId", async (c) => {
	const discordId = c.req.param("discordId");

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

app.get("/stats/weekly/user/:userId", async (c) => {
	const userId = c.req.param("userId");

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

app.get("/stats/monthly/discord/:discordId", async (c) => {
	const discordId = c.req.param("discordId");

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

app.get("/stats/monthly/user/:userId", async (c) => {
	const userId = c.req.param("userId");

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

app.get("/leaderboard", async (c) => {
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

app.get("/total-hours", async (c) => {
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
