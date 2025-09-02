import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { eq, inArray, sql } from "drizzle-orm";
import { db, users, userIdentities } from "../../../client";
import { requestLogging } from "../../middleware/logging";
import { ErrorResponseSchema } from "../../../shared/schemas";
import type { User, UserIdentity } from "../../../schema";

type Variables = {
	userId?: string;
	logger?: any;
};

type UserWithIdentities = User & {
	identities: UserIdentity[];
};

type UserResult = User | UserWithIdentities;

const app = new OpenAPIHono<{ Variables: Variables }>();

app.use("*", requestLogging());

const UserRoleEnum = z.enum(["authenticated", "member", "admin"]);

const UserResponseSchema = z.object({
	id: z.string(),
	role: UserRoleEnum,
	address: z.string().nullable(),
	ensName: z.string().nullable(),
	ensAvatar: z.string().nullable(),
	createdAt: z.string().nullable(),
	updatedAt: z.string().nullable(),
	identities: z.array(z.object({
		platform: z.string(),
		identity: z.string(),
		isPrimary: z.boolean(),
	})).optional(),
});

const getUsersRoute = createRoute({
	method: "get",
	path: "/",
	summary: "List Users",
	description: "Retrieves a list of users, optionally filtered by role. Members and admins can see all users.",
	request: {
		query: z.object({
			role: UserRoleEnum.optional(),
			limit: z.coerce.number().min(1).max(100).default(50),
			offset: z.coerce.number().min(0).default(0),
			includeIdentities: z.coerce.boolean().default(false),
		}),
	},
	responses: {
		200: {
			description: "List of users retrieved successfully",
			content: {
				"application/json": {
					schema: z.object({
						users: z.array(UserResponseSchema),
						total: z.number(),
						limit: z.number(),
						offset: z.number(),
					}),
				},
			},
		},
		403: {
			description: "Access denied - insufficient permissions",
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
	tags: ["Users"],
});

app.openapi(getUsersRoute, async (c) => {
	const logger = c.get("logger");
	const userId = c.get("userId");
	const { role, limit, offset, includeIdentities } = c.req.valid("query");

	logger.info("Listing users", {
		userId,
		role,
		limit,
		offset,
		includeIdentities,
	});

	try {
		// Get current user to check permissions
		const currentUser = userId ? await db.query.users.findFirst({
			where: eq(users.id, userId),
		}) : null;

		// Only members and admins can see all users
		if (!currentUser || currentUser.role === "authenticated") {
			logger.warn("Access denied for user listing", {
				userId,
				userRole: currentUser?.role,
			});
			return c.json({ error: "Access denied - insufficient permissions" }, 403);
		}

		// Build query conditions
		let whereCondition;
		if (role) {
			whereCondition = eq(users.role, role);
		}

		// Query users
		logger.logDatabase("query", "users", {
			action: "list_users",
			role,
			limit,
			offset,
			includeIdentities,
		});

		const usersQuery = includeIdentities 
			? db.query.users.findMany({
				where: whereCondition,
				limit,
				offset,
				with: {
					identities: true,
				},
			})
			: db.query.users.findMany({
				where: whereCondition,
				limit,
				offset,
			});

		const [usersList, totalCount] = await Promise.all([
			usersQuery,
			db.query.users.findMany({
				where: whereCondition,
			}).then(result => result.length),
		]);

		const formattedUsers = usersList.map(user => {
			const baseUser = {
				id: user.id,
				role: user.role as "authenticated" | "member" | "admin",
				address: user.address,
				ensName: user.ensName,
				ensAvatar: user.ensAvatar,
				createdAt: user.createdAt?.toISOString() || null,
				updatedAt: user.updatedAt?.toISOString() || null,
			};

			if (includeIdentities && 'identities' in user) {
				const userWithIdentities = user as UserWithIdentities;
				return {
					...baseUser,
					identities: userWithIdentities.identities.map(identity => ({
						platform: identity.platform,
						identity: identity.platform === "evm" || identity.platform === "lens" ? "***masked***" : identity.identity,
						isPrimary: identity.isPrimary,
					})),
				};
			}

			return baseUser;
		});

		logger.info("Users listed successfully", {
			userId,
			totalCount,
			returnedCount: usersList.length,
			role,
		});

		return c.json({
			users: formattedUsers,
			total: totalCount,
			limit,
			offset,
		}, 200);
	} catch (error) {
		logger.error("User listing failed", error);
		return c.json({ error: "Failed to list users" }, 500);
	}
});

const getMembersRoute = createRoute({
	method: "get",
	path: "/members",
	summary: "List Members",
	description: "Retrieves a list of users with member or admin roles.",
	request: {
		query: z.object({
			limit: z.coerce.number().min(1).max(100).default(50),
			offset: z.coerce.number().min(0).default(0),
			includeIdentities: z.coerce.boolean().default(false),
		}),
	},
	responses: {
		200: {
			description: "List of members retrieved successfully",
			content: {
				"application/json": {
					schema: z.object({
						members: z.array(UserResponseSchema),
						total: z.number(),
						limit: z.number(),
						offset: z.number(),
					}),
				},
			},
		},
		403: {
			description: "Access denied - insufficient permissions",
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
	tags: ["Users"],
});

app.openapi(getMembersRoute, async (c) => {
	const logger = c.get("logger");
	const userId = c.get("userId");
	const { limit, offset, includeIdentities } = c.req.valid("query");

	logger.info("Listing members", {
		userId,
		limit,
		offset,
		includeIdentities,
	});

	try {
		// Get current user to check permissions
		const currentUser = userId ? await db.query.users.findFirst({
			where: eq(users.id, userId),
		}) : null;

		// Only members and admins can see member list
		if (!currentUser || (currentUser.role !== "member" && currentUser.role !== "admin")) {
			logger.warn("Access denied for member listing", {
				userId,
				userRole: currentUser?.role,
			});
			return c.json({ error: "Access denied - insufficient permissions" }, 403);
		}

		// Query members and admins
		logger.logDatabase("query", "users", {
			action: "list_members",
			limit,
			offset,
			includeIdentities,
		});

		const whereCondition = inArray(users.role, ["member", "admin"]);

		const membersQuery = includeIdentities
			? db.query.users.findMany({
				where: whereCondition,
				limit,
				offset,
				with: {
					identities: true,
				},
			})
			: db.query.users.findMany({
				where: whereCondition,
				limit,
				offset,
			});

		const [membersList, totalCount] = await Promise.all([
			membersQuery,
			db.query.users.findMany({
				where: whereCondition,
			}).then(result => result.length),
		]);

		const formattedMembers = membersList.map(user => {
			const baseMember = {
				id: user.id,
				role: user.role as "authenticated" | "member" | "admin",
				address: user.address,
				ensName: user.ensName,
				ensAvatar: user.ensAvatar,
				createdAt: user.createdAt?.toISOString() || null,
				updatedAt: user.updatedAt?.toISOString() || null,
			};

			if (includeIdentities && 'identities' in user) {
				const userWithIdentities = user as UserWithIdentities;
				return {
					...baseMember,
					identities: userWithIdentities.identities.map(identity => ({
						platform: identity.platform,
						identity: identity.platform === "evm" || identity.platform === "lens" ? "***masked***" : identity.identity,
						isPrimary: identity.isPrimary,
					})),
				};
			}

			return baseMember;
		});

		logger.info("Members listed successfully", {
			userId,
			totalCount,
			returnedCount: membersList.length,
		});

		return c.json({
			members: formattedMembers,
			total: totalCount,
			limit,
			offset,
		}, 200);
	} catch (error) {
		logger.error("Member listing failed", error);
		return c.json({ error: "Failed to list members" }, 500);
	}
});

export default app;