import { storage } from "../storage";
import { sendGmailEmail } from "./gmail";
import type { Email } from "../shared/schema";

export async function sendEmail(email: Email) {
  try {
    // Get user to access Gmail refresh token
    const user = await storage.getUser(email.userId);
    if (!user) {
      throw new Error("User not found");
    }

    if (!user.gmailConnected || !user.gmailRefreshToken) {
      throw new Error("Gmail account not connected");
    }

    let recipientEmails: string[] = [];

    // Determine recipients based on to field or listId
    if (email.to) {
      // Single recipient
      recipientEmails = [email.to];
    } else if (email.listId) {
      // Bulk email to a list
      const recipients = await storage.getRecipients(user.id, email.listId);
      recipientEmails = recipients.map(r => r.email);
    } else {
      throw new Error("No recipients specified");
    }

    if (recipientEmails.length === 0) {
      throw new Error("No recipients found");
    }

    // Results array to track sending status
    const results = [];

    // Send to each recipient
    for (const to of recipientEmails) {
      try {
        const result = await sendGmailEmail(user.gmailRefreshToken, {
          to,
          subject: email.subject,
          body: email.body
        });
        
        results.push({ email: to, success: true, messageId: result.id });
        
        // Record activity
        await storage.createEmailActivity({
          emailId: email.id,
          type: "sent",
          recipientEmail: to
        });
      } catch (error) {
        console.error(`Failed to send to ${to}:`, error);
        results.push({ email: to, success: false, error: (error as Error).message });
      }
    }

    // Update email status
    await storage.updateEmailStatus(email.id, "sent", new Date());

    return {
      success: results.every(r => r.success),
      total: recipientEmails.length,
      sent: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results
    };
  } catch (error) {
    console.error("Send email error:", error);
    
    // Update email status to failed
    await storage.updateEmailStatus(email.id, "failed");
    
    throw error;
  }
}

export async function scheduleEmail(email: Email) {
  try {
    // Check if the email is already scheduled
    if (email.status !== "scheduled" || !email.scheduledFor) {
      throw new Error("Email is not scheduled or missing scheduledFor date");
    }

    // Simply return the email if it's successfully scheduled
    // The scheduler will pick it up based on scheduledFor time
    return email;
  } catch (error) {
    console.error("Schedule email error:", error);
    
    // Update email status to failed
    await storage.updateEmailStatus(email.id, "failed");
    
    throw error;
  }
}

export async function getScheduledEmails(userId: number) {
  try {
    const scheduledEmails = await storage.getEmails(userId, "scheduled");
    return scheduledEmails.sort((a, b) => {
      if (!a.scheduledFor || !b.scheduledFor) return 0;
      return a.scheduledFor.getTime() - b.scheduledFor.getTime();
    });
  } catch (error) {
    console.error("Get scheduled emails error:", error);
    throw error;
  }
}
