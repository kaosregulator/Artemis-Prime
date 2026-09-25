import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Daily alt-account contributions for Patriots / Guardians.
 * Independent of warnings / clean standing — its own leaderboard.
 */
export const altDailyLogsTable = pgTable(
  "alt_daily_logs",
  {
    id: serial("id").primaryKey(),
    guildId: text("guild_id").notNull(),
    userId: text("user_id").notNull(),
    username: text("username").notNull(),
    displayName: text("display_name").notNull(),
    /** Clan-local calendar day YYYY-MM-DD. */
    activityDate: text("activity_date").notNull(),
    /** How many alts completed that day (1–100). */
    altCount: integer("alt_count").notNull(),
    /** Who recorded it (self-submit or staff edit). */
    recordedBy: text("recorded_by").notNull(),
    recordedByUsername: text("recorded_by_username").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("alt_daily_logs_guild_user_date_uidx").on(
      t.guildId,
      t.userId,
      t.activityDate
    ),
    index("alt_daily_logs_guild_date_idx").on(t.guildId, t.activityDate),
  ]
);

export const insertAltDailyLogSchema = createInsertSchema(altDailyLogsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAltDailyLog = z.infer<typeof insertAltDailyLogSchema>;
export type AltDailyLog = typeof altDailyLogsTable.$inferSelect;
