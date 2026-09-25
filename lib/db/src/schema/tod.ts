import {
  pgTable,
  text,
  serial,
  integer,
  boolean,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/** Per-guild Truth or Dare settings + player progress. */

export const todPlayersTable = pgTable(
  "tod_players",
  {
    id: serial("id").primaryKey(),
    guildId: text("guild_id").notNull(),
    userId: text("user_id").notNull(),
    username: text("username").notNull(),
    displayName: text("display_name").notNull(),

    truthsCompleted: integer("truths_completed").notNull().default(0),
    daresCompleted: integer("dares_completed").notNull().default(0),
    challengesIssued: integer("challenges_issued").notNull().default(0),
    challengesAccepted: integer("challenges_accepted").notNull().default(0),
    challengesCompleted: integer("challenges_completed").notNull().default(0),
    challengesPassed: integer("challenges_passed").notNull().default(0),
    wins: integer("wins").notNull().default(0),
    losses: integer("losses").notNull().default(0),

    currentStreak: integer("current_streak").notNull().default(0),
    bestStreak: integer("best_streak").notNull().default(0),
    dailyStreak: integer("daily_streak").notNull().default(0),
    lastCompletedDate: text("last_completed_date"),

    /** Game score (TOD "coins") — also optionally mirrored to clanPoints. */
    todPoints: integer("tod_points").notNull().default(0),
    titleKey: text("title_key"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("tod_players_guild_user_uidx").on(t.guildId, t.userId)]
);

export const todChallengesTable = pgTable(
  "tod_challenges",
  {
    id: serial("id").primaryKey(),
    guildId: text("guild_id").notNull(),
    channelId: text("channel_id").notNull(),
    messageId: text("message_id"),

    kind: text("kind").notNull(), // truth | dare | spin | challenge | random
    status: text("status").notNull().default("active"), // active | completed | passed | expired | cancelled

    challengerId: text("challenger_id"),
    targetId: text("target_id").notNull(),
    targetUsername: text("target_username").notNull(),

    contentId: text("content_id"),
    contentType: text("content_type"), // truth | dare
    category: text("category"),
    difficulty: text("difficulty"),
    promptText: text("prompt_text").notNull(),
    requiresProof: boolean("requires_proof").notNull().default(false),
    highStakes: boolean("high_stakes").notNull().default(false),
    rewardPoints: integer("reward_points").notNull().default(0),
    passPenalty: integer("pass_penalty").notNull().default(0),

    expiresAt: timestamp("expires_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("tod_challenges_guild_status_idx").on(t.guildId, t.status),
    index("tod_challenges_target_idx").on(t.guildId, t.targetId, t.status),
  ]
);

export const todAnonymousTable = pgTable(
  "tod_anonymous",
  {
    id: serial("id").primaryKey(),
    guildId: text("guild_id").notNull(),
    channelId: text("channel_id"),
    messageId: text("message_id"),
    /** Stored for moderation only — never shown publicly. */
    authorId: text("author_id").notNull(),
    body: text("body").notNull(),
    guessUserId: text("guess_user_id"),
    guessCorrect: boolean("guess_correct"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("tod_anonymous_guild_idx").on(t.guildId)]
);

export const todCustomContentTable = pgTable(
  "tod_custom_content",
  {
    id: serial("id").primaryKey(),
    guildId: text("guild_id").notNull(),
    contentKey: text("content_key").notNull(),
    type: text("type").notNull(), // truth | dare
    category: text("category").notNull(),
    difficulty: text("difficulty").notNull(),
    text: text("text").notNull(),
    requiresProof: boolean("requires_proof").notNull().default(false),
    enabled: boolean("enabled").notNull().default(true),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("tod_custom_content_guild_key_uidx").on(t.guildId, t.contentKey),
  ]
);

export type TodPlayer = typeof todPlayersTable.$inferSelect;
export type TodChallenge = typeof todChallengesTable.$inferSelect;
export type TodAnonymous = typeof todAnonymousTable.$inferSelect;
export type TodCustomContent = typeof todCustomContentTable.$inferSelect;

export const insertTodPlayerSchema = createInsertSchema(todPlayersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertTodPlayer = z.infer<typeof insertTodPlayerSchema>;
