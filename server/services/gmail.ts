import { google } from "googleapis";
import { storage } from "../storage";

// Define OAuth2Client type
let oauth2Client: any;

export function initializeGmailService() {
  // Get environment variables for Google OAuth
  const clientId = process.env.GMAIL_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;
  const callbackUrl = process.env.GMAIL_REDIRECT_URI || '/api/gmail/callback';

  // Validate required environment variables
  if (!clientId || !clientSecret) {
    console.error("Missing Gmail OAuth credentials. Please set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET environment variables.");
  }

  if (!callbackUrl) {
    console.error("Missing Gmail callback URL. Please set GMAIL_REDIRECT_URI environment variable.");
  }

  console.log("Using Gmail OAuth callback URL:", callbackUrl);
  
  // Initialize OAuth2 client with Google API credentials
  oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    callbackUrl
  );
}

export function getGmailAuthUrl() {
  if (!oauth2Client) {
    throw new Error("Gmail service not initialized");
  }

  // Generate a URL for requesting Gmail permissions
  const scopes = [
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.compose",
    "https://www.googleapis.com/auth/userinfo.email"
  ];

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: scopes,
    prompt: "consent" // Forces token refresh
  });

  return authUrl;
}

export async function handleGmailCallback(code: string, userId: number) {
  if (!oauth2Client) {
    throw new Error("Gmail service not initialized");
  }

  try {
    // Exchange code for tokens
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    if (!tokens.refresh_token) {
      console.error("No refresh token received from Google");
      throw new Error("Failed to get refresh token from Google");
    }

    // Get user's Gmail address
    const gmail = google.gmail({ version: "v1", auth: oauth2Client });
    const res = await gmail.users.getProfile({ userId: "me" });
    const gmailEmail = res.data.emailAddress;

    if (!gmailEmail) {
      throw new Error("Failed to get Gmail email address");
    }

    console.log("Successfully obtained Gmail tokens and email:", {
      email: gmailEmail,
      hasRefreshToken: !!tokens.refresh_token
    });

    // Return the tokens for direct MongoDB update
    return { 
      refreshToken: tokens.refresh_token,
      email: gmailEmail
    };
  } catch (error) {
    console.error("Gmail callback error:", error);
    throw error;
  }
}

export async function refreshGmailToken(refreshToken: string) {
  if (!oauth2Client) {
    throw new Error("Gmail service not initialized");
  }

  try {
    oauth2Client.setCredentials({
      refresh_token: refreshToken
    });

    const { credentials } = await oauth2Client.refreshAccessToken();
    return credentials;
  } catch (error) {
    console.error("Token refresh error:", error);
    throw error;
  }
}

export async function sendGmailEmail(refreshToken: string, options: any) {
  if (!oauth2Client) {
    throw new Error("Gmail service not initialized");
  }

  try {
    // Refresh the access token
    oauth2Client.setCredentials({
      refresh_token: refreshToken
    });

    // Create Gmail service
    const gmail = google.gmail({ version: "v1", auth: oauth2Client });

    // Create the email message
    const { to, subject, body } = options;
    
    // Encode the message in base64 URL-safe format
    const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`;
    const messageParts = [
      `To: ${to}`,
      'Content-Type: text/html; charset=utf-8',
      'MIME-Version: 1.0',
      `Subject: ${utf8Subject}`,
      '',
      body,
    ];
    const message = messageParts.join('\n');
    const encodedMessage = Buffer.from(message)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    // Send the message
    const res = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encodedMessage,
      },
    });

    return res.data;
  } catch (error) {
    console.error("Send Gmail error:", error);
    throw error;
  }
}
