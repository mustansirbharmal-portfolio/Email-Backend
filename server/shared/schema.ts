import { pgTable, text, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// User schema
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  email: text("email"),
  name: text("name"),
  gmailConnected: boolean("gmail_connected").default(false),
  gmailRefreshToken: text("gmail_refresh_token"),
  gmailEmail: text("gmail_email"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
  email: true,
  name: true,
});

// Email recipients schema
export const recipients = pgTable("recipients", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  email: text("email").notNull(),
  name: text("name"),
  listId: integer("list_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertRecipientSchema = createInsertSchema(recipients).pick({
  userId: true,
  email: true,
  name: true,
  listId: true,
});

// Recipient lists schema
export const recipientLists = pgTable("recipient_lists", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertRecipientListSchema = createInsertSchema(recipientLists).pick({
  userId: true,
  name: true,
  description: true,
});

// Emails schema
export const emails = pgTable("emails", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  to: text("to"),
  listId: integer("list_id"),
  status: text("status").notNull().default("draft"), // draft, sent, scheduled, failed
  scheduledFor: timestamp("scheduled_for"),
  sentAt: timestamp("sent_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertEmailSchema = createInsertSchema(emails).pick({
  userId: true,
  subject: true,
  body: true,
  to: true,
  listId: true,
  status: true,
  scheduledFor: true,
});

// Email activity schema (opens, clicks, etc.)
export const emailActivities = pgTable("email_activities", {
  id: serial("id").primaryKey(),
  emailId: integer("email_id").notNull(),
  type: text("type").notNull(), // open, click, bounce
  recipientEmail: text("recipient_email").notNull(),
  timestamp: timestamp("timestamp").defaultNow(),
});

export const insertEmailActivitySchema = createInsertSchema(emailActivities).pick({
  emailId: true,
  type: true,
  recipientEmail: true,
});

// Type definitions
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;

export type Recipient = typeof recipients.$inferSelect;
export type InsertRecipient = z.infer<typeof insertRecipientSchema>;

export type RecipientList = typeof recipientLists.$inferSelect;
export type InsertRecipientList = z.infer<typeof insertRecipientListSchema>;

export type Email = typeof emails.$inferSelect;
export type InsertEmail = z.infer<typeof insertEmailSchema>;

export type EmailActivity = typeof emailActivities.$inferSelect;
export type InsertEmailActivity = z.infer<typeof insertEmailActivitySchema>;

// Validation schemas for API
export const loginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

export const sendEmailSchema = z.object({
  subject: z.string().min(1, "Subject is required"),
  body: z.string().min(1, "Message body is required"),
  to: z.string().email("Invalid email address").optional(),
  listId: z.number().optional(),
  scheduledFor: z.string().datetime().optional(),
});

export const createRecipientSchema = z.object({
  email: z.string().email("Invalid email address"),
  name: z.string().optional(),
  listId: z.number().optional(),
});

export const createRecipientListSchema = z.object({
  name: z.string().min(1, "List name is required"),
  description: z.string().optional(),
});