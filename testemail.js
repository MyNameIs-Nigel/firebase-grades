import admin from "firebase-admin";
import { Resend } from "resend";

/**
 * Sends a test email using real assignment data from Firestore.
 * Formats the email identically to the due-soon notification in cron.js.
 *
 * Required env vars:
 *   FIREBASE_SERVICE_ACCOUNT_JSON — Firebase Admin credentials
 *   RESEND_API_KEY                — Resend email API key
 */

const { FIREBASE_SERVICE_ACCOUNT_JSON, RESEND_API_KEY } = process.env;

if (!FIREBASE_SERVICE_ACCOUNT_JSON) throw new Error("Missing FIREBASE_SERVICE_ACCOUNT_JSON");
if (!RESEND_API_KEY) throw new Error("Missing RESEND_API_KEY");

const ADMIN_EMAIL = "nigel.nds.smith@gmail.com";

const serviceAccount = JSON.parse(FIREBASE_SERVICE_ACCOUNT_JSON);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const resend = new Resend(RESEND_API_KEY);

const TEST_IDS = ["16228431", "16228439"];

console.log(`Fetching test assignments from Firestore: ${TEST_IDS.join(", ")}...`);

const snaps = await Promise.all(
  TEST_IDS.map((id) => db.collection("assignments").doc(id).get())
);

const assignments = snaps
  .filter((snap) => snap.exists)
  .map((snap) => ({ id: snap.id, ...snap.data() }));

if (assignments.length === 0) {
  console.error("No documents found for IDs:", TEST_IDS);
  process.exit(1);
}

console.log(`Found ${assignments.length} assignment(s). Building email...`);

const lines = assignments.map((a) => {
  const due = a.due_date?.toDate?.();
  const dueStr = due
    ? due.toLocaleString("en-US", { timeZone: "America/Boise" })
    : "unknown";
  return [
    `Assignment ID: ${a.id}`,
    `Name:          ${a.name}`,
    `Due:           ${dueStr}`,
    `Course:        ${a.course_name}`,
    `Points:        ${a.max_points ?? 0}`,
  ].join("\n");
});

const body = [
  `You have ${assignments.length} unsubmitted assignment(s) due within 4 hours:\n`,
  lines.join("\n\n"),
  `\nCheck Canvas and submit before the deadline!`,
].join("\n");

console.log("\n--- Email body preview ---\n");
console.log(body);
console.log("\n--------------------------\n");

const { data, error } = await resend.emails.send({
  from: "Grades Alert <nigel@mail.fullcoverage.tech>",
  to: [ADMIN_EMAIL],
  subject: `⚠️ ${assignments.length} assignment(s) due within 4 hours (TEST)`,
  text: body,
});

if (error) {
  console.error("Failed to send:", error);
  process.exit(1);
}

console.log("Test email sent successfully!", data);
