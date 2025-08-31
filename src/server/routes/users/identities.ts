import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import { db, userIdentities } from "../../../client";
import { requestLogging } from "../../middleware/logging";
import {
	UserIdentitySchema,
	ErrorResponseSchema,
} from "../../../shared/schemas";

type Variables = {
	userId?: string;
	logger?: any;
};

const app = new OpenAPIHono<{ Variables: Variables }>();

app.use("*", requestLogging());
const getUserIdentitiesRoute = createRoute({
	method: "get",
	path: "/{userId}",
	summary: "Get User Identities",
	description: "Retrieves all identities associated with a specific user ID, ordered by primary status.",
	request: {
		params: z.object({
			userId: z.string(),
		}),
	},
	responses: {
		200: {
			description: "User identities",
			content: {
				"application/json": {
					schema: z.object({
						identities: z.array(UserIdentitySchema),
					}),
				},
			},
		},
		404: {
			description: "No identities found",
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

app.openapi(getUserIdentitiesRoute, async (c) => {
	const logger = c.get("logger");
	const { userId } = c.req.valid("param");

	logger.info("Getting user identities", { userId });

	try {
		logger.logDatabase("query", "userIdentities", {
			action: "find_identities_by_user_id",
			userId,
			orderBy: "isPrimary DESC",
		});
		const identities = await db.query.userIdentities.findMany({
			where: eq(userIdentities.userId, userId),
			orderBy: (userIdentities, { desc }) => [desc(userIdentities.isPrimary)],
		});

		if (!identities.length) {
			logger.warn("No identities found for user", { userId });
			return c.json({ error: "No identities found for user" }, 404);
		}

		const primaryIdentity = identities.find(i => i.isPrimary);
		const platforms = identities.map(i => i.platform);

		logger.info("User identities retrieved successfully", {
			userId,
			identityCount: identities.length,
			platforms,
			primaryPlatform: primaryIdentity?.platform,
			hasPrimary: !!primaryIdentity,
		});

		return c.json({ identities }, 200);
	} catch (error) {
		logger.error("User identities retrieval failed", error);
		return c.json({ error: "Failed to get user identities" }, 500);
	}
});

export default app;
