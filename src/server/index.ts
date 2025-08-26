import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { config } from "dotenv";

import vanish from "./routes/discord/vanish";
import channels from "./routes/discord/channels";
import practice from "./routes/sessions/practice";
import applications from "./routes/users/applications";
import users from "./routes/users";
import adminKeys from "./routes/admin/keys";
import { apiKeyAuth } from "./middleware/auth";

config();

const app = new Hono();

// Middleware
app.use("*", cors());
app.use("*", logger());

// Use new database-based API key authentication middleware
app.use("/api/*", apiKeyAuth);

// Routes
app.route("/api/discord/vanish", vanish);
app.route("/api/discord/channels", channels);
app.route("/api/sessions/practice", practice);
app.route("/api/users/applications", applications);
app.route("/api/users", users);

// Admin routes (requires admin scope)
app.route("/api/admin/keys", adminKeys);

// Health check
app.get("/health", (c) => c.json({ status: "ok", timestamp: new Date().toISOString() }));

// Root route
app.get("/", (c) => c.json({ 
  name: "@cartel-sh/db API",
  version: "1.0.0",
  endpoints: [
    "/api/discord/vanish",
    "/api/discord/channels",
    "/api/sessions/practice",
    "/api/users/applications",
    "/api/users"
  ]
}));

// 404 handler
app.notFound((c) => c.json({ error: "Not found" }, 404));

// Error handler
app.onError((err, c) => {
  console.error(`Error: ${err}`);
  return c.json({ error: "Internal server error" }, 500);
});

// For Bun runtime
const port = Number(process.env.PORT || Bun.env?.PORT) || 3003;

console.log(`Starting server on port ${port}...`);
console.log(`Server is running on http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
};