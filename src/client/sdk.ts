import type {
	AuthResponse,
	RefreshResponse,
	UserIdentityLookup,
	VanishingChannelSuccess,
	VanishingChannelStats,
	VanishingChannel,
	PracticeSession,
	PracticeStats,
	PracticeTotalHours,
	PracticeLeaderboardEntry,
	Application,
	ApplicationVote,
	User,
	UserIdentity,
	UserMeResponse,
	Project,
	ProjectWithUser,
	SuccessResponse,
	LogQuery,
	LogEntry,
	LogsListResponse,
	LogStatsResponse,
	LogCleanupResponse,
} from "../shared/schemas";

export type {
	AuthResponse,
	RefreshResponse,
	UserIdentityLookup,
	UserMeResponse,
	Project,
	ProjectWithUser,
	LogQuery,
	LogEntry,
	LogsListResponse,
	LogStatsResponse,
	LogCleanupResponse,
} from "../shared/schemas";

export interface TokenStorage {
	getAccessToken(): string | null;
	getRefreshToken(): string | null;
	setTokens(accessToken: string, refreshToken: string, expiresIn: number): void;
	clearTokens(): void;
}

// Default in-memory token storage
class InMemoryTokenStorage implements TokenStorage {
	private accessToken: string | null = null;
	private refreshToken: string | null = null;
	private accessTokenExpiry: number | null = null;

	getAccessToken(): string | null {
		if (this.accessTokenExpiry && Date.now() >= this.accessTokenExpiry) {
			this.accessToken = null;
		}
		return this.accessToken;
	}

	getRefreshToken(): string | null {
		return this.refreshToken;
	}

	setTokens(accessToken: string, refreshToken: string, expiresIn: number): void {
		this.accessToken = accessToken;
		this.refreshToken = refreshToken;
		this.accessTokenExpiry = Date.now() + (expiresIn * 1000);
	}

	clearTokens(): void {
		this.accessToken = null;
		this.refreshToken = null;
		this.accessTokenExpiry = null;
	}
}

class LocalStorageTokenStorage implements TokenStorage {
	private readonly ACCESS_TOKEN_KEY = "cartel_access_token";
	private readonly REFRESH_TOKEN_KEY = "cartel_refresh_token";
	private readonly EXPIRY_KEY = "cartel_token_expiry";

	getAccessToken(): string | null {
		if (typeof window === "undefined") return null;
		
		const expiry = localStorage.getItem(this.EXPIRY_KEY);
		if (expiry && Date.now() >= parseInt(expiry)) {
			localStorage.removeItem(this.ACCESS_TOKEN_KEY);
			localStorage.removeItem(this.EXPIRY_KEY);
			return null;
		}
		
		return localStorage.getItem(this.ACCESS_TOKEN_KEY);
	}

	getRefreshToken(): string | null {
		if (typeof window === "undefined") return null;
		return localStorage.getItem(this.REFRESH_TOKEN_KEY);
	}

	setTokens(accessToken: string, refreshToken: string, expiresIn: number): void {
		if (typeof window === "undefined") return;
		
		localStorage.setItem(this.ACCESS_TOKEN_KEY, accessToken);
		localStorage.setItem(this.REFRESH_TOKEN_KEY, refreshToken);
		localStorage.setItem(this.EXPIRY_KEY, String(Date.now() + (expiresIn * 1000)));
	}

	clearTokens(): void {
		if (typeof window === "undefined") return;
		
		localStorage.removeItem(this.ACCESS_TOKEN_KEY);
		localStorage.removeItem(this.REFRESH_TOKEN_KEY);
		localStorage.removeItem(this.EXPIRY_KEY);
	}
}

class AuthNamespace {
	constructor(private client: CartelClient) {}

	async verifySiwe(message: string, signature: string): Promise<AuthResponse> {
		const response = await this.client.request<AuthResponse>("/api/auth/verify", {
			method: "POST",
			body: JSON.stringify({ message, signature }),
			skipAuth: true,
		});

		this.client.tokenStorage.setTokens(
			response.accessToken,
			response.refreshToken,
			response.expiresIn,
		);

		return response;
	}

	async refresh(): Promise<RefreshResponse> {
		const refreshToken = this.client.tokenStorage.getRefreshToken();
		
		if (!refreshToken) {
			throw new Error("No refresh token available");
		}

		const response = await this.client.request<RefreshResponse>("/api/auth/refresh", {
			method: "POST",
			body: JSON.stringify({ refreshToken }),
			skipAuth: true,
		});

		this.client.tokenStorage.setTokens(
			response.accessToken,
			response.refreshToken,
			response.expiresIn,
		);

		return response;
	}

	async me(): Promise<UserMeResponse> {
		return this.client.request<UserMeResponse>("/api/auth/me");
	}

	async revoke(): Promise<SuccessResponse> {
		const response = await this.client.request<SuccessResponse>("/api/auth/revoke", {
			method: "POST",
		});
		
		this.client.tokenStorage.clearTokens();
		
		return response;
	}

	logout(): void {
		this.client.tokenStorage.clearTokens();
	}
}

class VanishNamespace {
	constructor(private client: CartelClient) {}

	async create(params: {
		channelId: string;
		guildId: string;
		duration: number;
	}): Promise<VanishingChannelSuccess> {
		return this.client.request<VanishingChannelSuccess>("/api/vanish/discord", {
			method: "POST",
			body: JSON.stringify(params),
		});
	}

	async remove(channelId: string): Promise<VanishingChannelSuccess> {
		return this.client.request<VanishingChannelSuccess>(`/api/vanish/discord/${channelId}`, {
			method: "DELETE",
		});
	}

	async get(channelId: string): Promise<VanishingChannel>;
	async get(params?: { guildId?: string }): Promise<VanishingChannel[]>;
	async get(params?: string | { guildId?: string }): Promise<VanishingChannel | VanishingChannel[]> {
		if (typeof params === "string") {
			return this.client.request<VanishingChannel>(`/api/vanish/discord/${params}`);
		}
		const query = params?.guildId ? `?guildId=${params.guildId}` : "";
		return this.client.request<VanishingChannel[]>(`/api/vanish/discord${query}`);
	}

	async updateStats(
		channelId: string, 
		deletedCount: number
	): Promise<VanishingChannelStats> {
		return this.client.request<VanishingChannelStats>(`/api/vanish/discord/${channelId}/stats`, {
			method: "PATCH",
			body: JSON.stringify({ deletedCount }),
		});
	}
}

class PracticeNamespace {
	constructor(private client: CartelClient) {}

	async start(params: {
		discordId?: string;
		userId?: string;
		notes?: string;
	}): Promise<PracticeSession> {
		return this.client.request<PracticeSession>("/api/sessions/practice/start", {
			method: "POST",
			body: JSON.stringify(params),
		});
	}

	async stop(params: { 
		discordId?: string; 
		userId?: string 
	}): Promise<PracticeSession> {
		return this.client.request<PracticeSession>("/api/sessions/practice/stop", {
			method: "POST",
			body: JSON.stringify(params),
		});
	}

	async getStats(type: 'daily', params: { discordId?: string; userId?: string }): Promise<PracticeStats>;
	async getStats(type: 'weekly' | 'monthly', params: { discordId?: string; userId?: string }): Promise<Record<string, number>>;
	async getStats(type: 'total'): Promise<PracticeTotalHours>;
	async getStats(
		type: 'daily' | 'weekly' | 'monthly' | 'total',
		params?: { discordId?: string; userId?: string }
	): Promise<PracticeStats | Record<string, number> | PracticeTotalHours> {
		if (type === 'total') {
			return this.client.request<PracticeTotalHours>("/api/sessions/practice/total-hours");
		}

		if (!params || (!params.discordId && !params.userId)) {
			throw new Error("Either discordId or userId must be provided for stats");
		}

		const identifier = params.discordId 
			? `discord/${params.discordId}` 
			: `user/${params.userId}`;

		if (type === 'daily') {
			return this.client.request<PracticeStats>(
				`/api/sessions/practice/stats/daily/${identifier}`
			);
		} else if (type === 'weekly') {
			return this.client.request<Record<string, number>>(
				`/api/sessions/practice/stats/weekly/${identifier}`
			);
		} else {
			return this.client.request<Record<string, number>>(
				`/api/sessions/practice/stats/monthly/${identifier}`
			);
		}
	}

	async leaderboard(): Promise<PracticeLeaderboardEntry[]> {
		return this.client.request<PracticeLeaderboardEntry[]>("/api/sessions/practice/leaderboard");
	}
}

class ApplicationsNamespace {
	constructor(private client: CartelClient) {}

	async create(params: {
		messageId: string;
		guildId: string;
		channelId: string;
		applicantId: string;
		applicantName: string;
		responses: Record<string, string>;
		applicationNumber: number;
	}): Promise<Application> {
		return this.client.request<Application>("/api/users/applications", {
			method: "POST",
			body: JSON.stringify(params),
		});
	}

	async getPending(): Promise<Application[]> {
		return this.client.request<Application[]>("/api/users/applications/pending");
	}

	async getByMessageId(messageId: string): Promise<Application> {
		return this.client.request<Application>(`/api/users/applications/message/${messageId}`);
	}

	async getByNumber(applicationNumber: number): Promise<Application> {
		return this.client.request<Application>(`/api/users/applications/number/${applicationNumber}`);
	}

	async updateStatus(applicationId: string, status: "approved" | "rejected"): Promise<Application> {
		return this.client.request<Application>(`/api/users/applications/${applicationId}`, {
			method: "PATCH",
			body: JSON.stringify({ status }),
		});
	}

	async delete(applicationId: string): Promise<SuccessResponse> {
		return this.client.request<SuccessResponse>(`/api/users/applications/${applicationId}`, {
			method: "DELETE",
		});
	}

	async vote(
		applicationId: string,
		params: {
			userId: string;
			userName: string;
			voteType: "approve" | "reject";
		}
	): Promise<ApplicationVote> {
		return this.client.request<ApplicationVote>(`/api/users/applications/${applicationId}/vote`, {
			method: "POST",
			body: JSON.stringify(params),
		});
	}
}

class UsersNamespace {
	constructor(private client: CartelClient) {}

	async list(params?: {
		role?: "authenticated" | "member" | "admin";
		limit?: number;
		offset?: number;
		includeIdentities?: boolean;
	}): Promise<{
		users: User[];
		total: number;
		limit: number;
		offset: number;
	}> {
		const searchParams = new URLSearchParams();
		if (params?.role) searchParams.set("role", params.role);
		if (params?.limit) searchParams.set("limit", params.limit.toString());
		if (params?.offset) searchParams.set("offset", params.offset.toString());
		if (params?.includeIdentities) searchParams.set("includeIdentities", params.includeIdentities.toString());

		const queryString = searchParams.toString();
		const endpoint = queryString ? `/api/users?${queryString}` : "/api/users";
		
		return this.client.request(endpoint);
	}

	async getMembers(params?: {
		limit?: number;
		offset?: number;
		includeIdentities?: boolean;
	}): Promise<{
		members: User[];
		total: number;
		limit: number;
		offset: number;
	}> {
		const searchParams = new URLSearchParams();
		if (params?.limit) searchParams.set("limit", params.limit.toString());
		if (params?.offset) searchParams.set("offset", params.offset.toString());
		if (params?.includeIdentities) searchParams.set("includeIdentities", params.includeIdentities.toString());

		const queryString = searchParams.toString();
		const endpoint = queryString ? `/api/users/members?${queryString}` : "/api/users/members";
		
		return this.client.request(endpoint);
	}

	async getByDiscordId(discordId: string): Promise<{ id: string }> {
		return this.client.request<{ id: string }>(`/api/users/id/discord/${discordId}`);
	}

	async getByIdentity(identity: UserIdentityLookup): Promise<User> {
		return this.client.request<User>("/api/users/identities/lookup", {
			method: "POST",
			body: JSON.stringify(identity),
		});
	}

	async addIdentity(params: {
		userId: string;
		platform: string;
		identity: string;
		isPrimary?: boolean;
	}): Promise<UserIdentity> {
		return this.client.request<UserIdentity>("/api/users/identities", {
			method: "POST",
			body: JSON.stringify({
				...params,
				isPrimary: params.isPrimary ?? false,
			}),
		});
	}

	async removeIdentity(userId: string, platform: string, identity: string): Promise<SuccessResponse> {
		return this.client.request<SuccessResponse>(
			`/api/users/identities/${userId}/${platform}/${identity}`,
			{
				method: "DELETE",
			},
		);
	}
}

class ProjectsNamespace {
	constructor(private client: CartelClient) {}

	async list(params?: {
		search?: string;
		tags?: string;
		userId?: string;
		public?: "true" | "false" | "all";
		limit?: number;
		offset?: number;
	}): Promise<Project[]> {
		const searchParams = new URLSearchParams();
		if (params?.search) searchParams.set("search", params.search);
		if (params?.tags) searchParams.set("tags", params.tags);
		if (params?.userId) searchParams.set("userId", params.userId);
		if (params?.public) searchParams.set("public", params.public);
		if (params?.limit) searchParams.set("limit", params.limit.toString());
		if (params?.offset) searchParams.set("offset", params.offset.toString());

		const queryString = searchParams.toString();
		const endpoint = queryString ? `/api/projects?${queryString}` : "/api/projects";
		
		return this.client.request<Project[]>(endpoint);
	}

	async create(params: {
		title: string;
		description: string;
		githubUrl?: string | null;
		deploymentUrl?: string | null;
		tags?: string[];
		isPublic?: boolean;
	}): Promise<Project> {
		return this.client.request<Project>("/api/projects", {
			method: "POST",
			body: JSON.stringify(params),
		});
	}

	async get(projectId: string): Promise<Project> {
		return this.client.request<Project>(`/api/projects/${projectId}`);
	}

	async update(
		projectId: string,
		params: {
			title?: string;
			description?: string;
			githubUrl?: string | null;
			deploymentUrl?: string | null;
			tags?: string[];
			isPublic?: boolean;
		}
	): Promise<Project> {
		return this.client.request<Project>(`/api/projects/${projectId}`, {
			method: "PATCH",
			body: JSON.stringify(params),
		});
	}

	async delete(projectId: string): Promise<SuccessResponse> {
		return this.client.request<SuccessResponse>(`/api/projects/${projectId}`, {
			method: "DELETE",
		});
	}

	async getUserProjects(userId: string): Promise<Project[]> {
		return this.client.request<Project[]>(`/api/projects/user/${userId}`);
	}
}

class LogsNamespace {
	constructor(private client: CartelClient) {}

	async list(params?: Partial<LogQuery>): Promise<LogsListResponse> {
		const queryParams = new URLSearchParams();
		
		if (params) {
			Object.entries(params).forEach(([key, value]) => {
				if (value !== undefined && value !== null) {
					if (Array.isArray(value)) {
						queryParams.set(key, value.join(','));
					} else {
						queryParams.set(key, String(value));
					}
				}
			});
		}

		const queryString = queryParams.toString();
		const path = `/api/admin/logs${queryString ? `?${queryString}` : ''}`;
		
		return this.client.request<LogsListResponse>(path);
	}

	async getStats(): Promise<LogStatsResponse> {
		return this.client.request<LogStatsResponse>('/api/admin/logs/stats');
	}

	async cleanup(days?: number): Promise<LogCleanupResponse> {
		const queryParams = new URLSearchParams();
		if (days !== undefined) {
			queryParams.set('days', String(days));
		}
		
		const queryString = queryParams.toString();
		const path = `/api/admin/logs/cleanup${queryString ? `?${queryString}` : ''}`;
		
		return this.client.request<LogCleanupResponse>(path, {
			method: 'DELETE',
		});
	}
}

export class CartelClient {
	tokenStorage: TokenStorage;
	private refreshPromise: Promise<void> | null = null;

	auth: AuthNamespace;
	vanish: VanishNamespace;
	practice: PracticeNamespace;
	applications: ApplicationsNamespace;
	users: UsersNamespace;
	projects: ProjectsNamespace;
	logs: LogsNamespace;

	constructor(
		private baseUrl: string,
		private apiKey?: string,
		tokenStorage?: TokenStorage,
	) {
		this.tokenStorage = tokenStorage || 
			(typeof window !== "undefined" 
				? new LocalStorageTokenStorage() 
				: new InMemoryTokenStorage());

		// Initialize namespaces
		this.auth = new AuthNamespace(this);
		this.vanish = new VanishNamespace(this);
		this.practice = new PracticeNamespace(this);
		this.applications = new ApplicationsNamespace(this);
		this.users = new UsersNamespace(this);
		this.projects = new ProjectsNamespace(this);
		this.logs = new LogsNamespace(this);
	}

	async request<T = any>(
		path: string,
		options: RequestInit & { skipAuth?: boolean } = {},
	): Promise<T> {
		const headers: any = {
			"Content-Type": "application/json",
			...options.headers,
		};

		// Include API key if provided (for initial auth)
		if (this.apiKey) {
			headers["X-API-Key"] = this.apiKey;
		}

		// Include bearer token if available and not skipped
		if (!options.skipAuth) {
			const accessToken = this.tokenStorage.getAccessToken();
			
			if (accessToken) {
				headers["Authorization"] = `Bearer ${accessToken}`;
			} else {
				// Try to refresh if we have a refresh token
				const refreshToken = this.tokenStorage.getRefreshToken();
				if (refreshToken && !this.refreshPromise) {
					// Prevent multiple simultaneous refresh attempts
					this.refreshPromise = this.auth.refresh()
						.then(() => {
							this.refreshPromise = null;
						})
						.catch((error) => {
							this.refreshPromise = null;
							throw error;
						});
					
					await this.refreshPromise;
					
					// Get the new access token
					const newAccessToken = this.tokenStorage.getAccessToken();
					if (newAccessToken) {
						headers["Authorization"] = `Bearer ${newAccessToken}`;
					}
				}
			}
		}

		const { skipAuth, ...fetchOptions } = options;
		const response = await fetch(`${this.baseUrl}${path}`, {
			...fetchOptions,
			headers,
		});

		if (!response.ok) {
			// If we get 401 and have a refresh token, try to refresh once
			if (response.status === 401 && !options.skipAuth) {
				const refreshToken = this.tokenStorage.getRefreshToken();
				if (refreshToken && !this.refreshPromise) {
					await this.auth.refresh();
					
					// Retry the request with new token
					const newAccessToken = this.tokenStorage.getAccessToken();
					if (newAccessToken) {
						headers["Authorization"] = `Bearer ${newAccessToken}`;
						const retryResponse = await fetch(`${this.baseUrl}${path}`, {
							...fetchOptions,
							headers,
						});
						
						if (retryResponse.ok) {
							return retryResponse.json() as Promise<T>;
						}
					}
				}
			}

			const error = await response.text();
			throw new Error(`API Error (${response.status}): ${error}`);
		}

		return response.json() as Promise<T>;
	}
}

// Export token storage implementations for custom usage
export { InMemoryTokenStorage, LocalStorageTokenStorage };