import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { eq } from "drizzle-orm";
import { db, userIdentities } from "../../../client";

const app = new OpenAPIHono();
const getUserIdentitiesRoute = createRoute({
	method: "get",
	path: "/{userId}",
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
						identities: z.array(
							z.object({
								userId: z.string(),
								identity: z.string(),
								platform: z.string(),
								isPrimary: z.boolean(),
								createdAt: z.string().nullable(),
								updatedAt: z.string().nullable(),
							}),
						),
					}),
				},
			},
		},
		404: {
			description: "No identities found",
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
	tags: ["Users"],
});

app.openapi(getUserIdentitiesRoute, async (c) => {
	const { userId } = c.req.valid("param");

	try {
		const identities = await db.query.userIdentities.findMany({
			where: eq(userIdentities.userId, userId),
			orderBy: (userIdentities, { desc }) => [desc(userIdentities.isPrimary)],
		});

		if (!identities.length) {
			return c.json({ error: "No identities found for user" }, 404);
		}

		return c.json({ identities }, 200);
	} catch (error) {
		console.error("[API] Error getting user identities:", error);
		return c.json({ error: "Failed to get user identities" }, 500);
	}
});

export default app;
