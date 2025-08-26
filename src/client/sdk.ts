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

  // Vanishing Channels
  async setVanishingChannel(channelId: string, guildId: string, duration: number) {
    return this.request("/api/vanishing-channels", {
      method: "POST",
      body: JSON.stringify({ channelId, guildId, duration }),
    });
  }

  async removeVanishingChannel(channelId: string) {
    return this.request(`/api/vanishing-channels/${channelId}`, {
      method: "DELETE",
    });
  }

  async getVanishingChannels(guildId?: string) {
    const query = guildId ? `?guildId=${guildId}` : "";
    return this.request(`/api/vanishing-channels${query}`);
  }

  async getVanishingChannel(channelId: string) {
    return this.request(`/api/vanishing-channels/${channelId}`);
  }

  async updateVanishingChannelStats(channelId: string, deletedCount: number) {
    return this.request(`/api/vanishing-channels/${channelId}/stats`, {
      method: "PATCH",
      body: JSON.stringify({ deletedCount }),
    });
  }

  // Practice Sessions
  async startSession(discordId: string, notes?: string) {
    return this.request("/api/practice-sessions/start", {
      method: "POST",
      body: JSON.stringify({ discordId, notes }),
    });
  }

  async stopSession(discordId: string) {
    return this.request("/api/practice-sessions/stop", {
      method: "POST",
      body: JSON.stringify({ discordId }),
    });
  }

  async getDailyStats(discordId: string) {
    const response = await this.request<{ totalDuration: number }>(
      `/api/practice-sessions/stats/daily/${discordId}`,
    );
    return response.totalDuration;
  }

  async getWeeklyStats(discordId: string) {
    return this.request<Record<string, number>>(
      `/api/practice-sessions/stats/weekly/${discordId}`,
    );
  }

  async getMonthlyStats(discordId: string) {
    return this.request<Record<string, number>>(
      `/api/practice-sessions/stats/monthly/${discordId}`,
    );
  }

  async getTopUsers() {
    return this.request<Array<{ identity: string; totalDuration: number }>>(
      "/api/practice-sessions/leaderboard",
    );
  }

  async getTotalTrackedHours() {
    const response = await this.request<{ totalHours: number }>(
      "/api/practice-sessions/total-hours",
    );
    return response.totalHours;
  }

  // Channel Settings
  async setChannels(config: {
    guildId: string;
    voiceChannelId: string;
    textChannelId: string;
  }) {
    return this.request(`/api/channel-settings/${config.guildId}`, {
      method: "PUT",
      body: JSON.stringify({
        voiceChannelId: config.voiceChannelId,
        textChannelId: config.textChannelId,
      }),
    });
  }

  async getChannels(guildId: string) {
    return this.request(`/api/channel-settings/${guildId}`);
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
      "/api/applications",
      {
        method: "POST",
        body: JSON.stringify(data),
      },
    );
  }

  async getPendingApplications() {
    return this.request("/api/applications/pending");
  }

  async getApplicationByMessageId(messageId: string) {
    return this.request(`/api/applications/by-message/${messageId}`);
  }

  async getApplicationByNumber(applicationNumber: number) {
    return this.request(`/api/applications/by-number/${applicationNumber}`);
  }

  async updateApplicationStatus(
    applicationId: string,
    status: "approved" | "rejected",
  ) {
    return this.request(`/api/applications/${applicationId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
  }

  async deleteApplication(applicationId: string) {
    return this.request(`/api/applications/${applicationId}`, {
      method: "DELETE",
    });
  }

  async addVote(
    applicationId: string,
    userId: string,
    userName: string,
    voteType: "approve" | "reject",
  ) {
    return this.request(`/api/applications/${applicationId}/votes`, {
      method: "POST",
      body: JSON.stringify({ userId, userName, voteType }),
    });
  }

  async getVotes(applicationId: string) {
    return this.request(`/api/applications/${applicationId}/votes`);
  }

  // Users
  async getUserByDiscordId(discordId: string) {
    const response = await this.request<{ userId: string }>(
      `/api/users/by-discord/${discordId}`,
    );
    return response.userId;
  }
}