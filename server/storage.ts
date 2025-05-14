import { 
  users, type User, type InsertUser, 
  recipients, type Recipient, type InsertRecipient,
  recipientLists, type RecipientList, type InsertRecipientList,
  emails, type Email, type InsertEmail,
  emailActivities, type EmailActivity, type InsertEmailActivity
} from "./shared/schema";
import { MongoClient, ObjectId } from "mongodb";
import { getMongoDb } from "./services/mongodb";

export class Storage {
  async getRecipients(userId: number, listId?: number): Promise<Recipient[]> {
    const db = getMongoDb();
    const collection = db.collection('recipients');
    const query = listId ? { userId, listId } : { userId };
    return await collection.find(query).toArray();
  }

  async getRecipient(id: number): Promise<Recipient | undefined> {
    const db = getMongoDb();
    const collection = db.collection('recipients');
    return await collection.findOne({ id });
  }

  async createRecipient(recipient: InsertRecipient): Promise<Recipient> {
    const db = getMongoDb();
    const collection = db.collection('recipients');
    const newRecipient = {
      ...recipient,
      createdAt: new Date()
    };
    const result = await collection.insertOne(newRecipient);
    return { ...newRecipient, id: result.insertedId };
  }

  async deleteRecipient(id: number): Promise<boolean> {
    const db = getMongoDb();
    const collection = db.collection('recipients');
    const result = await collection.deleteOne({ id });
    return result.deletedCount > 0;
  }

  async getRecipientLists(userId: number): Promise<RecipientList[]> {
    const db = getMongoDb();
    const collection = db.collection('recipient_lists');
    return await collection.find({ userId }).toArray();
  }

  async getRecipientList(id: number): Promise<RecipientList | undefined> {
    const db = getMongoDb();
    const collection = db.collection('recipient_lists');
    return await collection.findOne({ id });
  }

  async createRecipientList(list: InsertRecipientList): Promise<RecipientList> {
    const db = getMongoDb();
    const collection = db.collection('recipient_lists');
    const newList = {
      ...list,
      createdAt: new Date()
    };
    const result = await collection.insertOne(newList);
    return { ...newList, id: result.insertedId };
  }

  async deleteRecipientList(id: number): Promise<boolean> {
    const db = getMongoDb();
    const collection = db.collection('recipient_lists');
    const result = await collection.deleteOne({ id });
    return result.deletedCount > 0;
  }

  async getEmails(userId: number, status?: string): Promise<Email[]> {
    const db = getMongoDb();
    const collection = db.collection('emails');
    const query = status ? { userId, status } : { userId };
    return await collection.find(query).toArray();
  }

  async getEmail(id: number): Promise<Email | undefined> {
    const db = getMongoDb();
    const collection = db.collection('emails');
    return await collection.findOne({ id });
  }

  async createEmail(email: InsertEmail): Promise<Email> {
    const db = getMongoDb();
    const collection = db.collection('emails');
    const newEmail = {
      ...email,
      sentAt: null,
      createdAt: new Date()
    };
    const result = await collection.insertOne(newEmail);
    return { ...newEmail, id: result.insertedId };
  }

  async updateEmailStatus(id: number, status: string, sentAt?: Date): Promise<Email | undefined> {
    const db = getMongoDb();
    const collection = db.collection('emails');
    const update = sentAt ? { status, sentAt } : { status };
    const result = await collection.findOneAndUpdate(
      { _id: new ObjectId(id.toString()) },
      { $set: update },
      { returnDocument: 'after' }
    );
    return result;
  }

  async deleteEmail(id: number): Promise<boolean> {
    const db = getMongoDb();
    const collection = db.collection('emails');
    const result = await collection.deleteOne({ id });
    return result.deletedCount > 0;
  }

  // Initialize collections
  async initializeCollections() {
    const db = getMongoDb();
    await Promise.all([
      db.createCollection('recipients'),
      db.createCollection('recipient_lists'),
      db.createCollection('emails'),
      db.createCollection('email_activities')
    ]);
  }

  // Auth
  async getUserByUsername(username: string): Promise<User | undefined> {
    const mongoClient = new MongoClient("mongodb+srv://mustawork777:Mustan94885%23%23%23@biren-crm.3eczexv.mongodb.net/");
    try {
      await mongoClient.connect();
      const db = mongoClient.db("crm");
      const collection = db.collection('users');
      
      const user = await collection.findOne({ username });
      if (!user) return undefined;
      
      // Convert MongoDB document to User type
      return {
        id: user._id.toString(),
        username: user.username,
        password: user.password,
        email: user.email || null,
        name: user.name || null,
        gmailConnected: user.gmailConnected || false,
        gmailRefreshToken: user.gmailRefreshToken || null,
        gmailEmail: user.gmailEmail || null,
        createdAt: user.createdAt || new Date()
      };
    } catch (error) {
      console.error('MongoDB error:', error);
      return undefined;
    } finally {
      await mongoClient.close();
    }
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const mongoClient = new MongoClient("mongodb+srv://mustawork777:Mustan94885%23%23%23@biren-crm.3eczexv.mongodb.net/");
    try {
      await mongoClient.connect();
      const db = mongoClient.db("crm");
      const collection = db.collection('users');

      const newUser = {
        ...insertUser,
        email: null,
        name: null,
        gmailConnected: false,
        gmailRefreshToken: null,
        gmailEmail: null,
        createdAt: new Date()
      };

      const result = await collection.insertOne(newUser);

      return {
        id: result.insertedId.toString(),
        username: newUser.username,
        password: newUser.password,
        email: newUser.email,
        name: newUser.name,
        gmailConnected: newUser.gmailConnected,
        gmailRefreshToken: newUser.gmailRefreshToken,
        gmailEmail: newUser.gmailEmail,
        createdAt: newUser.createdAt
      };
    } catch (error) {
      console.error('MongoDB error:', error);
      throw error;
    } finally {
      await mongoClient.close();
    }
  }

  async updateGmailConnection(userId: string, gmailRefreshToken: string, gmailEmail: string): Promise<User> {
    try {
      // Connect directly to MongoDB
      const mongoClient = new MongoClient("mongodb+srv://mustawork777:Mustan94885%23%23%23@biren-crm.3eczexv.mongodb.net/");
      await mongoClient.connect();
      const db = mongoClient.db("crm");
      const collection = db.collection('users');
      
      // Convert string ID to ObjectId if needed
      let objectId;
      try {
        objectId = new ObjectId(userId);
      } catch (error) {
        console.error("Invalid ObjectId format:", userId);
        throw new Error("Invalid user ID format");
      }
      
      // Update the user document
      const result = await collection.findOneAndUpdate(
        { _id: objectId },
        { 
          $set: { 
            gmailConnected: true,
            gmailRefreshToken: gmailRefreshToken,
            gmailEmail: gmailEmail,
            updatedAt: new Date()
          } 
        },
        { returnDocument: 'after' }
      );
      
      if (!result || !result.value) {
        throw new Error("User not found or update failed");
      }
      
      // Convert MongoDB document to User type
      const updatedUser: User = {
        id: result.value._id.toString(),
        username: result.value.username,
        password: result.value.password,
        email: result.value.email || null,
        name: result.value.firstName || result.value.name || null,
        gmailConnected: result.value.gmailConnected || true,
        gmailRefreshToken: result.value.gmailRefreshToken || gmailRefreshToken,
        gmailEmail: result.value.gmailEmail || gmailEmail,
        createdAt: result.value.createdAt || new Date()
      };
      
      return updatedUser;
    } catch (error) {
      console.error('MongoDB update error:', error);
      throw error;
    } finally {
        mongoClient.close();
    }
  }

  // User Management
  async getUser(id: string): Promise<User | undefined> {
    let mongoClient: MongoClient | null = null;
    try {
      // Connect to MongoDB
      mongoClient = new MongoClient("mongodb+srv://mustawork777:Mustan94885%23%23%23@biren-crm.3eczexv.mongodb.net/");
      await mongoClient.connect();
      const db = mongoClient.db("crm");
      const collection = db.collection('users');
      
      // Convert string ID to ObjectId if needed
      let objectId;
      try {
        objectId = new ObjectId(id);
      } catch (error) {
        console.error("Invalid ObjectId format:", id);
        return undefined;
      }
      
      // Find user in MongoDB
      const user = await collection.findOne({ _id: objectId });
      
      if (!user) {
        return undefined;
      }
      
      // Convert MongoDB document to User type
      return {
        id: user._id.toString(),
        username: user.username,
        password: user.password,
        email: user.email || null,
        name: user.firstName || user.name || null,
        gmailConnected: user.gmailConnected || false,
        gmailRefreshToken: user.gmailRefreshToken || null,
        gmailEmail: user.gmailEmail || null,
        createdAt: user.createdAt || new Date()
      };
    } catch (error) {
      console.error('MongoDB error:', error);
      return undefined;
    } finally {
      if (mongoClient) {
        await mongoClient.close();
      }
    }
  }

  async createEmailActivity(activity: InsertEmailActivity): Promise<EmailActivity> {
    const db = getMongoDb();
    const collection = db.collection('email_activities');
    const newActivity = {
      ...activity,
      timestamp: new Date()
    };
    const result = await collection.insertOne(newActivity);
    return { ...newActivity, id: result.insertedId };
  }

  async getEmailActivities(emailId: number): Promise<EmailActivity[]> {
    const db = getMongoDb();
    const collection = db.collection('email_activities');
    return await collection.find({ emailId }).toArray();
  }
}

export const storage = new Storage();