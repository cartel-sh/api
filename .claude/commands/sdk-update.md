---
description: Update SDK client methods for @cartel-sh/api package
allowed_tools:
  - Read
  - Write
  - Edit
  - MultiEdit
  - Bash
  - TodoWrite
---

# SDK Update Workflow for @cartel-sh/api

This command focuses on updating the TypeScript SDK client methods without database or API route changes.

## Current Project Structure
- **SDK Client**: `src/client/sdk.ts` - TypeScript SDK for API consumption
- **Types**: `src/schema.ts` - TypeScript interfaces from database schema
- **Build**: TypeScript compilation via tsup to dist/

## Task: SDK Methods Update

$ARGUMENTS

### Step 1: Analyze Requirements & Plan Changes

First, understand what SDK methods need to be added/modified:
- New client methods for existing API endpoints
- Updated method signatures or parameters
- New TypeScript interfaces or types
- Error handling improvements

Use TodoWrite to create a detailed task list for the SDK updates.

### Step 2: Review Existing API Endpoints

Check available API routes that need SDK methods:
1. Review `src/server/routes/` for available endpoints
2. Check OpenAPI documentation at `/reference` if server is running
3. Identify missing SDK methods

### Step 3: Update SDK Client

Edit `src/client/sdk.ts` to add/modify methods:

```typescript
// Add methods following the existing pattern
async createNewItem(data: Omit<NewTable, 'id' | 'createdAt' | 'updatedAt'>) {
  return this.request("/api/path", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

async getNewItems(params?: { 
  filter?: string;
  limit?: number;
  offset?: number; 
}) {
  const query = params ? `?${new URLSearchParams(params as any).toString()}` : "";
  return this.request(`/api/path${query}`);
}

async updateNewItem(id: string, data: Partial<Omit<NewTable, 'id' | 'createdAt' | 'updatedAt'>>) {
  return this.request(`/api/path/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

async deleteNewItem(id: string) {
  return this.request(`/api/path/${id}`, {
    method: "DELETE",
  });
}
```

### Step 4: Update TypeScript Types (if needed)

If new interfaces are required, add them to the SDK or import from schema:

```typescript
// Import types from schema
import type { NewTable, NewNewTable } from "../schema";

// Or define SDK-specific types
export interface CreateNewItemRequest extends Omit<NewTable, 'id' | 'createdAt' | 'updatedAt'> {}
export interface UpdateNewItemRequest extends Partial<CreateNewItemRequest> {}
```

### Step 5: Update Method Documentation

Add JSDoc comments to new methods:

```typescript
/**
 * Create a new item
 * @param data - The item data to create
 * @returns Promise<NewTable> - The created item
 */
async createNewItem(data: CreateNewItemRequest): Promise<NewTable> {
  return this.request("/api/path", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/**
 * Get items with optional filtering
 * @param params - Optional query parameters
 * @returns Promise<NewTable[]> - Array of items
 */
async getNewItems(params?: GetNewItemsParams): Promise<NewTable[]> {
  const query = params ? `?${new URLSearchParams(params as any).toString()}` : "";
  return this.request(`/api/path${query}`);
}
```

### Step 6: Test TypeScript Types and Build

Verify TypeScript compilation:
```bash
bun run typecheck
```

Check for type errors and fix any issues with:
- Method signatures
- Return types
- Parameter types
- Import statements

Then build the project:
```bash
bun run build
```

### Step 7: Update Version

Update `package.json` version following semver:
- Patch (x.x.1): Bug fixes, minor SDK improvements
- Minor (x.1.0): New SDK methods (backwards compatible)
- Major (1.0.0): Breaking changes to SDK interface

```bash
npm version patch # or minor/major
```

### Step 8: Publish to npm

```bash
npm publish
```

This will run `prepublishOnly` script (build) and publish to npm registry.

## Common SDK Patterns in This Codebase

### Authentication Handling
- SDK automatically handles API key in request headers
- Bearer tokens managed automatically with refresh logic
- Private `request` method centralizes auth and error handling

### Method Naming Conventions
- `get{Resource}` - List/retrieve resources
- `create{Resource}` - Create new resource
- `update{Resource}` - Update existing resource
- `delete{Resource}` - Delete resource
- Use singular resource names (e.g., `getUser`, not `getUsers`)

### Parameter Patterns
- Use TypeScript interfaces for complex parameters
- Optional parameters as object with `?` properties
- Query parameters handled via URLSearchParams
- Request bodies as typed objects

### Return Types
- Always specify Promise return types
- Use database schema types where possible
- Arrays for list endpoints: `Promise<Resource[]>`
- Single objects for CRUD operations: `Promise<Resource>`

### Error Handling
- SDK handles HTTP errors in private `request` method
- Descriptive error messages for different status codes
- Type-safe error responses

## Verification Checklist

After completing the SDK update:
- [ ] New SDK methods added with proper signatures
- [ ] TypeScript types are correct and imported
- [ ] JSDoc documentation added for new methods
- [ ] All methods follow existing naming conventions
- [ ] TypeScript compilation passes (`bun run typecheck`)
- [ ] Build completes without errors (`bun run build`)
- [ ] Version updated in package.json
- [ ] Package published to npm successfully

## Example: Complete CRUD SDK Methods

```typescript
// List with optional filtering
async getItems(params?: {
  limit?: number;
  offset?: number;
  filter?: string;
}): Promise<Item[]> {
  const query = params ? `?${new URLSearchParams(params as any).toString()}` : "";
  return this.request(`/api/items${query}`);
}

// Get single item by ID
async getItem(id: string): Promise<Item> {
  return this.request(`/api/items/${id}`);
}

// Create new item
async createItem(data: CreateItemRequest): Promise<Item> {
  return this.request("/api/items", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

// Update existing item
async updateItem(id: string, data: UpdateItemRequest): Promise<Item> {
  return this.request(`/api/items/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

// Delete item
async deleteItem(id: string): Promise<void> {
  return this.request(`/api/items/${id}`, {
    method: "DELETE",
  });
}
```

## Notes

- SDK updates don't require database migrations
- Test SDK methods against running API server when possible
- Consider backwards compatibility for existing consumers
- Document breaking changes in version updates