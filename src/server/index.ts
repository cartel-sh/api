import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { config } from "dotenv";

import vanishingChannels from "./routes/vanishing-channels";
import practiceSessions from "./routes/practice-sessions";
import channelSettings from "./routes/channel-settings";
import applications from "./routes/applications";
import users from "./routes/users";

// Load environment variables
config();

const app = new Hono();

// Middleware
app.use("*", cors());
app.use("*", logger());

// Optional API key authentication middleware
app.use("/api/*", async (c, next) => {
  const apiKey = c.req.header("X-API-Key");
  const expectedKey = process.env.API_KEY;
  
  // If API_KEY is set in env, require it
  if (expectedKey && apiKey !== expectedKey) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  
  await next();
});

// Routes
app.route("/api/vanishing-channels", vanishingChannels);
app.route("/api/practice-sessions", practiceSessions);
app.route("/api/channel-settings", channelSettings);
app.route("/api/applications", applications);
app.route("/api/users", users);

// Health check
app.get("/health", (c) => c.json({ status: "ok", timestamp: new Date().toISOString() }));

// Root route
app.get("/", (c) => c.json({ 
  name: "@cartel-sh/db API",
  version: "1.0.0",
  endpoints: [
    "/api/vanishing-channels",
    "/api/practice-sessions",
    "/api/channel-settings",
    "/api/applications",
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

export default app;

// Start server if this file is run directly
if (require.main === module) {
  const port = Number(process.env.PORT) || 3003;
  
  console.log(`Starting server on port ${port}...`);
  
  serve({
    fetch: app.fetch,
    port,
  });
  
  console.log(`🚀 Server is running on http://localhost:${port}`);
  console.log(`📚 API documentation: http://localhost:${port}/`);
  console.log(`🏥 Health check: http://localhost:${port}/health`);
}