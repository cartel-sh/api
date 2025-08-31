import type { MiddlewareHandler } from "hono";
import { createRouteLogger } from "../utils/logger";

export const requestLogging = (): MiddlewareHandler => {
	return async (c, next) => {
		const start = Date.now();
		const method = c.req.method;
		const path = c.req.path;
		const routeName = `${method} ${path}`;

		const routeLogger = createRouteLogger(routeName);
		c.set("logger", routeLogger);

		const userAgent = c.req.header("User-Agent");
		const clientIP = c.req.header("X-Forwarded-For") || c.req.header("X-Real-IP") || "unknown";

		routeLogger.setRequestContext({
			method,
			path,
			userAgent,
			clientIp: clientIP,
		});

		routeLogger.logRequestStart(method, path, {
			userAgent,
			clientIP,
			query: c.req.query(),
		});

		try {
			await next();

			const duration = Date.now() - start;
			const status = c.res.status;

			routeLogger.setRequestContext({
				duration,
				statusCode: status,
			});

			routeLogger.logRequestEnd(method, path, status, duration);

		} catch (error) {
			const duration = Date.now() - start;
			
			routeLogger.setRequestContext({
				duration,
				statusCode: 500, // Default error status
			});
			
			routeLogger.error(`Request failed after ${duration}ms`, error);

			throw error;
		}
	};
};

declare module "hono" {
	interface ContextVariableMap {
		logger: ReturnType<typeof createRouteLogger>;
	}
}