import express from "express";
import cors from "cors";
import admin from "firebase-admin";
import dns from "node:dns";

dns.setDefaultResultOrder("ipv4first");

/**
 * ENV VARS (set on the server)
 * - CANVAS_BASE_URL = https://byui.instructure.com
 * - CANVAS_TOKEN = <canvas token>
 * - ADMIN_EMAIL = <your email>
 * - FIREBASE_SERVICE_ACCOUNT_JSON = <service account json string>
 * - PORT = 8080 (optional)
 */
const {
  CANVAS_BASE_URL,
  CANVAS_TOKEN,
  FIREBASE_SERVICE_ACCOUNT_JSON,
  PORT
} = process.env;

function requireEnv(name) {
  if (!process.env[name]) throw new Error(`Missing required env var: ${name}`);
  return process.env[name];
}
requireEnv("CANVAS_BASE_URL");
requireEnv("CANVAS_TOKEN");
requireEnv("ADMIN_EMAIL");
requireEnv("FIREBASE_SERVICE_ACCOUNT_JSON");

// --------------------
// Firebase Admin init
// --------------------
const serviceAccount = JSON.parse(FIREBASE_SERVICE_ACCOUNT_JSON);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const db = admin.firestore();

// --------------------
// Express app
// --------------------
const app = express();
app.use(express.json());

// IMPORTANT: put CORS before routes
const allowedOrigins = [
  "https://grades.ndsironwood.com",
  "https://nigelsmith-pf.web.app",
  "https://nigelsmith-pf.firebaseapp.com",
  "http://localhost:5000"
];

const corsOptions = {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // curl/postman
    if (allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error(`CORS blocked for origin: ${origin}`));
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  optionsSuccessStatus: 204
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

// Optional but helpful: hard-stop responses that take too long
app.use((req, res, next) => {
  res.setTimeout(30000, () => {
    console.error("[timeout]", req.method, req.url);
    if (!res.headersSent) {
      res.status(504).json({ ok: false, error: "Request timed out" });
    }
  });
  next();
});

// --------------------
// Helpers
// --------------------
function withTimeout(promise, ms, label = "operation") {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    )
  ]);
}

async function fetchWithTimeout(url, options = {}, ms = 15000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

// dynamic allowlist (Firestore) with a tiny in-memory cache
const ALLOWLIST_CACHE_TTL_MS = 60_000; // 60s cache
const allowCache = new Map(); // email -> { allowed: boolean, expiresAt: number }

async function isEmailAllowed(email) {
  const normalized = (email || "").trim().toLowerCase();
  if (!normalized) return false;

  // Cache hit?
  const cached = allowCache.get(normalized);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.allowed;
  }

  // Firestore lookup: allowedEmails/{email}
  const snap = await db.collection("allowedEmails").doc(normalized).get();
  const allowed = snap.exists && snap.data()?.enabled === true;

  allowCache.set(normalized, {
    allowed,
    expiresAt: Date.now() + ALLOWLIST_CACHE_TTL_MS
  });

  return allowed;
}


/**
 * Verify Firebase ID token (sent from browser),
 * AND restrict access to only your email.
 */
async function requireFirebaseUser(req) {
  const header = req.headers.authorization || "";
  const match = header.match(/^Bearer (.+)$/);
  if (!match) {
    const err = new Error("Missing Authorization: Bearer <token>");
    err.status = 401;
    throw err;
  }
  const idToken = match[1];

  const decoded = await withTimeout(
    admin.auth().verifyIdToken(idToken),
    8000,
    "verifyIdToken"
  );
  const email = (decoded.email || "").toLowerCase();

  const allowed = await withTimeout(
    isEmailAllowed(email),
    4000,
    "isEmailAllowed"
  );

  if (!allowed) {
    const err = new Error("Not authorized.");
    err.status = 403;
    throw err;
  }

  return decoded;
  
}

/**
 * Fetch all pages from a Canvas endpoint that paginates with Link headers.
 */
async function fetchAllCanvas(url, token) {
  let results = [];
  let nextUrl = url;
  let page = 0;

  while (nextUrl) {
    page++;
    if (page > 20) {
      throw new Error("Canvas pagination safety stop (too many pages)");
    }

    const res = await fetchWithTimeout(
      nextUrl,
      { headers: { Authorization: `Bearer ${token}` } },
      15000
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Canvas API failed ${res.status}: ${text}`);
    }

    const data = await res.json();
    results = results.concat(data);

    const link = res.headers.get("link") || "";
    const nextPart = link
      .split(",")
      .map(s => s.trim())
      .find(s => s.endsWith('rel="next"'));

    if (nextPart) {
      const m = nextPart.match(/<([^>]+)>/);
      nextUrl = m ? m[1] : null;
    } else {
      nextUrl = null;
    }
  }

  return results;
}

// Courses that exist in Canvas but aren't real classes — skip them everywhere
const IGNORED_COURSE_NAMES = new Set([
  "cse majors",
  "mathematics majors"
]);

function isIgnoredCourse(name) {
  return IGNORED_COURSE_NAMES.has((name || "").trim().toLowerCase());
}

/** parse + validate ISO dates from request body */
function parseISODateOrThrow(value, label) {
  if (!value || typeof value !== "string") {
    const err = new Error(`Missing ${label}. Expected ISO string.`);
    err.status = 400;
    throw err;
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    const err = new Error(`Invalid ${label}. Expected ISO date string.`);
    err.status = 400;
    throw err;
  }
  return d;
}

/** small concurrency limiter (keeps Canvas requests sane from home server) */
async function mapLimit(items, limit, asyncFn) {
  const results = new Array(items.length);
  let idx = 0;

  async function worker() {
    while (idx < items.length) {
      const current = idx++;
      results[current] = await asyncFn(items[current], current);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}

/** fetch assignments for a course and filter by due_at within range */
async function getAssignmentsDueInRange(courseId, startDate, endDate) {
  // include[] makes sure points_possible is present in responses in most Canvas setups
  const url =
    `${CANVAS_BASE_URL}/api/v1/courses/${courseId}/assignments` +
    `?per_page=100&include[]=submission&include[]=score_statistics`;

  const assignments = await fetchAllCanvas(url, CANVAS_TOKEN);

  const startMs = startDate.getTime();
  const endMs = endDate.getTime();

  // Filter to due_at within [start,end]
  return assignments.filter(a => {
    if (!a?.due_at) return false;
    const dueMs = new Date(a.due_at).getTime();
    if (Number.isNaN(dueMs)) return false;
    return dueMs >= startMs && dueMs <= endMs;
  });
}

// --------------------
// Routes
// --------------------
app.get("/health", (req, res) => res.json({ ok: true }));

app.post("/refresh", async (req, res) => {
  const started = Date.now();
  console.log("[/refresh] START", new Date().toISOString());
  try {
    console.log("[/refresh] verifying Firebase token...");
    const user = await requireFirebaseUser(req);
    console.log("[/refresh] auth OK for", user.email);

    // Canvas API: active courses + total scores
    const url =
      `${CANVAS_BASE_URL}/api/v1/courses` +
      `?enrollment_state=active&include[]=total_scores&per_page=100`;

    console.log("[/refresh] fetching Canvas courses...");
    const courses = await fetchAllCanvas(url, CANVAS_TOKEN);
    console.log("[/refresh] Canvas returned", courses.length, "courses");
    const filteredCourses = courses.filter(c => !isIgnoredCourse(c.name));
    if (filteredCourses.length !== courses.length) {
      console.log("[/refresh] ignored", courses.length - filteredCourses.length, "non-class course(s)");
    }

    const now = admin.firestore.Timestamp.now();
    const batch = db.batch();
    let updated = 0;

    for (const c of filteredCourses) {
      const enrollment = Array.isArray(c.enrollments) ? c.enrollments[0] : null;
      const grade = enrollment?.computed_current_grade ?? null;
      const score = enrollment?.computed_current_score ?? null;

      const courseId = c.id;
      const docRef = db.collection("grades").doc(String(courseId));

      batch.set(
        docRef,
        {
          course_id: courseId,
          course_name: c.name ?? "(Unnamed course)",
          grade,
          score,
          date_checked: now
        },
        { merge: true }
      );

      updated++;
    }

    console.log("[/refresh] writing Firestore...");
    await withTimeout(batch.commit(), 15000, "firestore batch.commit");

    console.log("[/refresh] DONE in", Date.now() - started, "ms");
    res.json({
      ok: true,
      updated: filteredCourses.length,
      date_checked: now.toDate().toISOString()
    });
  } catch (err) {
    console.error("[/refresh] ERROR after", Date.now() - started, "ms:", err?.message || err);
    const status = err.status || 500;
    res.status(status).json({
      ok: false,
      error: err?.message || "Unknown error"
    });
  }
});

/**
 * Coursework summary endpoint used by the frontend.
 *
 * POST /coursework-summary
 * Body: { startDate: ISO, endDate: ISO }
 * Returns:
 * {
 *   ok: true,
 *   startDate, endDate,
 *   totalAssignments,
 *   totalPoints,
 *   byCourse: [{ courseId, courseName, assignmentsCount, points }]
 * }
 */
app.post("/coursework-summary", async (req, res) => {
  const started = Date.now();
  console.log("[/coursework-summary] START", new Date().toISOString());

  try {
    const user = await requireFirebaseUser(req);
    console.log("[/coursework-summary] auth OK for", user.email);

    const startDate = parseISODateOrThrow(req.body?.startDate, "startDate");
    const endDate = parseISODateOrThrow(req.body?.endDate, "endDate");

    if (endDate.getTime() < startDate.getTime()) {
      const err = new Error("endDate must be >= startDate.");
      err.status = 400;
      throw err;
    }

    // Fetch active courses (same pattern as /refresh)
    const coursesUrl =
      `${CANVAS_BASE_URL}/api/v1/courses` +
      `?enrollment_state=active&per_page=100`;

    console.log("[/coursework-summary] fetching Canvas courses...");
    const allCourses = await fetchAllCanvas(coursesUrl, CANVAS_TOKEN);
    const courses = allCourses.filter(c => !isIgnoredCourse(c.name));
    console.log("[/coursework-summary] using", courses.length, "of", allCourses.length, "courses (filtered non-class courses)");

    // Fetch assignments per course with a concurrency limit
    console.log("[/coursework-summary] fetching assignments per course...");
    const perCourse = await mapLimit(courses, 5, async (course) => {
      const courseId = course.id;
      const courseName = course.name ?? "(Unnamed course)";

      const dueAssignments = await withTimeout(
        getAssignmentsDueInRange(courseId, startDate, endDate),
        20000,
        `assignments(course ${courseId})`
      );

      const assignmentsCount = dueAssignments.length;
      const points = dueAssignments.reduce((sum, a) => {
        const p = Number(a?.points_possible);
        return sum + (Number.isFinite(p) ? p : 0);
      }, 0);

      return {
        courseId: String(courseId),
        courseName,
        assignmentsCount,
        points
      };
    });

    const byCourse = perCourse
      .filter(c => c.assignmentsCount > 0)
      .sort((a, b) => b.assignmentsCount - a.assignmentsCount);

    const totalAssignments = byCourse.reduce((sum, c) => sum + c.assignmentsCount, 0);
    const totalPoints = byCourse.reduce((sum, c) => sum + c.points, 0);

    console.log("[/coursework-summary] DONE in", Date.now() - started, "ms");
    res.json({
      ok: true,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      totalAssignments,
      totalPoints,
      byCourse
    });
  } catch (err) {
    console.error("[/coursework-summary] ERROR after", Date.now() - started, "ms:", err?.message || err);
    const status = err.status || 500;
    res.status(status).json({
      ok: false,
      error: err?.message || "Unknown error"
    });
  }
});

// --------------------
// Admin: manage allowedEmails
// --------------------
const ADMIN_EMAIL_HARDCODED = "smi23081@byui.edu";

app.post("/admin/emails", async (req, res) => {
  const started = Date.now();
  console.log("[/admin/emails] START", new Date().toISOString());

  try {
    console.log("[/admin/emails] verifying Firebase token...");
    const decoded = await requireFirebaseUser(req);
    const userEmail = (decoded.email || "").toLowerCase();
    console.log("[/admin/emails] auth OK for", userEmail);

    console.log("[/admin/emails] checking if user is admin (expecting", ADMIN_EMAIL_HARDCODED + ")");
    if (userEmail !== ADMIN_EMAIL_HARDCODED) {
      console.log("[/admin/emails] DENIED: user", userEmail, "is not admin");
      return res.status(403).json({ ok: false, error: "Admin access only." });
    }
    console.log("[/admin/emails] admin check PASSED");

    const { action, email } = req.body || {};
    console.log("[/admin/emails] action:", action, "| email:", email);

    if (action === "list") {
      console.log("[/admin/emails] listing allowed emails...");
      const snap = await db.collection("allowedEmails").get();
      const emails = snap.docs.map(doc => ({
        email: doc.id,
        enabled: doc.data()?.enabled ?? false
      }));
      console.log("[/admin/emails] found", emails.length, "emails");
      return res.json({ ok: true, emails });
    }

    if (action === "add") {
      console.log("[/admin/emails] add action");
      if (!email || typeof email !== "string" || !email.includes("@")) {
        console.log("[/admin/emails] invalid email format:", email);
        return res.status(400).json({ ok: false, error: "Invalid email." });
      }
      const normalized = email.trim().toLowerCase();
      console.log("[/admin/emails] adding email:", normalized);
      await db.collection("allowedEmails").doc(normalized).set({ enabled: true });
      allowCache.delete(normalized);
      console.log("[/admin/emails] added", normalized);
      return res.json({ ok: true, added: normalized });
    }

    if (action === "remove") {
      console.log("[/admin/emails] remove action");
      if (!email || typeof email !== "string") {
        console.log("[/admin/emails] invalid email format:", email);
        return res.status(400).json({ ok: false, error: "Invalid email." });
      }
      const normalized = email.trim().toLowerCase();
      console.log("[/admin/emails] removing email:", normalized);
      await db.collection("allowedEmails").doc(normalized).delete();
      allowCache.delete(normalized);
      console.log("[/admin/emails] removed", normalized);
      return res.json({ ok: true, removed: normalized });
    }

    if (action === "toggle") {
      console.log("[/admin/emails] toggle action");
      if (!email || typeof email !== "string") {
        return res.status(400).json({ ok: false, error: "Invalid email." });
      }
      const { enabled } = req.body || {};
      if (typeof enabled !== "boolean") {
        return res.status(400).json({ ok: false, error: "enabled must be a boolean." });
      }
      const normalized = email.trim().toLowerCase();
      console.log("[/admin/emails] toggling", normalized, "->", enabled);
      await db.collection("allowedEmails").doc(normalized).update({ enabled });
      allowCache.delete(normalized);
      return res.json({ ok: true, email: normalized, enabled });
    }

    console.log("[/admin/emails] unknown action:", action);
    return res.status(400).json({ ok: false, error: "Invalid action. Use list, add, or remove." });
  } catch (err) {
    console.error("[/admin/emails] ERROR after", Date.now() - started, "ms:", err?.message || err);
    const status = err.status || 500;
    res.status(status).json({ ok: false, error: err?.message || "Unknown error" });
  }
});

// Github webhook for auto-deploy

import crypto from "node:crypto";
import { exec } from "node:child_process";

const GITHUB_WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET;

// Verify GitHub webhook signature
function verifyGitHubSignature(req) {
  const sig = req.headers["x-hub-signature-256"];
  if (!sig || !GITHUB_WEBHOOK_SECRET) return false;

  const hmac = crypto.createHmac("sha256", GITHUB_WEBHOOK_SECRET);
  const digest = "sha256=" + hmac.update(JSON.stringify(req.body)).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(digest));
}

app.post("/deploy", async (req, res) => {
  if (!verifyGitHubSignature(req)) {
    return res.status(401).json({ ok: false, error: "Invalid signature" });
  }

  console.log("[deploy] GitHub webhook received");

  exec("git pull && npm install && pm2 restart canvas-grades", (err, stdout, stderr) => {
    if (err) {
      console.error("[deploy] ERROR", err);
      return;
    }
    console.log("[deploy] SUCCESS");
    console.log(stdout);
  });

  res.json({ ok: true });
});

const port = Number(PORT || 8080);
app.listen(port, "0.0.0.0", () => {
  console.log(`Server listening on http://0.0.0.0:${port}`);
});