type UserIdentityLookup = {
	evm?: string;
	lens?: string;
	farcaster?: string;
	telegram?: string;
	discord?: string;
};

export interface AuthResponse {
	accessToken: string;
	refreshToken: string;
	expiresIn: number;
	tokenType: "Bearer";
	userId: string;
	address: string;
	clientName?: string;
}

export interface RefreshResponse {
	accessToken: string;
	refreshToken: string;
	expiresIn: number;
	tokenType: "Bearer";
}

export interface SiweVerifyRequest {
	message: string;
	signature: string;
}

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

export class CartelClient {
	private tokenStorage: TokenStorage;
	private refreshPromise: Promise<void> | null = null;

	constructor(
		private baseUrl: string,
		private apiKey?: string,
		tokenStorage?: TokenStorage,
	) {
		this.tokenStorage = tokenStorage || 
			(typeof window !== "undefined" 
				? new LocalStorageTokenStorage() 
				: new InMemoryTokenStorage());
	}

	// Authentication Methods

	/**
	 * Verify SIWE signature and authenticate
	 * Client should generate SIWE message and get signature from wallet
	 * @param message - The complete SIWE message that was signed
	 * @param signature - The signature from the wallet
	 * @returns Authentication response with tokens
	 */
	async verifySiwe(message: string, signature: string): Promise<AuthResponse> {
		const response = await this.request<AuthResponse>("/api/auth/verify", {
			method: "POST",
			body: JSON.stringify({ message, signature }),
			skipAuth: true, // Don't use bearer token for login
		});

		this.tokenStorage.setTokens(
			response.accessToken,
			response.refreshToken,
			response.expiresIn,
		);

		return response;
	}

	/**
	 * Refresh access token using refresh token
	 */
	async refreshAccessToken(): Promise<RefreshResponse> {
		const refreshToken = this.tokenStorage.getRefreshToken();
		
		if (!refreshToken) {
			throw new Error("No refresh token available");
		}

		const response = await this.request<RefreshResponse>("/api/auth/refresh", {
			method: "POST",
			body: JSON.stringify({ refreshToken }),
			skipAuth: true, // Don't use bearer token for refresh
		});

		// Update stored tokens
		this.tokenStorage.setTokens(
			response.accessToken,
			response.refreshToken,
			response.expiresIn,
		);

		return response;
	}

	/**
	 * Get current authenticated user info
	 * Requires valid access token
	 */
	async getCurrentUser() {
		return this.request("/api/auth/me");
	}

	/**
	 * Revoke all tokens for the current user
	 */
	async revokeTokens() {
		const response = await this.request("/api/auth/revoke", {
			method: "POST",
		});
		
		// Clear stored tokens
		this.tokenStorage.clearTokens();
		
		return response;
	}

	/**
	 * Clear stored tokens (local logout)
	 */
	logout() {
		this.tokenStorage.clearTokens();
	}

	private async request<T = any>(
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
					this.refreshPromise = this.refreshAccessToken()
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
					await this.refreshAccessToken();
					
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

	// Vanishing Channels - Discord
	async setVanishingChannel(
		channelId: string,
		guildId: string,
		duration: number,
	) {
		return this.request("/api/vanish/discord", {
			method: "POST",
			body: JSON.stringify({ channelId, guildId, duration }),
		});
	}

	async removeVanishingChannel(channelId: string) {
		return this.request(`/api/vanish/discord/${channelId}`, {
			method: "DELETE",
		});
	}

	async getVanishingChannels(guildId?: string) {
		const params = guildId ? `?guildId=${guildId}` : "";
		return this.request(`/api/vanish/discord${params}`);
	}

	async getVanishingChannel(channelId: string) {
		return this.request(`/api/vanish/discord/${channelId}`);
	}

	async updateVanishingChannelStats(channelId: string, deletedCount: number) {
		return this.request(`/api/vanish/discord/${channelId}/stats`, {
			method: "PATCH",
			body: JSON.stringify({ deletedCount }),
		});
	}

	// Practice Sessions
	async startSession(params: {
		discordId?: string;
		userId?: string;
		notes?: string;
	}) {
		return this.request("/api/sessions/practice", {
			method: "POST",
			body: JSON.stringify(params),
		});
	}

	async stopSession(params: { discordId?: string; userId?: string }) {
		return this.request("/api/sessions/practice/stop", {
			method: "POST",
			body: JSON.stringify(params),
		});
	}

	async getDailyStats(discordId: string): Promise<number> {
		return this.request(`/api/sessions/practice/stats/daily/${discordId}`);
	}

	async getWeeklyStats(discordId: string): Promise<Record<string, number>> {
		return this.request(`/api/sessions/practice/stats/weekly/${discordId}`);
	}

	// Applications
	async createApplication(params: {
		messageId: string;
		guildId: string;
		channelId: string;
		applicantId: string;
		applicantName: string;
		responses: Record<string, string>;
		applicationNumber: number;
	}) {
		return this.request<{
			id: string;
			messageId: string;
			guildId: string;
			channelId: string;
			applicantId: string;
			applicantName: string;
			responses: Record<string, string>;
			status: string;
			applicationNumber: number;
		}>("/api/users/applications", {
			method: "POST",
			body: JSON.stringify(params),
		});
	}

	async getPendingApplications() {
		return this.request("/api/users/applications/pending");
	}

	async getApplicationByMessageId(messageId: string) {
		return this.request(`/api/users/applications/message/${messageId}`);
	}

	async getApplicationByNumber(applicationNumber: number) {
		return this.request(`/api/users/applications/number/${applicationNumber}`);
	}

	async updateApplicationStatus(
		applicationId: string,
		status: "approved" | "rejected",
	) {
		return this.request(`/api/users/applications/${applicationId}`, {
			method: "PATCH",
			body: JSON.stringify({ status }),
		});
	}

	async deleteApplication(applicationId: string) {
		return this.request(`/api/users/applications/${applicationId}`, {
			method: "DELETE",
		});
	}

	async addVote(
		applicationId: string,
		userId: string,
		userName: string,
		voteType: "approve" | "reject",
	) {
		return this.request(`/api/users/applications/${applicationId}/vote`, {
			method: "POST",
			body: JSON.stringify({ userId, userName, voteType }),
		});
	}

	// User Identities
	async getUserByDiscordId(discordId: string): Promise<{ id: string }> {
		return this.request(`/api/users/id/discord/${discordId}`);
	}

	async getUserByIdentity(identity: UserIdentityLookup) {
		return this.request("/api/users/identities/lookup", {
			method: "POST",
			body: JSON.stringify(identity),
		});
	}

	async addUserIdentity(
		userId: string,
		platform: string,
		identity: string,
		isPrimary = false,
	) {
		return this.request("/api/users/identities", {
			method: "POST",
			body: JSON.stringify({ userId, platform, identity, isPrimary }),
		});
	}

	async removeUserIdentity(userId: string, platform: string, identity: string) {
		return this.request(
			`/api/users/identities/${userId}/${platform}/${identity}`,
			{
				method: "DELETE",
			},
		);
	}

	// Projects
	async createProject(params: {
		name: string;
		description?: string;
		metadata?: Record<string, any>;
	}) {
		return this.request("/api/projects", {
			method: "POST",
			body: JSON.stringify(params),
		});
	}

	async getProject(projectId: string) {
		return this.request(`/api/projects/${projectId}`);
	}

	async updateProject(
		projectId: string,
		updates: {
			name?: string;
			description?: string;
			metadata?: Record<string, any>;
		},
	) {
		return this.request(`/api/projects/${projectId}`, {
			method: "PATCH",
			body: JSON.stringify(updates),
		});
	}

	async deleteProject(projectId: string) {
		return this.request(`/api/projects/${projectId}`, {
			method: "DELETE",
		});
	}

	async getUserProjects(userId: string) {
		return this.request(`/api/projects/user/${userId}`);
	}
}

// Export token storage implementations for custom usage
export { InMemoryTokenStorage, LocalStorageTokenStorage };