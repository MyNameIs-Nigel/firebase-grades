import cron from "node-cron";
import admin from "firebase-admin";
import { Resend } from "resend";

/**
 * Cron jobs for firebase-grades:
 * 1) Refresh assignments every 2 hours by calling the backend endpoint
 * 2) Check for unsubmitted assignments due within 4 hours every 15 minutes,
 *    and send email notifications via Resend
 *
 * Required env vars:
 *   FIREBASE_SERVICE_ACCOUNT_JSON — Firebase Admin credentials
 *   RESEND_API_KEY               — Resend email API key
 *   ADMIN_EMAIL                  — recipient for due-soon notifications
 *   BACKEND_PORT                 — port the backend runs on (default 8080)
 */

const {
  FIREBASE_SERVICE_ACCOUNT_JSON,
  RESEND_API_KEY,
  BACKEND_PORT
} = process.env;

if (!FIREBASE_SERVICE_ACCOUNT_JSON) throw new Error("Missing FIREBASE_SERVICE_ACCOUNT_JSON");
if (!RESEND_API_KEY) throw new Error("Missing RESEND_API_KEY");

const ADMIN_EMAIL = "nigel.nds.smith@gmail.com";

// --------------------
// Firebase Admin init
// --------------------
const serviceAccount = JSON.parse(FIREBASE_SERVICE_ACCOUNT_JSON);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const db = admin.firestore();

// --------------------
// Resend init
// --------------------
const resend = new Resend(RESEND_API_KEY);

const port = Number(BACKEND_PORT || 8080);
const BACKEND_URL = `http://localhost:${port}`;



// --------------------
// Job 1: Refresh assignments every 2 hours
// --------------------
async function refreshAssignments() {
  console.log("[cron] refreshing assignments...", new Date().toISOString());
  try {
    const res = await fetch(`${BACKEND_URL}/refresh-assignments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const data = await res.json();
    if (data.ok) {
      console.log(`[cron] refresh OK — ${data.assignments} assignments, ${data.courses} courses`);
    } else {
      console.error("[cron] refresh failed:", data.error);
    }
  } catch (err) {
    console.error("[cron] refresh error:", err.message);
  }
}

// --------------------
// Job 2: Check for due-soon unsubmitted assignments every 15 minutes
// --------------------
async function checkDueSoon() {
  console.log("[cron] checking for due-soon assignments...", new Date().toISOString());
  try {
    const now = new Date();
    const fourHoursFromNow = new Date(now.getTime() + 4 * 60 * 60 * 1000);

    const snap = await db
      .collection("assignments")
      .where("submitted", "==", false)
      .where("notified", "==", false)
      .where("due_date", "!=", null)
      .where("due_date", ">", admin.firestore.Timestamp.fromDate(now))
      .where("due_date", "<=", admin.firestore.Timestamp.fromDate(fourHoursFromNow))
      .get();

    if (snap.empty) {
      console.log("[cron] no unsubmitted assignments due within 4 hours");
      return;
    }

    const newAlerts = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

    // Build email body
    const lines = newAlerts.map((a) => {
      const due = a.due_date?.toDate?.();
      const dueStr = due
        ? due.toLocaleString("en-US", { timeZone: "America/Boise" })
        : "unknown";
      return `• ${a.name} (${a.course_name}) — due ${dueStr}`;
    });

    const body = [
      `You have ${newAlerts.length} unsubmitted assignment(s) due within 4 hours:\n`,
      ...lines,
      `\nCheck Canvas and submit before the deadline!`,
    ].join("\n");

    console.log("[cron] sending due-soon email for", newAlerts.length, "assignment(s)");

    const { error } = await resend.emails.send({
      from: "Grades Alert <nigel@mail.fullcoverage.tech>",
      to: [ADMIN_EMAIL],
      subject: `⚠️ ${newAlerts.length} assignment(s) due within 4 hours`,
      text: body,
    });

    if (error) {
      console.error("[cron] Resend error:", error);
      return;
    }

    // Mark as notified in Firestore
    const batch = db.batch();
    for (const a of newAlerts) {
      batch.update(db.collection("assignments").doc(a.id), { notified: true });
    }
    await batch.commit();

    console.log("[cron] email sent successfully, marked", newAlerts.length, "assignment(s) as notified");
  } catch (err) {
    console.error("[cron] due-soon check error:", err.message);
  }
}

// --------------------
// Schedule cron jobs
// --------------------

// Every 2 hours (at minute 0)
cron.schedule("0 */2 * * *", refreshAssignments);

// Every 15 minutes
cron.schedule("*/15 * * * *", checkDueSoon);

console.log("[cron] started — refresh every 2h, due-soon check every 15m");

// Run both once on startup
refreshAssignments();
checkDueSoon();
