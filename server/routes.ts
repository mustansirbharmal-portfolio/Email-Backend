import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import session from "express-session";
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { z } from "zod";
import bcrypt from "bcrypt";
import cors from "cors";
import { ObjectId, MongoClient } from "mongodb";
import { loginSchema, sendEmailSchema, createRecipientSchema, createRecipientListSchema } from "./shared/schema";
import { initializeGmailService, getGmailAuthUrl, handleGmailCallback, refreshGmailToken } from "./services/gmail";
import { sendEmail, scheduleEmail, getScheduledEmails } from "./services/email";
import { setupScheduler } from "./services/scheduler";
import { connectToMongoDB, getMongoDb } from "./services/mongodb";

// MongoDB configuration
const DB_URL = process.env.DB_URL || process.env.MONGODB_URI || "";
if (!DB_URL) {
  console.error("No MongoDB connection string provided. Please set DB_URL or MONGODB_URI environment variable.");
}
const DB_NAME = process.env.DB || "crm";

export async function registerRoutes(app: Express): Promise<Server> {
  // Set up MongoDB connection
  await connectToMongoDB();

  // Configure CORS
  const corsOptions = {
    origin: process.env.CORS_ORIGIN || 'https://frontend-new-email-agent.vercel.app',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
  };
  app.use(cors(corsOptions));

  // Set up session middleware
  app.use(session({
    secret: process.env.SESSION_SECRET || "mailconnect-secret",
    resave: false,
    saveUninitialized: true,
    cookie: { 
      secure: process.env.NODE_ENV === 'production', // Secure in production
      maxAge: 1000 * 60 * 60 * 24,
      httpOnly: true,
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax' // Required for cross-site cookies
    },
    name: 'mailconnect.sid'
  }));

  // Initialize passport
  app.use(passport.initialize());
  app.use(passport.session());

  // Configure passport local strategy
  passport.use(new LocalStrategy(async (username, password, done) => {
    try {
      // Get user directly from MongoDB collection
      const db = getMongoDb();
      const collection = db.collection('users');
      const user = await collection.findOne({ username });

      if (!user) {
        return done(null, false, { message: "Invalid username or password" });
      }

      // Compare password using bcrypt
      const isPasswordValid = await bcrypt.compare(password, user.password);

      if (!isPasswordValid) {
        return done(null, false, { message: "Invalid username or password" });
      }

      // Convert MongoDB user to our application user format
      const appUser = {
        id: user._id.toString(),
        username: user.username,
        password: user.password,
        email: user.email || null,
        name: user.firstName || null,
        gmailConnected: user.gmailConnected || false,
        gmailRefreshToken: user.gmailRefreshToken || null,
        gmailEmail: user.gmailEmail || null,
        createdAt: user.createdAt || new Date()
      };

      return done(null, appUser);
    } catch (error) {
      console.error("Authentication error:", error);
      return done(error);
    }
  }));

  // Serialize and deserialize user
  passport.serializeUser((user: any, done) => {
    done(null, user.id);
  });

  passport.deserializeUser(async (id: string, done) => {
    try {
      // Look up user directly from MongoDB
      const db = getMongoDb();
      const collection = db.collection('users');
      let objectId;
      try {
        objectId = new ObjectId(id);
      } catch (error) {
        console.error("Invalid ObjectId format:", id);
        return done(null, false);
      }
      const user = await collection.findOne({ _id: objectId });

      if (!user) {
        return done(null, false);
      }

      // Convert MongoDB user to our application user format
      const appUser = {
        id: user._id.toString(),
        username: user.username,
        password: user.password,
        email: user.email || null,
        name: user.firstName || null,
        gmailConnected: user.gmailConnected || false,
        gmailRefreshToken: user.gmailRefreshToken || null,
        gmailEmail: user.gmailEmail || null,
        createdAt: user.createdAt || new Date()
      };

      done(null, appUser);
    } catch (error) {
      console.error("Deserialize error:", error);
      done(error);
    }
  });

  // Initialize Gmail service
  initializeGmailService();

  // Setup email scheduler
  setupScheduler();

  // Authentication routes
  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const validation = loginSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ message: "Invalid input", errors: validation.error.format() });
      }

      passport.authenticate("local", (err: any, user: any, info: any) => {
        if (err) {
          return res.status(500).json({ message: "Server error" });
        }
        if (!user) {
          return res.status(401).json({ message: info.message || "Invalid credentials" });
        }
        req.logIn(user, (err) => {
          if (err) {
            return res.status(500).json({ message: "Failed to create session" });
          }
          return res.status(200).json({
            id: user.id,
            username: user.username,
            gmailConnected: user.gmailConnected
          });
        });
      })(req, res);
    } catch (error) {
      res.status(500).json({ message: "Server error" });
    }
  });

  app.post("/api/auth/logout", (req: Request, res: Response) => {
    req.logout((err) => {
      if (err) {
        return res.status(500).json({ message: "Failed to logout" });
      }
      res.status(200).json({ message: "Logged out successfully" });
    });
  });

  // Auth check middleware
  const isAuthenticated = (req: Request, res: Response, next: Function) => {
    // Check if user is authenticated through Passport
    if (req.isAuthenticated() && req.user) {
      return next();
    }

    // For development mode, create a test user session if none exists
    if (process.env.NODE_ENV === 'development' && !req.user) {
      const testUser = {
        id: 'test-user-id',
        username: 'test-user',
        gmailConnected: false
      };
      req.login(testUser, (err) => {
        if (err) {
          console.error("Failed to create test user session:", err);
          return res.status(401).json({ message: "Authentication failed" });
        }
        return next();
      });
      return;
    }

    // For Gmail callback, redirect to login if not authenticated
    if (req.path === '/api/gmail/callback') {
      return res.redirect('/login?error=auth_required');
    }

    res.status(401).json({ message: "Unauthorized" });
  };

  // Gmail Auth routes
  app.get("/api/gmail/auth", isAuthenticated, (req: Request, res: Response) => {
    const authUrl = getGmailAuthUrl();
    res.status(200).json({ authUrl });
  });

  // Gmail callback route - exactly matches Google OAuth console configuration
  app.get("/api/gmail/callback", async (req: Request, res: Response) => {
    try {
      console.log("Gmail callback received", { query: req.query });

      // Check for error response from Google OAuth
      if (req.query.error) {
        console.error("Google OAuth error:", req.query.error);
        return res.redirect("/dashboard?gmailError=" + encodeURIComponent(req.query.error as string));
      }

      const { code } = req.query;
      if (!code || typeof code !== "string") {
        console.error("Invalid code received in callback");
        return res.redirect("/dashboard?gmailError=invalid_code");
      }

      // Check if user is authenticated
      if (!req.isAuthenticated() || !req.user) {
        console.error("User not authenticated during callback");
        return res.redirect("/login?error=auth_required");
      }

      const user = req.user as any;
      console.log("Processing Gmail callback for user:", user.id);

      try {
        // Get MongoDB connection
        const db = getMongoDb();
        const collection = db.collection('users');

        // Get tokens from Google
        const { refreshToken, email } = await handleGmailCallback(code, user.id);

        // Convert userId to ObjectId
        let objectId;
        try {
          objectId = new ObjectId(user.id);
        } catch (err) {
          console.error("Invalid ObjectId format:", user.id);
          return res.redirect("/dashboard?gmailError=invalid_user_id");
        }

        // Update user directly in MongoDB
        const updateResult = await collection.updateOne(
          { _id: objectId },
          { 
            $set: { 
              gmailConnected: true,
              gmailRefreshToken: refreshToken,
              gmailEmail: email 
            } 
          }
        );

        if ((updateResult as any).matchedCount === 0 || updateResult.modifiedCount === 0) {
          console.error("No user found to update with Gmail connection");
          return res.redirect("/dashboard?gmailError=user_not_found");
        }

        console.log("Gmail connection successful - user updated in MongoDB");
        res.redirect("/dashboard?gmailConnected=success");
      } catch (err) {
        console.error("Error updating user with Gmail connection:", err);
        res.redirect("/dashboard?gmailError=db_update_failed");
      }
    } catch (error) {
      console.error("Gmail callback error:", error);
      // Send the user back to dashboard with error info
      res.redirect("/dashboard?gmailError=connection_failed");
    }
  });

  app.get("/api/gmail/status", async (req: Request, res: Response) => {
    try {
      // Check if user is authenticated
      if (!req.isAuthenticated() || !req.user) {
        // Return a default response for unauthenticated users instead of error
        return res.status(200).json({
          connected: false,
          email: null
        });
      }

      const user = req.user as any;
      console.log("Getting Gmail status for user:", user);

      // Use MongoDB directly to avoid any issues
      const mongoClient = new MongoClient(DB_URL);
      await mongoClient.connect();
      const db = mongoClient.db(DB_NAME);
      const collection = db.collection('users');

      // Parse the ObjectId
      let objectId;
      try {
        objectId = new ObjectId(user.id);
      } catch (error) {
        console.error("Invalid ObjectId format:", user.id);
        return res.status(200).json({
          connected: false,
          email: null
        });
      }

      // Query user from MongoDB
      const userData = await collection.findOne({ _id: objectId });
      await mongoClient.close();

      if (!userData) {
        console.error("User not found for Gmail status check");
        return res.status(200).json({
          connected: false,
          email: null
        });
      }

      return res.status(200).json({
        connected: userData.gmailConnected || false,
        email: userData.gmailEmail || null
      });
    } catch (error) {
      console.error("Gmail status error:", error);
      // Return a successful response with default values instead of error
      return res.status(200).json({
        connected: false,
        email: null,
        error: "Failed to check status"
      });
    }
  });

  // Email routes
  app.post("/api/emails", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const validation = sendEmailSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ message: "Invalid input", errors: validation.error.format() });
      }

      const user = req.user as any;
      const { subject, body, to, listId, scheduledFor } = req.body;

      // Create email record
      const email = await storage.createEmail({
        userId: user.id,
        subject,
        body,
        to,
        listId,
        status: scheduledFor ? "scheduled" : "draft",
        scheduledFor: scheduledFor ? new Date(scheduledFor) : null
      });

      // Handle immediate sending or scheduling
      if (scheduledFor) {
        await scheduleEmail(email);
        res.status(200).json({ message: "Email scheduled successfully", email });
      } else {
        const result = await sendEmail(email);
        res.status(200).json({ message: "Email sent successfully", result });
      }
    } catch (error) {
      console.error("Send email error:", error);
      res.status(500).json({ message: "Failed to send email" });
    }
  });

  app.get("/api/emails", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const user = req.user as any;
      const status = req.query.status as string | undefined;

      const emails = await storage.getEmails(user.id, status);
      res.status(200).json(emails);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch emails" });
    }
  });

  app.get("/api/emails/scheduled", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const user = req.user as any;
      const scheduledEmails = await getScheduledEmails(user.id);
      res.status(200).json(scheduledEmails);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch scheduled emails" });
    }
  });

  app.delete("/api/emails/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const emailId = parseInt(req.params.id);
      if (isNaN(emailId)) {
        return res.status(400).json({ message: "Invalid email ID" });
      }

      const email = await storage.getEmail(emailId);
      if (!email) {
        return res.status(404).json({ message: "Email not found" });
      }

      const user = req.user as any;
      if (email.userId !== user.id) {
        return res.status(403).json({ message: "Unauthorized to delete this email" });
      }

      await storage.deleteEmail(emailId);
      res.status(200).json({ message: "Email deleted successfully" });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete email" });
    }
  });

  // Recipient routes
  app.post("/api/recipients", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const validation = createRecipientSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ message: "Invalid input", errors: validation.error.format() });
      }

      const user = req.user as any;
      const { email, name, listId } = req.body;

      const recipient = await storage.createRecipient({
        userId: user.id,
        email,
        name,
        listId
      });

      res.status(201).json(recipient);
    } catch (error) {
      res.status(500).json({ message: "Failed to create recipient" });
    }
  });

  app.get("/api/recipients", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const user = req.user as any;
      const listId = req.query.listId ? parseInt(req.query.listId as string) : undefined;

      const recipients = await storage.getRecipients(user.id, listId);
      res.status(200).json(recipients);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch recipients" });
    }
  });

  app.delete("/api/recipients/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const recipientId = parseInt(req.params.id);
      if (isNaN(recipientId)) {
        return res.status(400).json({ message: "Invalid recipient ID" });
      }

      const recipient = await storage.getRecipient(recipientId);
      if (!recipient) {
        return res.status(404).json({ message: "Recipient not found" });
      }

      const user = req.user as any;
      if (recipient.userId !== user.id) {
        return res.status(403).json({ message: "Unauthorized to delete this recipient" });
      }

      await storage.deleteRecipient(recipientId);
      res.status(200).json({ message: "Recipient deleted successfully" });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete recipient" });
    }
  });

  // Recipient List routes
  app.post("/api/recipient-lists", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const validation = createRecipientListSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ message: "Invalid input", errors: validation.error.format() });
      }

      const user = req.user as any;
      const { name, description } = req.body;

      const list = await storage.createRecipientList({
        userId: user.id,
        name,
        description
      });

      res.status(201).json(list);
    } catch (error) {
      res.status(500).json({ message: "Failed to create recipient list" });
    }
  });

  app.get("/api/recipient-lists", async (req: Request, res: Response) => {
    try {
      // Check if user is authenticated
      if (!req.isAuthenticated() || !req.user) {
        // Return empty list for unauthenticated users instead of error
        return res.status(200).json([]);
      }

      const user = req.user as any;
      console.log("Getting recipient lists for user:", user);

      const lists = await storage.getRecipientLists(user.id);
      res.status(200).json(lists);
    } catch (error) {
      console.error("Recipient lists fetch error:", error);
      // Return an empty array instead of an error
      return res.status(200).json([]);
    }
  });

  app.delete("/api/recipient-lists/:id", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const listId = parseInt(req.params.id);
      if (isNaN(listId)) {
        return res.status(400).json({ message: "Invalid list ID" });
      }

      const list = await storage.getRecipientList(listId);
      if (!list) {
        return res.status(404).json({ message: "Recipient list not found" });
      }

      const user = req.user as any;
      if (list.userId !== user.id) {
        return res.status(403).json({ message: "Unauthorized to delete this list" });
      }

      await storage.deleteRecipientList(listId);
      res.status(200).json({ message: "Recipient list deleted successfully" });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete recipient list" });
    }
  });

  // Analytics routes
  app.get("/api/analytics/overview", isAuthenticated, async (req: Request, res: Response) => {
    try {
      const user = req.user as any;

      // Get sent emails count
      const sentEmails = await storage.getEmails(user.id, "sent");

      // Get scheduled emails count
      const scheduledEmails = await storage.getEmails(user.id, "scheduled");

      // Calculate open rate (placeholder logic)
      const openRate = sentEmails.length > 0 ? 
        Math.floor(Math.random() * 30) + 40 : 0; // Just placeholder for now

      res.status(200).json({
        totalSent: sentEmails.length,
        scheduled: scheduledEmails.length,
        openRate: `${openRate}%`
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch analytics data" });
    }
  });

  // Create HTTP server
  const httpServer = createServer(app);

  return httpServer;
}
