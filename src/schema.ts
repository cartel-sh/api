import {
  type InferInsertModel,
  type InferSelectModel,
  relations,
} from "drizzle-orm";
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const usersRelations = relations(users, ({ many }) => ({
  identities: many(userIdentities),
  practiceSessions: many(practiceSessions),
  apiKeys: many(apiKeys),
}));

export const userIdentities = pgTable(
  "user_identities",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(), // 'discord', 'evm', 'lens'
    identity: text("identity").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => {
    return {
      pk: primaryKey({ columns: [table.platform, table.identity] }),
      userIdIdx: index("user_identities_user_id_idx").on(table.userId),
    };
  },
);

export const userIdentitiesRelations = relations(userIdentities, ({ one }) => ({
  user: one(users, {
    fields: [userIdentities.userId],
    references: [users.id],
  }),
}));

export const vanishingChannels = pgTable(
  "vanishing_channels",
  {
    channelId: text("channel_id").primaryKey(),
    guildId: text("guild_id").notNull(),
    vanishAfter: integer("vanish_after").notNull(), // duration in seconds
    messagesDeleted: integer("messages_deleted").default(0),
    lastDeletion: timestamp("last_deletion", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => {
    return {
      guildIdx: index("vanishing_channels_guild_idx").on(table.guildId),
    };
  },
);

export const practiceSessions = pgTable(
  "practice_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    startTime: timestamp("start_time", { withTimezone: true }).notNull(),
    endTime: timestamp("end_time", { withTimezone: true }),
    duration: integer("duration"), // duration in seconds
    date: text("date").notNull(), // Using text to store YYYY-MM-DD format
    notes: text("notes"),
  },
  (table) => {
    return {
      userDateIdx: index("practice_sessions_user_date_idx").on(
        table.userId,
        table.date,
      ),
      activeIdx: index("practice_sessions_active_idx")
        .on(table.userId)
        .where(sql`${table.endTime} IS NULL`),
    };
  },
);

export const practiceSessionsRelations = relations(
  practiceSessions,
  ({ one }) => ({
    user: one(users, {
      fields: [practiceSessions.userId],
      references: [users.id],
    }),
  }),
);

export const channelSettings = pgTable(
  "channel_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    guildId: text("guild_id").notNull(),
    key: text("key").notNull(), // e.g., 'voice', 'text', 'alerts', etc.
    channelId: text("channel_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => {
    return {
      guildKeyIdx: index("channel_settings_guild_key_idx").on(
        table.guildId,
        table.key,
      ),
    };
  },
);

export interface User extends InferSelectModel<typeof users> {}
export interface NewUser extends InferInsertModel<typeof users> {}

export interface UserIdentity extends InferSelectModel<typeof userIdentities> {}
export interface NewUserIdentity
  extends InferInsertModel<typeof userIdentities> {}

export interface VanishingChannel
  extends InferSelectModel<typeof vanishingChannels> {
  messagesDeleted: number;
  lastDeletion: Date | null;
}
export interface NewVanishingChannel
  extends InferInsertModel<typeof vanishingChannels> {}

export interface PracticeSession
  extends InferSelectModel<typeof practiceSessions> {
  endTime: Date | null;
  duration: number | null;
  notes: string | null;
}
export interface NewPracticeSession
  extends InferInsertModel<typeof practiceSessions> {}

export interface ChannelSetting
  extends InferSelectModel<typeof channelSettings> {}
export interface NewChannelSetting
  extends InferInsertModel<typeof channelSettings> {}

export const applications = pgTable(
  "applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    applicationNumber: integer("application_number").notNull().unique(),
    messageId: text("message_id").notNull().unique(),
    walletAddress: text("wallet_address").notNull(),
    ensName: text("ens_name"),
    github: text("github"),
    farcaster: text("farcaster"),
    lens: text("lens"),
    twitter: text("twitter"),
    excitement: text("excitement").notNull(),
    motivation: text("motivation").notNull(),
    signature: text("signature").notNull(),
    status: text("status").default("pending"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).defaultNow(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (table) => {
    return {
      statusIdx: index("applications_status_idx").on(table.status),
      walletIdx: index("applications_wallet_idx").on(table.walletAddress),
    };
  },
);

export const applicationVotes = pgTable(
  "application_votes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    userName: text("user_name"),
    voteType: text("vote_type").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => {
    return {
      pk: primaryKey({ columns: [table.applicationId, table.userId] }),
      applicationIdx: index("votes_application_idx").on(table.applicationId),
    };
  },
);

export const applicationsRelations = relations(applications, ({ many }) => ({
  votes: many(applicationVotes),
}));

export const applicationVotesRelations = relations(
  applicationVotes,
  ({ one }) => ({
    application: one(applications, {
      fields: [applicationVotes.applicationId],
      references: [applications.id],
    }),
  }),
);

export interface Application extends InferSelectModel<typeof applications> {}
export interface NewApplication extends InferInsertModel<typeof applications> {}
export interface ApplicationVote
  extends InferSelectModel<typeof applicationVotes> {}
export interface NewApplicationVote
  extends InferInsertModel<typeof applicationVotes> {}

export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    keyPrefix: text("key_prefix").notNull().unique(), // First 8 chars for identification
    keyHash: text("key_hash").notNull().unique(), // SHA-256 hash of full key
    description: text("description"),
    scopes: text("scopes").array().default(sql`ARRAY['read', 'write']::text[]`),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    isActive: boolean("is_active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => {
    return {
      userIdIdx: index("api_keys_user_id_idx").on(table.userId),
      keyPrefixIdx: index("api_keys_prefix_idx")
        .on(table.keyPrefix)
        .where(sql`${table.isActive} = true`),
      expiresAtIdx: index("api_keys_expires_idx")
        .on(table.expiresAt)
        .where(sql`${table.isActive} = true`),
    };
  },
);

export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  user: one(users, {
    fields: [apiKeys.userId],
    references: [users.id],
  }),
}));

export interface ApiKey extends InferSelectModel<typeof apiKeys> {
  scopes: string[];
}
export interface NewApiKey extends InferInsertModel<typeof apiKeys> {}
