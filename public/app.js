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

const firebaseConfig = {
  apiKey: "AIzaSyBZ3wFUKHwC5HIQ-JQ2tADXqBhZ86inxY4",
  authDomain: "nigelsmith-pf.firebaseapp.com",
  projectId: "nigelsmith-pf",
  storageBucket: "nigelsmith-pf.firebasestorage.app",
  messagingSenderId: "295693821864",
  appId: "1:295693821864:web:dff365b5c2f99fed769f9d",
  measurementId: "G-WSCD9M3L00"
};

const BACKEND_BASE_URL = "https://grades-backend.ndsironwood.com";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

/* --- UI refs --- */
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

const authShell = document.getElementById("authShell");
const appShell = document.getElementById("appShell");

// Assignments UI
const refreshAssignmentsBtn = document.getElementById("refreshAssignmentsBtn");
const jumpTodayBtn = document.getElementById("jumpTodayBtn");
const assignmentsSpinner = document.getElementById("assignmentsSpinner");
const assignmentsBtnText = document.getElementById("assignmentsBtnText");
const coursePills = document.getElementById("coursePills");
const assignmentsList = document.getElementById("assignmentsList");
const assignmentsEmpty = document.getElementById("assignmentsEmpty");
const assignmentCount = document.getElementById("assignmentCount");
const assignmentsLastSynced = document.getElementById("assignmentsLastSynced");

/* --- Small helpers --- */
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

function setAssignmentsLoading(isLoading) {
  assignmentsSpinner.classList.toggle("hidden", !isLoading);
  assignmentsBtnText.textContent = isLoading ? "Syncing…" : "Refresh Assignments";
  refreshAssignmentsBtn.disabled = isLoading;
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

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[m]));
}

/* --- Grades rendering (unchanged) --- */
const IGNORED_COURSE_NAMES = new Set(["cse majors", "mathematics majors"]);

function renderCourses(docs) {
  docs = docs.filter(d => !IGNORED_COURSE_NAMES.has((d.course_name || "").trim().toLowerCase()));
  grid.innerHTML = "";
  if (!docs.length) {
    emptyState.classList.remove("hidden");
    courseCount.textContent = "0";
    lastChecked.textContent = "—";
    return;
  }
  emptyState.classList.add("hidden");

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

/* --- Auth wiring --- */
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

/* --- Refresh grades button --- */
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

/* =========================================
 * Assignments — real-time from Firestore
 * ========================================= */
let allAssignments = [];
let activeCourseFilter = null; // null = show all

function tsToMs(ts) {
  if (!ts) return null;
  return ts.toMillis ? ts.toMillis() : new Date(ts).getTime();
}

function fmtDateGroup(ts) {
  if (!ts) return "No due date";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());

  if (target.getTime() === today.getTime()) return "Today";
  if (target.getTime() === tomorrow.getTime()) return "Tomorrow";

  return d.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric"
  });
}

function dateKey(ts) {
  if (!ts) return "9999-99-99";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dateHeaderId(key) {
  return `date-${key}`;
}

function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function assignmentStatus(a) {
  if (a.graded) return "graded";
  if (a.submitted) return "submitted";
  const dueMs = tsToMs(a.due_date);
  if (dueMs && dueMs < Date.now()) return "overdue";
  return "pending";
}

function statusDotClass(status) {
  if (status === "graded") return "good";
  if (status === "submitted") return "ok";
  if (status === "overdue") return "bad";
  return "";
}

function statusLabel(status) {
  if (status === "graded") return "Graded";
  if (status === "submitted") return "Submitted";
  if (status === "overdue") return "Overdue";
  return "Pending";
}

function renderCoursePills() {
  coursePills.innerHTML = "";

  const courseMap = new Map();
  for (const a of allAssignments) {
    if (!courseMap.has(a.course_id)) {
      courseMap.set(a.course_id, a.course_name || `Course ${a.course_id}`);
    }
  }

  const allPill = document.createElement("button");
  allPill.className = `course-pill${activeCourseFilter === null ? " active" : ""}`;
  allPill.textContent = "All";
  allPill.type = "button";
  allPill.addEventListener("click", () => {
    activeCourseFilter = null;
    renderAssignments();
  });
  coursePills.appendChild(allPill);

  const sorted = [...courseMap.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  for (const [courseId, courseName] of sorted) {
    const pill = document.createElement("button");
    pill.className = `course-pill${activeCourseFilter === courseId ? " active" : ""}`;
    pill.textContent = courseName;
    pill.type = "button";
    pill.addEventListener("click", () => {
      activeCourseFilter = courseId;
      renderAssignments();
    });
    coursePills.appendChild(pill);
  }
}

function renderAssignments() {
  renderCoursePills();

  const filtered = activeCourseFilter != null
    ? allAssignments.filter(a => a.course_id === activeCourseFilter)
    : [...allAssignments];

  filtered.sort((a, b) => {
    const aMs = tsToMs(a.due_date) ?? Infinity;
    const bMs = tsToMs(b.due_date) ?? Infinity;
    return aMs - bMs;
  });

  assignmentCount.textContent = String(filtered.length);

  let newestUpdate = null;
  for (const a of allAssignments) {
    const ms = tsToMs(a.last_updated);
    if (ms && (newestUpdate == null || ms > newestUpdate.ms)) {
      newestUpdate = { ms, ts: a.last_updated };
    }
  }
  assignmentsLastSynced.textContent = newestUpdate ? fmtTimestamp(newestUpdate.ts) : "—";

  assignmentsList.innerHTML = "";

  if (!filtered.length) {
    assignmentsEmpty.classList.remove("hidden");
    return;
  }
  assignmentsEmpty.classList.add("hidden");

  const groups = new Map();
  for (const a of filtered) {
    const key = dateKey(a.due_date);
    if (!groups.has(key)) {
      groups.set(key, { label: fmtDateGroup(a.due_date), items: [] });
    }
    groups.get(key).items.push(a);
  }

  for (const [, group] of groups) {
    const groupKey = dateKey(group.items[0]?.due_date);
    const header = document.createElement("div");
    header.className = "date-group-header";
    header.id = dateHeaderId(groupKey);
    header.textContent = group.label;
    assignmentsList.appendChild(header);

    for (const a of group.items) {
      const status = assignmentStatus(a);
      const dotClass = statusDotClass(status);

      let scoreHtml = "";
      if (a.graded && a.max_points > 0) {
        const pct = ((a.points / a.max_points) * 100).toFixed(1);
        scoreHtml = `<span class="badge score-badge">${escapeHtml(a.points)}/${escapeHtml(a.max_points)} <span class="subtle">(${pct}%)</span></span>`;
      } else if (a.graded) {
        scoreHtml = `<span class="badge score-badge">${escapeHtml(a.points)} pts</span>`;
      }

      const showCourse = activeCourseFilter == null;
      const metaParts = [];
      if (showCourse && a.course_name) metaParts.push(escapeHtml(a.course_name));
      metaParts.push(escapeHtml(statusLabel(status)));

      const row = document.createElement("div");
      row.className = `assignment-row status-${status}`;
      row.innerHTML = `
        <span class="dot ${dotClass}"></span>
        <div class="assignment-info">
          <div class="assignment-name">${escapeHtml(a.name)}</div>
          <div class="assignment-meta">${metaParts.join('<span class="meta-sep"> · </span>')}</div>
        </div>
        <div class="assignment-score">${scoreHtml}</div>
      `;

      assignmentsList.appendChild(row);
    }
  }
}

function jumpToTodayOrNext() {
  const headers = Array.from(assignmentsList.querySelectorAll(".date-group-header"));
  if (!headers.length) {
    showToast("No assignment dates to jump to.");
    return;
  }

  const keys = headers
    .map((h) => h.id.replace(/^date-/, ""))
    .filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k))
    .sort();

  if (!keys.length) {
    showToast("No dated assignments to jump to.");
    return;
  }

  const today = todayKey();
  const targetKey = keys.find((k) => k >= today) ?? keys[keys.length - 1];
  const target = document.getElementById(dateHeaderId(targetKey));
  if (!target) return;

  target.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* --- Refresh assignments button --- */
refreshAssignmentsBtn.addEventListener("click", async () => {
  try {
    setAssignmentsLoading(true);
    const user = auth.currentUser;
    if (!user) throw new Error("Not signed in.");

    const idToken = await user.getIdToken(true);
    const res = await fetch(`${BACKEND_BASE_URL}/refresh-assignments`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${idToken}`,
        "Content-Type": "application/json"
      }
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || "Failed to refresh assignments.");

    showToast(`Synced ${data.assignments} assignments from ${data.courses} courses.`);
  } catch (e) {
    console.error("Refresh assignments error:", e);
    showToast(e?.message || "Failed to refresh assignments.");
  } finally {
    setAssignmentsLoading(false);
  }
});

jumpTodayBtn.addEventListener("click", () => {
  jumpToTodayOrNext();
});

/* =========================================
 * Auth state → subscriptions
 * ========================================= */
let unsubGrades = null;
let unsubAssignments = null;

onAuthStateChanged(auth, (user) => {
  if (unsubGrades) { unsubGrades(); unsubGrades = null; }
  if (unsubAssignments) { unsubAssignments(); unsubAssignments = null; }

  const signedIn = !!user;

  signInBtn.classList.toggle("hidden", signedIn);
  signOutBtn.classList.toggle("hidden", !signedIn);
  refreshBtn.classList.toggle("hidden", !signedIn);
  userPill.classList.toggle("hidden", !signedIn);
  authShell.classList.toggle("hidden", signedIn);
  appShell.classList.toggle("hidden", !signedIn);

  const adminLink = document.getElementById("adminLink");
  if (adminLink) {
    adminLink.classList.toggle("hidden",
      !user || (user.email || "").toLowerCase() !== "smi23081@byui.edu");
  }

  if (!user) {
    grid.innerHTML = "";
    emptyState.classList.add("hidden");
    lastChecked.textContent = "—";
    courseCount.textContent = "—";
    userPill.textContent = "";

    allAssignments = [];
    activeCourseFilter = null;
    coursePills.innerHTML = "";
    assignmentsList.innerHTML = "";
    assignmentsEmpty.classList.add("hidden");
    assignmentCount.textContent = "—";
    assignmentsLastSynced.textContent = "—";
    return;
  }

  userPill.textContent = user.email || user.displayName || "Signed in";

  // Grades real-time listener
  const gradesQ = query(collection(db, "grades"), orderBy("course_name"));
  unsubGrades = onSnapshot(gradesQ, (snap) => {
    renderCourses(snap.docs.map(d => d.data()));
  });

  // Assignments real-time listener
  const assignmentsRef = collection(db, "assignments");
  unsubAssignments = onSnapshot(assignmentsRef, (snap) => {
    allAssignments = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderAssignments();
  });
});
