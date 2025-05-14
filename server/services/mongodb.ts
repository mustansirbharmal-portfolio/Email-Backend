import { MongoClient } from "mongodb";

// MongoDB configuration
const DB_URL = process.env.DB_URL || "mongodb+srv://mustawork777:Mustan94885%23%23%23@biren-crm.3eczexv.mongodb.net/";
const DB_NAME = process.env.DB || "crm";

let client: MongoClient | null = null;

export async function connectToMongoDB() {
  try {
    client = new MongoClient(DB_URL);
    await client.connect();
    console.log("Connected to MongoDB");
    
    // Test the connection and initialize collections
    const db = client.db(DB_NAME);
    await db.command({ ping: 1 });
    console.log(`MongoDB database ${DB_NAME} is available`);

    // Ensure collections exist
    await Promise.all([
      db.createCollection('recipients'),
      db.createCollection('recipient_lists'), 
      db.createCollection('emails'),
      db.createCollection('email_activities')
    ]);
    
    return client;
  } catch (error) {
    console.error("MongoDB connection error:", error);
    throw error;
  }
}

export function getMongoClient() {
  if (!client) {
    throw new Error("MongoDB client not initialized. Call connectToMongoDB first.");
  }
  return client;
}

export function getMongoDb() {
  if (!client) {
    throw new Error("MongoDB client not initialized. Call connectToMongoDB first.");
  }
  return client.db(DB_NAME);
}
