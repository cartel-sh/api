import { db } from "../../client";
import { logs, type NewLogEntry, type UserRole } from "../../schema";
import packageJson from "../../../package.json";

export interface DatabaseLogConfig {
	enabled: boolean;
	batchSize: number;
	flushInterval: number; // milliseconds
	maxRetries: number;
	retryDelay: number; // milliseconds
}

export class DatabaseLogger {
	private config: DatabaseLogConfig;
	private logQueue: NewLogEntry[] = [];
	private flushTimer: NodeJS.Timeout | null = null;
	private isShuttingDown = false;
	private retryQueue: NewLogEntry[] = [];

	constructor(config: DatabaseLogConfig) {
		this.config = config;
		
		// Start periodic flush timer if enabled
		if (config.enabled && config.flushInterval > 0) {
			this.startFlushTimer();
		}

		// Graceful shutdown handling
		process.on('SIGINT', () => this.shutdown());
		process.on('SIGTERM', () => this.shutdown());
	}

	/**
	 * Add a log entry to the queue for database insertion
	 * This is non-blocking and won't affect request performance
	 */
	async log(entry: Partial<NewLogEntry>): Promise<void> {
		if (!this.config.enabled || this.isShuttingDown) {
			return;
		}

		try {
			// Create complete log entry with defaults
			const logEntry: NewLogEntry = {
				timestamp: new Date(),
				level: entry.level || 'info',
				message: entry.message || '',
				data: entry.data ? JSON.stringify(entry.data) : null,
				route: entry.route || null,
				method: entry.method || null,
				path: entry.path || null,
				statusCode: entry.statusCode || null,
				duration: entry.duration || null,
				userId: entry.userId || null,
				userRole: entry.userRole || null,
				clientIp: entry.clientIp || null,
				userAgent: entry.userAgent || null,
				sessionId: entry.sessionId || null,
				environment: entry.environment || process.env.NODE_ENV || 'development',
				version: entry.version || packageJson.version,
				service: entry.service || 'cartel-api',
				errorName: entry.errorName || null,
				errorStack: entry.errorStack || null,
				tags: entry.tags || [],
				category: entry.category || null,
				operation: entry.operation || null,
				traceId: entry.traceId || null,
				correlationId: entry.correlationId || null,
			};

			// Add to queue
			this.logQueue.push(logEntry);

			// Flush immediately if batch size reached
			if (this.logQueue.length >= this.config.batchSize) {
				await this.flush();
			}
		} catch (error) {
			// Don't throw - logging failures shouldn't break the application
			console.error('DatabaseLogger: Failed to queue log entry:', error);
		}
	}

	/**
	 * Force flush all queued logs to database
	 */
	async flush(): Promise<void> {
		if (!this.config.enabled || this.logQueue.length === 0) {
			return;
		}

		const logsToInsert = [...this.logQueue];
		this.logQueue = [];

		try {
			await this.insertLogs(logsToInsert);
		} catch (error) {
			console.error('DatabaseLogger: Failed to flush logs to database:', error);
			
			// Add failed logs to retry queue if not shutting down
			if (!this.isShuttingDown && this.retryQueue.length < this.config.batchSize * 3) {
				this.retryQueue.push(...logsToInsert);
				this.scheduleRetry();
			}
		}
	}

	/**
	 * Insert logs into database with error handling
	 */
	private async insertLogs(entries: NewLogEntry[]): Promise<void> {
		if (entries.length === 0) {
			return;
		}

		try {
			await db.insert(logs).values(entries);
		} catch (error) {
			// Log insertion failed - this could be due to:
			// 1. Database connection issues
			// 2. Schema/data validation errors
			// 3. Constraint violations
			throw new Error(`Failed to insert ${entries.length} log entries: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/**
	 * Schedule retry for failed log insertions
	 */
	private scheduleRetry(): void {
		if (this.isShuttingDown || this.retryQueue.length === 0) {
			return;
		}

		setTimeout(async () => {
			const logsToRetry = [...this.retryQueue];
			this.retryQueue = [];

			try {
				await this.insertLogs(logsToRetry);
			} catch (error) {
				console.error('DatabaseLogger: Retry failed, discarding logs:', error);
				// Don't retry again to prevent infinite loops
			}
		}, this.config.retryDelay);
	}

	/**
	 * Start the periodic flush timer
	 */
	private startFlushTimer(): void {
		if (this.flushTimer) {
			return;
		}

		this.flushTimer = setInterval(async () => {
			await this.flush();
		}, this.config.flushInterval);
	}

	/**
	 * Stop the flush timer
	 */
	private stopFlushTimer(): void {
		if (this.flushTimer) {
			clearInterval(this.flushTimer);
			this.flushTimer = null;
		}
	}

	/**
	 * Graceful shutdown - flush all remaining logs
	 */
	async shutdown(): Promise<void> {
		if (this.isShuttingDown) {
			return;
		}

		this.isShuttingDown = true;
		this.stopFlushTimer();

		try {
			// Flush any remaining logs
			await this.flush();
			
			// Flush retry queue
			if (this.retryQueue.length > 0) {
				await this.insertLogs(this.retryQueue);
				this.retryQueue = [];
			}
		} catch (error) {
			console.error('DatabaseLogger: Failed to flush logs during shutdown:', error);
		}
	}

	/**
	 * Get current queue status for monitoring
	 */
	getStatus() {
		return {
			enabled: this.config.enabled,
			queueSize: this.logQueue.length,
			retryQueueSize: this.retryQueue.length,
			isShuttingDown: this.isShuttingDown,
		};
	}
}

// Default configuration
const getDefaultConfig = (): DatabaseLogConfig => ({
	enabled: process.env.LOG_DB_ENABLED === 'true' || process.env.NODE_ENV === 'production',
	batchSize: parseInt(process.env.LOG_DB_BATCH_SIZE || '50'),
	flushInterval: parseInt(process.env.LOG_DB_FLUSH_INTERVAL || '5000'), // 5 seconds
	maxRetries: parseInt(process.env.LOG_DB_MAX_RETRIES || '3'),
	retryDelay: parseInt(process.env.LOG_DB_RETRY_DELAY || '10000'), // 10 seconds
});

// Global database logger instance
export const databaseLogger = new DatabaseLogger(getDefaultConfig());

// Helper function to create log entries from different contexts
export const createLogEntry = (params: {
	level: 'info' | 'warn' | 'error' | 'fatal';
	message: string;
	data?: any;
	route?: string;
	method?: string;
	path?: string;
	statusCode?: number;
	duration?: number;
	userId?: string;
	userRole?: UserRole;
	clientIp?: string;
	userAgent?: string;
	sessionId?: string;
	error?: Error;
	category?: string;
	operation?: string;
	tags?: string[];
	traceId?: string;
	correlationId?: string;
}): Partial<NewLogEntry> => {
	const entry: Partial<NewLogEntry> = {
		level: params.level,
		message: params.message,
		data: params.data,
		route: params.route,
		method: params.method,
		path: params.path,
		statusCode: params.statusCode,
		duration: params.duration,
		userId: params.userId,
		userRole: params.userRole,
		clientIp: params.clientIp,
		userAgent: params.userAgent,
		sessionId: params.sessionId,
		category: params.category,
		operation: params.operation,
		tags: params.tags,
		traceId: params.traceId,
		correlationId: params.correlationId,
	};

	// Handle error information
	if (params.error && params.error instanceof Error) {
		entry.errorName = params.error.name;
		entry.errorStack = params.error.stack;
	}

	return entry;
};