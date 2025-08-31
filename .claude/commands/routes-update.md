---
description: Update API routes and OpenAPI documentation for @cartel-sh/api
allowed_tools:
  - Read
  - Write
  - Edit
  - MultiEdit
  - Bash
  - TodoWrite
---

# API Routes Update Workflow for @cartel-sh/api

This command focuses on updating API routes and OpenAPI documentation without database schema changes.

## Current Project Structure
- **API Routes**: `src/server/routes/` - Hono-based REST API endpoints with OpenAPI documentation
- **OpenAPI**: Uses `@hono/zod-openapi` for automatic API documentation generation
- **Server**: `src/server/index.ts` - Main server file with route registration
- **Schema**: `src/schema.ts` - Database schema and TypeScript interfaces

## Task: API Routes Update

$ARGUMENTS

### Step 1: Analyze Requirements & Plan Changes

First, understand what needs to be added/modified:
- New API endpoints needed
- Updates to existing route handlers
- Changes to request/response validation
- OpenAPI documentation improvements

Use TodoWrite to create a detailed task list for the route updates.

### Step 2: Create/Update Route Files

Create a new route file in `src/server/routes/` or update existing ones using OpenAPI:

```typescript
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { db } from "../../client";
import { tableName } from "../../schema";
import { eq, and, desc } from "drizzle-orm";

const app = new OpenAPIHono();

// Define validation schemas
const createSchema = z.object({
  // Add fields matching your requirements
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
});

const updateSchema = createSchema.partial();

const querySchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
  filter: z.string().optional(),
});

// Define OpenAPI routes with proper documentation
const listRoute = createRoute({
  method: "get",
  path: "/",
  description: "List all items with optional filtering and pagination", // Full sentence description
  summary: "List items", // 2-4 word summary
  request: {
    query: querySchema,
  },
  responses: {
    200: {
      description: "List of items",
      content: {
        "application/json": {
          schema: z.array(z.object({
            id: z.string(),
            name: z.string(),
            description: z.string().nullable(),
            createdAt: z.string().nullable(),
            updatedAt: z.string().nullable(),
          })),
        },
      },
    },
    400: {
      description: "Invalid query parameters",
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
  tags: ["Items"], // Group related endpoints
});

app.openapi(listRoute, async (c) => {
  const { limit, offset, filter } = c.req.valid("query");
  
  try {
    let query = db.select().from(tableName);
    
    if (filter) {
      // Add filtering logic based on requirements
      query = query.where(/* filter conditions */);
    }
    
    const results = await query
      .limit(limit)
      .offset(offset)
      .orderBy(desc(tableName.createdAt));
    
    // IMPORTANT: Always specify status code explicitly for @hono/zod-openapi
    return c.json(results, 200);
  } catch (error) {
    console.error("Error listing items:", error);
    return c.json({ error: "Failed to list items" }, 500);
  }
});

const getByIdRoute = createRoute({
  method: "get",
  path: "/{id}",
  description: "Get a specific item by its ID",
  summary: "Get item",
  request: {
    params: z.object({
      id: z.string().uuid("Invalid UUID format"),
    }),
  },
  responses: {
    200: {
      description: "Item details",
      content: {
        "application/json": {
          schema: z.object({
            id: z.string(),
            name: z.string(),
            description: z.string().nullable(),
            createdAt: z.string().nullable(),
            updatedAt: z.string().nullable(),
          }),
        },
      },
    },
    404: {
      description: "Item not found",
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
  tags: ["Items"],
});

app.openapi(getByIdRoute, async (c) => {
  const { id } = c.req.valid("param");
  
  try {
    const [result] = await db
      .select()
      .from(tableName)
      .where(eq(tableName.id, id));
    
    if (!result) {
      return c.json({ error: "Item not found" }, 404);
    }
    
    return c.json(result, 200);
  } catch (error) {
    console.error("Error getting item:", error);
    return c.json({ error: "Failed to get item" }, 500);
  }
});

const createRoute = createRoute({
  method: "post",
  path: "/",
  description: "Create a new item in the database",
  summary: "Create item",
  request: {
    body: {
      content: {
        "application/json": {
          schema: createSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: "Item created successfully",
      content: {
        "application/json": {
          schema: z.object({
            id: z.string(),
            name: z.string(),
            description: z.string().nullable(),
            createdAt: z.string().nullable(),
            updatedAt: z.string().nullable(),
          }),
        },
      },
    },
    400: {
      description: "Invalid request data",
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
  tags: ["Items"],
});

app.openapi(createRoute, async (c) => {
  const data = c.req.valid("json");
  
  try {
    const [result] = await db
      .insert(tableName)
      .values(data)
      .returning();
    
    if (!result) {
      return c.json({ error: "Failed to create item" }, 500);
    }
    
    return c.json(result, 201);
  } catch (error) {
    console.error("Error creating item:", error);
    return c.json({ error: "Failed to create item" }, 500);
  }
});

const updateRoute = createRoute({
  method: "patch",
  path: "/{id}",
  description: "Update an existing item with partial data",
  summary: "Update item",
  request: {
    params: z.object({
      id: z.string().uuid("Invalid UUID format"),
    }),
    body: {
      content: {
        "application/json": {
          schema: updateSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Item updated successfully",
      content: {
        "application/json": {
          schema: z.object({
            id: z.string(),
            name: z.string(),
            description: z.string().nullable(),
            createdAt: z.string().nullable(),
            updatedAt: z.string().nullable(),
          }),
        },
      },
    },
    400: {
      description: "Invalid request data",
      content: {
        "application/json": {
          schema: z.object({
            error: z.string(),
          }),
        },
      },
    },
    404: {
      description: "Item not found",
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
  tags: ["Items"],
});

app.openapi(updateRoute, async (c) => {
  const { id } = c.req.valid("param");
  const data = c.req.valid("json");
  
  try {
    const [result] = await db
      .update(tableName)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(tableName.id, id))
      .returning();
    
    if (!result) {
      return c.json({ error: "Item not found" }, 404);
    }
    
    return c.json(result, 200);
  } catch (error) {
    console.error("Error updating item:", error);
    return c.json({ error: "Failed to update item" }, 500);
  }
});

const deleteRoute = createRoute({
  method: "delete",
  path: "/{id}",
  description: "Delete an item permanently from the database",
  summary: "Delete item",
  request: {
    params: z.object({
      id: z.string().uuid("Invalid UUID format"),
    }),
  },
  responses: {
    204: {
      description: "Item deleted successfully",
    },
    404: {
      description: "Item not found",
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
  tags: ["Items"],
});

app.openapi(deleteRoute, async (c) => {
  const { id } = c.req.valid("param");
  
  try {
    const result = await db
      .delete(tableName)
      .where(eq(tableName.id, id));
    
    if (result.rowCount === 0) {
      return c.json({ error: "Item not found" }, 404);
    }
    
    return c.body(null, 204);
  } catch (error) {
    console.error("Error deleting item:", error);
    return c.json({ error: "Failed to delete item" }, 500);
  }
});

export default app;
```

### Step 3: Register Routes in Main Server

Update `src/server/index.ts`:

1. Import the new route:
```typescript
import itemsRoute from "./routes/items";
```

2. Register the route:
```typescript
app.route("/api/items", itemsRoute);
```

3. Update the root endpoint list if needed:
```typescript
app.get("/", (c) => {
  return c.json({
    message: "Cartel API",
    version: "1.0.0",
    endpoints: [
      "/api/items",
      // Add your new endpoint here
    ],
  });
});
```

### Step 4: Test TypeScript Types and Build

Verify TypeScript compilation:
```bash
bun run typecheck
```

If you encounter type errors with `@hono/zod-openapi`, ensure:
- All `c.json()` calls have explicit status codes
- Response schemas match exactly what handlers return
- Nullable fields are properly marked with `.nullable()`

Then build the project:
```bash
bun run build
```

### Step 5: Test API Endpoints

Start the development server to test the new routes:
```bash
bun run dev
```

Test the endpoints:
1. Visit `/reference` for interactive OpenAPI documentation
2. Check `/openapi.json` for the generated OpenAPI spec
3. Test each endpoint with sample requests
4. Verify response schemas match the documentation

### Step 6: Update Version (if publishing)

Update `package.json` version following semver:
- Patch (x.x.1): Bug fixes to existing routes
- Minor (x.1.0): New routes/endpoints (backwards compatible)
- Major (1.0.0): Breaking changes to existing routes

```bash
npm version patch # or minor/major
```

### Step 7: Publish to npm (optional)

If ready to publish:
```bash
npm publish
```

## Important OpenAPI Guidelines

1. **Always use `createRoute()`** from `@hono/zod-openapi` instead of plain `app.get()`, `app.post()`, etc.
2. **Include both `description` and `summary`** for every route:
   - `description`: Complete sentence explaining what the endpoint does
   - `summary`: Short 2-4 word title
3. **Define all possible response codes** (200, 201, 400, 404, 500, etc.) with proper schemas
4. **Always specify status codes explicitly** in `c.json()` calls (e.g., `c.json(data, 200)`)
5. **Use proper tags** to group related endpoints in the documentation
6. **Match response schemas exactly** to what your handler returns to avoid TypeScript errors
7. **Use consistent naming** for similar operations across different resources

## Common Route Patterns in This Codebase

### Authentication Middleware
- Routes can use authentication middleware for protected endpoints
- API key authentication via `X-API-Key` header
- JWT bearer token authentication for user sessions

### Error Handling
- Consistent error response format: `{ error: string }`
- Proper HTTP status codes (400, 404, 500, etc.)
- Descriptive error messages
- Try-catch blocks around database operations

### Validation Schemas
- Use Zod for request/response validation
- Separate schemas for create/update operations
- Query parameter validation with defaults
- UUID validation for ID parameters

### Database Operations
- Use Drizzle ORM query builder
- Handle nullable fields appropriately
- Return appropriate HTTP status codes
- Use transactions for complex operations

## Verification Checklist

After completing the route update:
- [ ] New routes created with OpenAPI documentation
- [ ] All routes have description, summary, and tags
- [ ] Response schemas match handler return types
- [ ] All `c.json()` calls have explicit status codes
- [ ] Routes registered in main server file
- [ ] TypeScript compilation passes (`bun run typecheck`)
- [ ] Build completes without errors (`bun run build`)
- [ ] API documentation accessible at `/reference`
- [ ] Routes tested with sample requests
- [ ] Version updated if publishing
- [ ] Package published to npm if needed

## Troubleshooting OpenAPI TypeScript Errors

### Common Type Error: "Argument of type ... is not assignable to parameter of type Handler"
**Cause**: Response schemas don't match handler return types or missing status codes
**Solutions**:
1. Add explicit status codes to all `c.json()` calls
2. Ensure response schemas match exactly what's returned
3. Mark nullable fields with `.nullable()` in schemas

### Example Fix:
```typescript
// ❌ Wrong - no status code
return c.json(data);

// ✅ Correct - explicit status code
return c.json(data, 200);

// ❌ Wrong - schema doesn't match nullables
schema: z.object({
  status: z.string(), // But DB returns null sometimes
})

// ✅ Correct - nullable field
schema: z.object({
  status: z.string().nullable(),
})
```

## Notes

- Routes updates don't require database migrations
- OpenAPI documentation greatly improves developer experience
- Always test routes with the interactive docs at `/reference`
- Consider rate limiting for public endpoints
- Use proper HTTP methods and status codes