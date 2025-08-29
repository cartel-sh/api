import { OpenAPIHono } from "@hono/zod-openapi";
import { Scalar } from "@scalar/hono-api-reference";
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
import { createMarkdownFromOpenApi } from "@scalar/openapi-to-markdown";

config();

const app = new OpenAPIHono();

app.use("*", cors({
  credentials: true,
  origin: (origin) => {
    const allowedOrigins = [
      "http://localhost:3000",
      "http://localhost:3001", 
      "http://localhost:3003", 
      "https://cartel.sh",
      "https://www.cartel.sh",
    ];
    
    if (!origin) return "*";
    
    if (allowedOrigins.includes(origin)) {
      return origin;
    }
    
    for (const allowed of allowedOrigins) {
      if (allowed.startsWith("*.")) {
        const domain = allowed.slice(2);
        if (origin.endsWith(domain)) {
          return origin;
        }
      }
    }
    
    return null;
  },
}))
app.use("*", logger());
app.use("/api/*", optionalApiKey);

app.route("/api/discord/vanish", vanish);
app.route("/api/discord/channels", channels);
app.route("/api/sessions/practice", practice);
app.route("/api/users/applications", applications);
app.route("/api/users/id", id);
app.route("/api/users/identities", identities);
app.route("/api/admin/keys", adminKeys);
app.route("/api/admin/identities", adminIdentities);
app.route("/api/projects", projects);
app.route("/api/auth", auth);

app.get("/health", (c) => c.json({ status: "ok", timestamp: new Date().toISOString() }));

const port = Number(process.env.PORT || Bun.env?.PORT) || 3003;

app.doc("/openapi.json", {
  openapi: "3.1.0",
  info: {
    title: "Cartel API",
    version: packageJson.version,
    description: "Shared REST API for Cartel",
  },
  servers: [
    {
      url: process.env.API_URL || `http://localhost:${port}`,
      description: "API Server",
    },
  ],
});

app.get('/llms.txt', async (c) => {
  const content = app.getOpenAPI31Document({
    openapi: '3.1.0',
    info: { title: 'Cartel API', version: packageJson.version },
  });
  
  const markdown = await createMarkdownFromOpenApi(
    JSON.stringify(content)
  );
  
  return c.text(markdown);
})

app.get("/docs", Scalar({
  pageTitle: "Cartel API",
  url: "/openapi.json",
}));

app.get("/", (c) => c.json({
  name: "@cartel-sh/api",
  version: packageJson.version,
  documentation: "/docs",
  openapi: "/openapi.json",
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

app.notFound((c) => c.json({ error: "Not found" }, 404));

app.onError((err, c) => {
  console.error(`Error: ${err}`);
  return c.json({ error: "Internal server error" }, 500);
});

console.log(`Documentation is available at http://localhost:${port}/docs`);

export default {
  port,
  fetch: app.fetch,
};