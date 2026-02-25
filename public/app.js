import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  getFirestore,
  collection,
  query,
  orderBy,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

/**
 * Firebase config (existing)
 * NOTE: For production-hardening, consider moving this to environment config,
 * but preserving current behavior here.
 */
const firebaseConfig = {
  apiKey: "AIzaSyBZ3wFUKHwC5HIQ-JQ2tADXqBhZ86inxY4",
  authDomain: "nigelsmith-pf.firebaseapp.com",
  projectId: "nigelsmith-pf",
  storageBucket: "nigelsmith-pf.firebasestorage.app",
  messagingSenderId: "295693821864",
  appId: "1:295693821864:web:dff365b5c2f99fed769f9d",
  measurementId: "G-WSCD9M3L00"
};

// Existing backend base URL
const BACKEND_BASE_URL = "https://grades-backend.ndsironwood.com";

// Firebase init
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

/* -----------------------------
 * UI refs (existing + new)
 * ----------------------------- */
const signInBtn = document.getElementById("signInBtn");
const signOutBtn = document.getElementById("signOutBtn");
const refreshBtn = document.getElementById("refreshBtn");
const userPill = document.getElementById("userPill");
const grid = document.getElementById("grid");
const emptyState = document.getElementById("emptyState");
const lastChecked = document.getElementById("lastChecked");
const courseCount = document.getElementById("courseCount");
const toast = document.getElementById("toast");
const spinner = document.getElementById("spinner");
const refreshText = document.getElementById("refreshText");

// NEW: shell toggles (main UI vs auth panel)
const authShell = document.getElementById("authShell");
const appShell = document.getElementById("appShell");

// NEW: coursework summary controls
const courseworkEndDate = document.getElementById("courseworkEndDate");
const courseworkBtn = document.getElementById("courseworkBtn");
const courseworkResult = document.getElementById("courseworkResult");
const courseworkStatus = document.getElementById("courseworkStatus");
const courseworkSpinner = document.getElementById("courseworkSpinner");
const courseworkBtnText = document.getElementById("courseworkBtnText");

/* -----------------------------
 * Small UI helpers (existing + improved)
 * ----------------------------- */
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.remove("hidden");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.add("hidden"), 3200);
}

function setLoading(isLoading) {
  spinner.classList.toggle("hidden", !isLoading);
  refreshText.textContent = isLoading ? "Refreshing…" : "Refresh";
  refreshBtn.disabled = isLoading;
}

function setCourseworkLoading(isLoading) {
  courseworkSpinner.classList.toggle("hidden", !isLoading);
  courseworkBtnText.textContent = isLoading ? "Checking…" : "Check Coursework Load";
  courseworkBtn.disabled = isLoading;
}

function fmtTimestamp(ts) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function gradeStatus(grade, score) {
  const s = typeof score === "number" ? score : null;
  if (grade === "A" || (s != null && s >= 90)) return "good";
  if (grade === "B" || (s != null && s >= 80)) return "ok";
  return "bad";
}

// Fix: robust HTML escaping (prevents injection + rendering issues)
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[m]));
}

/* -----------------------------
 * Existing render: course cards
 * ----------------------------- */
function renderCourses(docs) {
  grid.innerHTML = "";
  if (!docs.length) {
    emptyState.classList.remove("hidden");
    courseCount.textContent = "0";
    lastChecked.textContent = "—";
    return;
  }
  emptyState.classList.add("hidden");

  // newest date_checked
  let newest = null;
  for (const d of docs) {
    const ts = d.date_checked;
    if (!ts) continue;
    const ms = ts.toMillis ? ts.toMillis() : new Date(ts).getTime();
    if (newest == null || ms > newest.ms) newest = { ms, ts };
  }

  courseCount.textContent = String(docs.length);
  lastChecked.textContent = newest ? fmtTimestamp(newest.ts) : "—";

  for (const c of docs) {
    const grade = c.grade ?? "—";
    const score = typeof c.score === "number" ? c.score.toFixed(2) : "—";
    const status = gradeStatus(grade, c.score);

    const card = document.createElement("div");
    card.className = "card course";
    card.innerHTML = `
      <h3>${escapeHtml(c.course_name ?? "Untitled Course")}</h3>
      <div class="kv">
        <span class="badge">
          <span class="dot ${status}"></span>
          <strong>Grade:</strong> ${escapeHtml(String(grade))}
        </span>
        <span class="badge">
          <strong>Score:</strong> ${escapeHtml(String(score))}
        </span>
      </div>
      <div style="margin-top:12px" class="subtle">
        Checked: ${fmtTimestamp(c.date_checked)}
      </div>
    `;

    grid.appendChild(card);
  }
}

/* -----------------------------
 * Auth wiring
 * - Google SSO is wired here.
 * ----------------------------- */
signInBtn.addEventListener("click", async () => {
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    console.error("Sign-in error:", e);
    showToast("Sign-in failed.");
  }
});

signOutBtn.addEventListener("click", async () => {
  try {
    await signOut(auth);
  } catch (e) {
    console.error("Sign-out error:", e);
    showToast("Sign-out failed.");
  }
});

/* -----------------------------
 * Refresh button wiring (pattern preserved)
 * - Calls POST `${BACKEND_BASE_URL}/refresh`
 * - Uses Firebase ID token in Authorization header
 * ----------------------------- */
refreshBtn.addEventListener("click", async () => {
  try {
    setLoading(true);
    const user = auth.currentUser;
    if (!user) throw new Error("Not signed in.");

    const idToken = await user.getIdToken(true);
    const res = await fetch(`${BACKEND_BASE_URL}/refresh`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${idToken}`,
        "Content-Type": "application/json"
      }
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || "Refresh failed.");

    showToast(`Updated ${data.updated} courses.`);
  } catch (e) {
    console.error("Refresh error:", e);
    showToast(e?.message || "Refresh failed.");
  } finally {
    setLoading(false);
  }
});

/* -----------------------------
 * NEW: Coursework summary feature (Now → Selected Date)
 *
 * Backend endpoint (assumed):
 * POST `${BACKEND_BASE_URL}/coursework-summary`
 * Body: { startDate: <ISO>, endDate: <ISO> }
 * Response (proposed):
 * {
 *   totalAssignments: number,
 *   totalPoints: number,
 *   byCourse: [{ courseId, courseName, assignmentsCount, points }]
 * }
 * ----------------------------- */
function toISOStartOfNow() {
  return new Date().toISOString();
}

function toISOEndOfDay(dateStr) {
  // dateStr format: yyyy-mm-dd from <input type="date">
  // Interpret as local end-of-day for user friendliness.
  const [y, m, d] = dateStr.split("-").map(Number);
  const end = new Date(y, m - 1, d, 23, 59, 59, 999);
  return end.toISOString();
}

function todayDateInputValue() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function validateEndDate(dateStr) {
  if (!dateStr) return { ok: false, message: "Please select a target date." };

  // Compare date-only in local time
  const [y, m, d] = dateStr.split("-").map(Number);
  const chosen = new Date(y, m - 1, d, 0, 0, 0, 0);

  const todayStr = todayDateInputValue();
  const [ty, tm, td] = todayStr.split("-").map(Number);
  const today = new Date(ty, tm - 1, td, 0, 0, 0, 0);

  if (chosen < today) {
    return { ok: false, message: "Target date must be today or later." };
  }

  return { ok: true };
}

async function fetchCourseworkSummary({ startDateISO, endDateISO }) {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in.");

  const idToken = await user.getIdToken(false);
  const res = await fetch(`${BACKEND_BASE_URL}/coursework-summary`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${idToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ startDate: startDateISO, endDate: endDateISO })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Failed to fetch coursework summary.");
  return data;
}

function renderCourseworkSummary(data, endDateStr) {
  courseworkResult.innerHTML = "";

  const totalAssignments = Number(data?.totalAssignments ?? 0);
  const totalPoints = Number(data?.totalPoints ?? 0);
  const byCourse = Array.isArray(data?.byCourse) ? data.byCourse : [];

  // Top-level summary card
  const summary = document.createElement("div");
  summary.className = "card";
  summary.innerHTML = `
    <h3>Summary</h3>
    <div class="kv">
      <span class="badge"><strong>Assignments:</strong> ${escapeHtml(totalAssignments)}</span>
      <span class="badge"><strong>Total points:</strong> ${escapeHtml(totalPoints)}</span>
      <span class="badge"><strong>Through:</strong> ${escapeHtml(endDateStr)}</span>
    </div>
    <div class="subtle" style="margin-top:10px">
      Showing coursework due between now and the selected date.
    </div>
  `;
  courseworkResult.appendChild(summary);

  if (!byCourse.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.style.marginTop = "12px";
    empty.textContent = "No upcoming coursework found in that range.";
    courseworkResult.appendChild(empty);
    return;
  }

  // Per-course breakdown (consistent card styling)
  const wrap = document.createElement("div");
  wrap.className = "coursework-cards";

  for (const c of byCourse) {
    const courseName = c.courseName ?? "Untitled Course";
    const assignmentsCount = Number(c.assignmentsCount ?? 0);
    const points = Number(c.points ?? 0);

    const card = document.createElement("div");
    card.className = "card course";
    card.innerHTML = `
      <h3>${escapeHtml(courseName)}</h3>
      <div class="kv">
        <span class="badge"><strong>Assignments:</strong> ${escapeHtml(assignmentsCount)}</span>
        <span class="badge"><strong>Points:</strong> ${escapeHtml(points)}</span>
      </div>
    `;

    wrap.appendChild(card);
  }

  courseworkResult.appendChild(wrap);
}

// NEW: coursework button handler
courseworkBtn.addEventListener("click", async () => {
  try {
    setCourseworkLoading(true);

    const dateStr = courseworkEndDate.value;
    const v = validateEndDate(dateStr);
    if (!v.ok) throw new Error(v.message);

    courseworkStatus.textContent = "Checking coursework load…";

    const startDateISO = toISOStartOfNow();
    const endDateISO = toISOEndOfDay(dateStr);

    // Backend call is made here
    const data = await fetchCourseworkSummary({ startDateISO, endDateISO });

    renderCourseworkSummary(data, dateStr);
    courseworkStatus.textContent = `Loaded coursework load through ${dateStr}.`;
  } catch (e) {
    console.error("Coursework summary error:", e);
    courseworkStatus.textContent = "Unable to load coursework summary.";
    courseworkResult.innerHTML = "";
    showToast(e?.message || "Failed to check coursework load.");
  } finally {
    setCourseworkLoading(false);
  }
});

/* -----------------------------
 * Subscribe to Firestore when signed in (existing)
 * + Shell visibility toggles (NEW)
 * ----------------------------- */
let unsubscribe = null;

onAuthStateChanged(auth, (user) => {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }

  const signedIn = !!user;

  // Header actions
  signInBtn.classList.toggle("hidden", signedIn);
  signOutBtn.classList.toggle("hidden", !signedIn);
  refreshBtn.classList.toggle("hidden", !signedIn);
  userPill.classList.toggle("hidden", !signedIn);

  // NEW: main app shell vs auth panel
  authShell.classList.toggle("hidden", signedIn);
  appShell.classList.toggle("hidden", !signedIn);

  if (!user) {
    // Reset UI to signed-out state
    grid.innerHTML = "";
    emptyState.classList.add("hidden");
    lastChecked.textContent = "—";
    courseCount.textContent = "—";
    userPill.textContent = "";

    courseworkEndDate.value = "";
    courseworkResult.innerHTML = "";
    courseworkStatus.textContent = "Select a date to estimate assignments/points due between now and then.";
    return;
  }

  // Signed in UI
  userPill.textContent = user.email || user.displayName || "Signed in";

  // Initialize date input defaults once signed-in
  const todayStr = todayDateInputValue();
  courseworkEndDate.min = todayStr;

  if (!courseworkEndDate.value) {
    // Default to 14 days out for convenience
    const d = new Date();
    d.setDate(d.getDate() + 14);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    courseworkEndDate.value = `${y}-${m}-${day}`;
  }

  // Existing grades subscription
  const q = query(collection(db, "grades"), orderBy("course_name"));
  unsubscribe = onSnapshot(q, (snap) => {
    const docs = snap.docs.map((d) => d.data());
    renderCourses(docs);
  });
});
