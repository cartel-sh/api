type UserIdentityLookup = {
  evm?: string;
  lens?: string;
  farcaster?: string;
  telegram?: string;
  discord?: string;
};

export class CartelDBClient {
  constructor(
    private baseUrl: string,
    private apiKey?: string,
  ) {}

  private async request<T = any>(path: string, options: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(this.apiKey && { "X-API-Key": this.apiKey }),
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API Error (${response.status}): ${error}`);
    }

    return response.json() as Promise<T>;
  }

  // Vanishing Channels - Discord
  async setVanishingChannel(channelId: string, guildId: string, duration: number) {
    return this.request("/api/discord/vanish", {
      method: "POST",
      body: JSON.stringify({ channelId, guildId, duration }),
    });
  }

  async removeVanishingChannel(channelId: string) {
    return this.request(`/api/discord/vanish/${channelId}`, {
      method: "DELETE",
    });
  }

  async getVanishingChannels(guildId?: string) {
    const query = guildId ? `?guildId=${guildId}` : "";
    return this.request(`/api/discord/vanish${query}`);
  }

  async getVanishingChannel(channelId: string) {
    return this.request(`/api/discord/vanish/${channelId}`);
  }

  async updateVanishingChannelStats(channelId: string, deletedCount: number) {
    return this.request(`/api/discord/vanish/${channelId}/stats`, {
      method: "PATCH",
      body: JSON.stringify({ deletedCount }),
    });
  }

  // Channel Settings - Discord
  async setChannel(guildId: string, key: string, channelId: string) {
    return this.request(`/api/discord/channels/${guildId}/${key}`, {
      method: "PUT",
      body: JSON.stringify({ channelId }),
    });
  }

  async getChannel(guildId: string, key: string) {
    return this.request(`/api/discord/channels/${guildId}/${key}`);
  }

  async getGuildChannels(guildId: string) {
    return this.request(`/api/discord/channels/${guildId}`);
  }

  async deleteChannel(guildId: string, key: string) {
    return this.request(`/api/discord/channels/${guildId}/${key}`, {
      method: "DELETE",
    });
  }

  async deleteGuildChannels(guildId: string) {
    return this.request(`/api/discord/channels/${guildId}`, {
      method: "DELETE",
    });
  }

  // Practice Sessions
  async startSession(params: {
    discordId?: string;
    userId?: string;
    notes?: string;
  }) {
    if (!params.discordId && !params.userId) {
      throw new Error("Either discordId or userId must be provided");
    }
    
    return this.request("/api/sessions/practice/start", {
      method: "POST",
      body: JSON.stringify(params),
    });
  }

  async stopSession(params: {
    discordId?: string;
    userId?: string;
  }) {
    if (!params.discordId && !params.userId) {
      throw new Error("Either discordId or userId must be provided");
    }
    
    return this.request("/api/sessions/practice/stop", {
      method: "POST",
      body: JSON.stringify(params),
    });
  }

  // Discord-based stats
  async getDailyStats(discordId: string) {
    const response = await this.request<{ totalDuration: number }>(
      `/api/sessions/practice/stats/daily/discord/${discordId}`,
    );
    return response.totalDuration;
  }

  async getWeeklyStats(discordId: string) {
    return this.request<Record<string, number>>(
      `/api/sessions/practice/stats/weekly/discord/${discordId}`,
    );
  }

  async getMonthlyStats(discordId: string) {
    return this.request<Record<string, number>>(
      `/api/sessions/practice/stats/monthly/discord/${discordId}`,
    );
  }

  // User UUID-based stats
  async getDailyStatsByUserId(userId: string) {
    const response = await this.request<{ totalDuration: number }>(
      `/api/sessions/practice/stats/daily/user/${userId}`,
    );
    return response.totalDuration;
  }

  async getWeeklyStatsByUserId(userId: string) {
    return this.request<Record<string, number>>(
      `/api/sessions/practice/stats/weekly/user/${userId}`,
    );
  }

  async getMonthlyStatsByUserId(userId: string) {
    return this.request<Record<string, number>>(
      `/api/sessions/practice/stats/monthly/user/${userId}`,
    );
  }

  async getTopUsers() {
    return this.request<Array<{ identity: string; totalDuration: number }>>(
      "/api/sessions/practice/leaderboard",
    );
  }

  async getTotalTrackedHours() {
    const response = await this.request<{ totalHours: number }>(
      "/api/sessions/practice/total-hours",
    );
    return response.totalHours;
  }

  // Applications
  async createApplication(data: {
    messageId: string;
    walletAddress: string;
    ensName?: string | null;
    github?: string | null;
    farcaster?: string | null;
    lens?: string | null;
    twitter?: string | null;
    excitement: string;
    motivation: string;
    signature: string;
  }) {
    return this.request<{ id: string; applicationNumber: number }>(
      "/api/users/applications",
      {
        method: "POST",
        body: JSON.stringify(data),
      },
    );
  }

  async getPendingApplications() {
    return this.request("/api/users/applications/pending");
  }

  async getApplicationByMessageId(messageId: string) {
    return this.request(`/api/users/applications/by-message/${messageId}`);
  }

  async getApplicationByNumber(applicationNumber: number) {
    return this.request(`/api/users/applications/by-number/${applicationNumber}`);
  }

  async updateApplicationStatus(
    applicationId: string,
    status: "approved" | "rejected",
  ) {
    return this.request(`/api/users/applications/${applicationId}/status`, {
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
    return this.request(`/api/users/applications/${applicationId}/votes`, {
      method: "POST",
      body: JSON.stringify({ userId, userName, voteType }),
    });
  }

  async getVotes(applicationId: string) {
    return this.request(`/api/users/applications/${applicationId}/votes`);
  }

  // User Identities
  
  async getUser(identity: UserIdentityLookup) {
    if (identity.evm) {
      return this.getUserByEvm(identity.evm);
    } else if (identity.lens) {
      return this.getUserByLens(identity.lens);
    } else if (identity.farcaster) {
      return this.getUserByFarcaster(identity.farcaster);
    } else if (identity.telegram) {
      return this.getUserByTelegram(identity.telegram);
    } else if (identity.discord) {
      return this.getUserByDiscord(identity.discord);
    } else {
      throw new Error("At least one identity type must be provided");
    }
  }

  // Individual methods for backward compatibility and direct access
  async getUserByEvm(address: string) {
    return this.request(`/api/users/id/by-evm/${address}`);
  }

  async getUserByLens(address: string) {
    return this.request(`/api/users/id/by-lens/${address}`);
  }

  async getUserByFarcaster(fid: string) {
    return this.request(`/api/users/id/by-farcaster/${fid}`);
  }

  async getUserByTelegram(telegramId: string) {
    return this.request(`/api/users/id/by-telegram/${telegramId}`);
  }

  async getUserByDiscord(discordId: string) {
    return this.request(`/api/users/id/by-discord/${discordId}`);
  }

  async getUserIdentities(userId: string) {
    return this.request(`/api/users/identities/${userId}`);
  }

  async createUserIdentity(data: {
    platform: "discord" | "evm" | "lens" | "farcaster" | "telegram";
    identity: string;
    isPrimary?: boolean;
  }) {
    return this.request("/api/users/id", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  // Admin: Identity Management
  async connectIdentity(data: {
    userId: string;
    platform: "discord" | "evm" | "lens" | "farcaster" | "telegram";
    identity: string;
    isPrimary?: boolean;
  }) {
    return this.request("/api/admin/identities/connect", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async disconnectIdentity(data: {
    platform: "discord" | "evm" | "lens" | "farcaster" | "telegram";
    identity: string;
  }) {
    return this.request("/api/admin/identities/disconnect", {
      method: "DELETE",
      body: JSON.stringify(data),
    });
  }

  async setPrimaryIdentity(data: {
    platform: "discord" | "evm" | "lens" | "farcaster" | "telegram";
    identity: string;
  }) {
    return this.request("/api/admin/identities/set-primary", {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async mergeUsers(sourceUserId: string, targetUserId: string) {
    return this.request("/api/admin/identities/merge-users", {
      method: "POST",
      body: JSON.stringify({ sourceUserId, targetUserId }),
    });
  }

  // Projects
  async getProjects(params?: {
    search?: string;
    tags?: string;
    userId?: string;
    public?: "true" | "false" | "all";
    limit?: number;
    offset?: number;
  }) {
    const query = params ? `?${new URLSearchParams(params as any).toString()}` : "";
    return this.request(`/api/projects${query}`);
  }

  async getProject(projectId: string) {
    return this.request(`/api/projects/${projectId}`);
  }

  async getUserProjects(userId: string) {
    return this.request(`/api/projects/user/${userId}`);
  }

  async createProject(data: {
    title: string;
    description: string;
    githubUrl?: string | null;
    deploymentUrl?: string | null;
    tags?: string[];
    isPublic?: boolean;
  }) {
    return this.request("/api/projects", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async updateProject(
    projectId: string,
    data: {
      title?: string;
      description?: string;
      githubUrl?: string | null;
      deploymentUrl?: string | null;
      tags?: string[];
      isPublic?: boolean;
    }
  ) {
    return this.request(`/api/projects/${projectId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  async deleteProject(projectId: string) {
    return this.request(`/api/projects/${projectId}`, {
      method: "DELETE",
    });
  }

  async getPopularProjectTags() {
    return this.request("/api/projects/tags/popular");
  }
}