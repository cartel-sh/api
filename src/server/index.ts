import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { config } from "dotenv";
import { optionalApiKey } from "./middleware/auth";

import packageJson from "../../package.json" with { type: "json" };
import vanish from "./routes/discord/vanish";
import channels from "./routes/discord/channels";
import practice from "./routes/sessions/practice";
import applications from "./routes/users/applications";
import id from "./routes/users/id";
import identities from "./routes/users/identities";
import adminKeys from "./routes/admin/keys";
import adminIdentities from "./routes/admin/identities";
import projects from "./routes/projects";
import auth from "./routes/auth";

config();

const app = new Hono();

// Middleware
app.use("*", cors({
  credentials: true,
  origin: (origin) => {
    // In production, validate against allowed origins from database
    // For now, allow configured origins
    const allowedOrigins = [
      "http://localhost:3000",
      "http://localhost:3001", 
      "http://localhost:3003", 
      "https://cartel.sh",
      "https://www.cartel.sh",
    ];
    
    if (!origin) return "*"; // Allow requests without origin (e.g., Postman)
    
    if (allowedOrigins.includes(origin)) {
      return origin;
    }
    
    // Check for wildcard subdomains
    for (const allowed of allowedOrigins) {
      if (allowed.startsWith("*.")) {
        const domain = allowed.slice(2);
        if (origin.endsWith(domain)) {
          return origin;
        }
      }
    }
    
    return null; // Deny if not in allowed list
  },
}));
app.use("*", logger());

// Use optional API key middleware for rate limiting (doesn't require API key)
app.use("/api/*", optionalApiKey);

// Routes
app.route("/api/discord/vanish", vanish);
app.route("/api/discord/channels", channels);
app.route("/api/sessions/practice", practice);
app.route("/api/users/applications", applications);
app.route("/api/users/id", id);
app.route("/api/users/identities", identities);

// Admin routes (requires admin scope)
app.route("/api/admin/keys", adminKeys);
app.route("/api/admin/identities", adminIdentities);

// Project routes (supports both API key and JWT auth)
app.route("/api/projects", projects);

// Authentication routes
app.route("/api/auth", auth);

// Health check
app.get("/health", (c) => c.json({ status: "ok", timestamp: new Date().toISOString() }));

// Root route
app.get("/", (c) => c.json({
  name: "@cartel-sh/api",
  version: packageJson.version,
  endpoints: [
    "/api/discord/vanish",
    "/api/discord/channels",
    "/api/sessions/practice",
    "/api/users/applications",
    "/api/users/id",
    "/api/users/identities",
    "/api/admin/keys",
    "/api/admin/identities",
    "/api/projects",
    "/api/auth"
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