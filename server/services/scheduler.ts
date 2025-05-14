import { storage } from "../storage";
import { sendEmail } from "./email";

export function setupScheduler() {
  console.log("✅ Email scheduler initialized using setInterval (every minute)");

  // Runs every minute
  setInterval(async () => {
    try {
      console.log("⏱️ Running email scheduler...");

      // Get all scheduled emails
      const scheduledEmails = await storage.getEmails(0, "scheduled");
      const now = new Date();

      // Filter only valid, due emails
      const emailsToSend = scheduledEmails.filter((email) => {
        const scheduledFor = email.scheduledFor;
        if (!scheduledFor) {
          console.warn(`Email ID ${email.id} has no scheduled date.`);
          return false;
        }

        const scheduledDate = new Date(scheduledFor);
        if (isNaN(scheduledDate.getTime())) {
          console.error(`❌ Invalid date format for email ID ${email.id}:`, scheduledFor);
          return false;
        }

        return scheduledDate <= now;
      });

      console.log(`✅ Found ${emailsToSend.length} emails to send.`);

      // Send the emails
      for (const email of emailsToSend) {
        try {
          await sendEmail(email);
          console.log(`📧 Successfully sent email ID: ${email.id}`);
        } catch (err) {
          console.error(`❌ Failed to send email ID: ${email.id}`, err);
        }
      }

    } catch (err) {
      console.error("❌ Scheduler failed to run:", err);
    }
  }, 60 * 1000); // 1 minute = 60,000 milliseconds
}
