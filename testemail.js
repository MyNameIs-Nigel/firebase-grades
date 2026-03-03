import { Resend } from "resend";

/**
 * Sends a test email via Resend to verify email delivery is working.
 *
 * Required env vars:
 *   RESEND_API_KEY — Resend email API key
 *   ADMIN_EMAIL   — recipient for the test email
 */

const { RESEND_API_KEY, ADMIN_EMAIL } = process.env;

if (!RESEND_API_KEY) throw new Error("Missing RESEND_API_KEY");
if (!ADMIN_EMAIL) throw new Error("Missing ADMIN_EMAIL");

const resend = new Resend(RESEND_API_KEY);

console.log(`Sending test email to ${ADMIN_EMAIL}...`);

const { data, error } = await resend.emails.send({
  from: "Grades Alert <nigel@mail.fullcoverage.tech>",
  to: [ADMIN_EMAIL],
  subject: "Test email from firebase-grades",
  text: "This is a test email to confirm Resend delivery is working correctly.",
});

if (error) {
  console.error("Failed to send:", error);
  process.exit(1);
}

console.log("Email sent successfully!", data);
