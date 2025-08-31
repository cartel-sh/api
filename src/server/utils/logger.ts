import pino from "pino";

export type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";
export enum LogVerbosity {
	SILENT = 0,    // No logs
	ERROR = 1,     // Only errors
	WARN = 2,      // Warnings and errors
	INFO = 3,      // Info, warnings, and errors
	DEBUG = 4,     // All logs including debug
}

interface LoggerConfig {
	verbosity: LogVerbosity;
	pretty?: boolean;
	service?: string;
}

const getVerbosityFromEnv = (): LogVerbosity => {
	const verbosity = process.env.LOG_VERBOSITY;
	if (!verbosity) return LogVerbosity.INFO;
	
	const numericVerbosity = parseInt(verbosity, 10);
	if (numericVerbosity >= 0 && numericVerbosity <= 4) {
		return numericVerbosity as LogVerbosity;
	}
	
	const stringMapping: Record<string, LogVerbosity> = {
		SILENT: LogVerbosity.SILENT,
		ERROR: LogVerbosity.ERROR,
		WARN: LogVerbosity.WARN,
		INFO: LogVerbosity.INFO,
		DEBUG: LogVerbosity.DEBUG,
	};
	
	return stringMapping[verbosity.toUpperCase()] || LogVerbosity.INFO;
};

const verbosityToPinoLevel = (verbosity: LogVerbosity): pino.LevelWithSilentOrString => {
	switch (verbosity) {
		case LogVerbosity.SILENT:
			return "silent";
		case LogVerbosity.ERROR:
			return "error";
		case LogVerbosity.WARN:
			return "warn";
		case LogVerbosity.INFO:
			return "info";
		case LogVerbosity.DEBUG:
			return "debug";
		default:
			return "info";
	}
};

const createLoggerConfig = (config: LoggerConfig): pino.LoggerOptions => {
	const baseConfig: pino.LoggerOptions = {
		level: verbosityToPinoLevel(config.verbosity),
		timestamp: pino.stdTimeFunctions.isoTime,
		formatters: {
			level: (label) => ({ level: label.toUpperCase() }),
		},
		...(config.service && { service: config.service }),
	};

	if (config.pretty && process.env.NODE_ENV !== "production") {
		return {
			...baseConfig,
			transport: {
				target: "pino-pretty",
				options: {
					colorize: true,
					levelFirst: false,
					timestampKey: "time",
					ignore: "pid,hostname",
					messageFormat: "[{time}] [{level}] {route}: {msg}",
				},
			},
		};
	}

	return baseConfig;
};

const loggerConfig: LoggerConfig = {
	verbosity: getVerbosityFromEnv(),
	pretty: process.env.NODE_ENV !== "production",
	service: "cartel-api",
};

const baseLogger = pino(createLoggerConfig(loggerConfig));

class RouteLogger {
	private logger: pino.Logger;
	private route: string;

	constructor(route: string, baseLogger: pino.Logger) {
		this.route = route;
		this.logger = baseLogger.child({ route });
	}

	debug(message: string, data?: any) {
		this.logger.debug(data || {}, message);
	}

	// Info level logging  
	info(message: string, data?: any) {
		this.logger.info(data || {}, message);
	}

	// Warning level logging
	warn(message: string, data?: any) {
		this.logger.warn(data || {}, message);
	}

	// Error level logging
	error(message: string, error?: Error | any) {
		if (error instanceof Error) {
			this.logger.error({ 
				error: {
					message: error.message,
					stack: error.stack,
					name: error.name,
				}
			}, message);
		} else if (error) {
			this.logger.error({ error }, message);
		} else {
			this.logger.error(message);
		}
	}

	// Fatal level logging
	fatal(message: string, error?: Error | any) {
		if (error instanceof Error) {
			this.logger.fatal({ 
				error: {
					message: error.message,
					stack: error.stack,
					name: error.name,
				}
			}, message);
		} else if (error) {
			this.logger.fatal({ error }, message);
		} else {
			this.logger.fatal(message);
		}
	}

	// Log request start
	logRequestStart(method: string, path: string, data?: any) {
		this.info(`${method} ${path} - Request started`, {
			method,
			path,
			...data,
		});
	}

	// Log request end
	logRequestEnd(method: string, path: string, statusCode: number, duration?: number) {
		const level = statusCode >= 400 ? "warn" : "info";
		this[level](`${method} ${path} - Request completed`, {
			method,
			path,
			statusCode,
			...(duration && { duration: `${duration}ms` }),
		});
	}

	// Log database operation
	logDatabase(operation: string, table?: string, data?: any) {
		this.debug(`Database ${operation}`, {
			operation,
			table,
			...data,
		});
	}

	// Log authentication
	logAuth(action: string, userId?: string, data?: any) {
		this.info(`Auth ${action}`, {
			action,
			userId,
			...data,
		});
	}
}

export const createRouteLogger = (route: string): RouteLogger => {
	return new RouteLogger(route, baseLogger);
};

export const logger = baseLogger;

export const setLogLevel = (verbosity: LogVerbosity) => {
	baseLogger.level = verbosityToPinoLevel(verbosity);
};

export const isLogLevelEnabled = (level: LogLevel): boolean => {
	return baseLogger.isLevelEnabled(level);
};

logger.info({
	verbosity: LogVerbosity[loggerConfig.verbosity],
	level: baseLogger.level,
	pretty: loggerConfig.pretty,
}, "Logging system initialized");