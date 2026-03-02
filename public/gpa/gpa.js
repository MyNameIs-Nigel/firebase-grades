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
  getDocs
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

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

const GRADE_GPA = {
  "A": 4.0, "A-": 3.7,
  "B+": 3.4, "B": 3.0, "B-": 2.7,
  "C+": 2.4, "C": 2.0, "C-": 1.7,
  "D+": 1.4, "D": 1.0, "D-": 0.7,
  "F": 0.0, "UW": 0.0,
  "W": 0.0, "P": 0.0, "I": 0.0
};

const SEASON_ORDER = { WINTER: 0, SPRING: 1, SUMMER: 2, FALL: 3 };

/* --- DOM refs --- */
const signInBtn = document.getElementById("signInBtn");
const signOutBtn = document.getElementById("signOutBtn");
const userPill = document.getElementById("userPill");
const authShell = document.getElementById("authShell");
const appShell = document.getElementById("appShell");
const toast = document.getElementById("toast");

const cumulativeGPAEl = document.getElementById("cumulativeGPA");
const theoreticalBlock = document.getElementById("theoreticalBlock");
const theoreticalGPAEl = document.getElementById("theoreticalGPA");
const creditsEarnedEl = document.getElementById("creditsEarned");
const creditsAttemptedEl = document.getElementById("creditsAttempted");

const inProgressSelect = document.getElementById("inProgressSelect");
const inProgressClasses = document.getElementById("inProgressClasses");
const inProgressSummary = document.getElementById("inProgressSummary");

const transcriptContainer = document.getElementById("transcriptContainer");
const transcriptEmpty = document.getElementById("transcriptEmpty");

/* --- State --- */
let allSemesters = [];
let selectedInProgressId = null;
let theoreticalGrades = {};

/* --- Helpers --- */
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.remove("hidden");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.add("hidden"), 3200);
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (m) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[m]));
}

function semesterSortKey(id) {
  const [season, yearStr] = id.split(" ");
  const year = parseInt(yearStr) || 0;
  return year * 10 + (SEASON_ORDER[season] ?? 5);
}

function gpaColorClass(gpa) {
  if (gpa >= 3.7) return "clr-good";
  if (gpa >= 2.7) return "clr-ok";
  return "clr-bad";
}

function gradeDotClass(gpa) {
  if (gpa >= 3.7) return "good";
  if (gpa >= 2.7) return "ok";
  return "bad";
}

/* --- Data loading --- */
async function loadAllData() {
  try {
    const semSnap = await getDocs(collection(db, "semesterGrades"));
    allSemesters = [];

    const fetches = semSnap.docs.map(async (semDoc) => {
      const classesSnap = await getDocs(
        collection(db, "semesterGrades", semDoc.id, "classes")
      );
      const classes = classesSnap.docs.map(d => ({
        courseCode: d.id,
        ...d.data()
      }));
      return { id: semDoc.id, classes };
    });

    allSemesters = await Promise.all(fetches);
    allSemesters.sort((a, b) => semesterSortKey(a.id) - semesterSortKey(b.id));

    populateSemesterDropdown();
    renderAll();
  } catch (e) {
    console.error("Failed to load data:", e);
    showToast("Failed to load transcript data.");
  }
}

/* --- Semester dropdown --- */
function populateSemesterDropdown() {
  const prev = inProgressSelect.value;
  inProgressSelect.innerHTML = '<option value="">No class in session</option>';

  for (const sem of allSemesters) {
    const opt = document.createElement("option");
    opt.value = sem.id;
    opt.textContent = sem.id;
    inProgressSelect.appendChild(opt);
  }

  const autoDetect = allSemesters.find(s =>
    s.classes.some(c => c.inProgress)
  );

  if (prev && allSemesters.some(s => s.id === prev)) {
    inProgressSelect.value = prev;
  } else if (autoDetect) {
    inProgressSelect.value = autoDetect.id;
  }

  selectedInProgressId = inProgressSelect.value || null;
  initTheoreticalGrades();
}

function initTheoreticalGrades() {
  theoreticalGrades = {};
  if (!selectedInProgressId) return;
  const sem = allSemesters.find(s => s.id === selectedInProgressId);
  if (!sem) return;
  for (const c of sem.classes) {
    theoreticalGrades[c.courseCode] = {
      letterGrade: c.letterGrade,
      gpaMultiplier: c.gpaMultiplier
    };
  }
}

/* --- GPA calculations --- */
function calcGPA(classes, overrides) {
  let totalPoints = 0;
  let totalCredits = 0;
  for (const c of classes) {
    const gpa = overrides?.[c.courseCode]?.gpaMultiplier ?? c.gpaMultiplier;
    const credits = c.attemptCredits || 0;
    if (credits > 0) {
      totalPoints += gpa * credits;
      totalCredits += credits;
    }
  }
  return {
    gpa: totalCredits > 0 ? totalPoints / totalCredits : 0,
    totalPoints,
    totalCredits
  };
}

function getCompletedClasses() {
  return allSemesters
    .filter(s => s.id !== selectedInProgressId)
    .flatMap(s => s.classes);
}

function getCompletedCredits() {
  const classes = getCompletedClasses();
  let earned = 0, attempted = 0;
  for (const c of classes) {
    earned += c.earnedCredits || 0;
    attempted += c.attemptCredits || 0;
  }
  return { earned, attempted };
}

/* --- Rendering --- */
function renderAll() {
  updateGPADisplay();
  renderInProgressSection();
  renderTranscript();
}

function updateGPADisplay() {
  const completed = getCompletedClasses();
  const cumResult = calcGPA(completed);
  const credits = getCompletedCredits();

  cumulativeGPAEl.textContent = completed.length ? cumResult.gpa.toFixed(2) : "—";
  cumulativeGPAEl.className = `gpa-stat-value ${completed.length ? gpaColorClass(cumResult.gpa) : ""}`;
  creditsEarnedEl.textContent = String(credits.earned);
  creditsAttemptedEl.textContent = String(credits.attempted);

  if (selectedInProgressId) {
    const ipSem = allSemesters.find(s => s.id === selectedInProgressId);
    if (ipSem && ipSem.classes.length) {
      const allClasses = [...completed, ...ipSem.classes];
      const theoResult = calcGPA(allClasses, theoreticalGrades);
      theoreticalGPAEl.textContent = theoResult.gpa.toFixed(2);
      theoreticalGPAEl.className = `gpa-stat-value ${gpaColorClass(theoResult.gpa)}`;
      theoreticalBlock.style.display = "";
    } else {
      theoreticalBlock.style.display = "none";
    }
  } else {
    theoreticalBlock.style.display = "none";
  }
}

function renderInProgressSection() {
  if (!selectedInProgressId) {
    inProgressClasses.innerHTML = "";
    inProgressSummary.classList.add("hidden");
    return;
  }

  const sem = allSemesters.find(s => s.id === selectedInProgressId);
  if (!sem || !sem.classes.length) {
    inProgressClasses.innerHTML = '<div class="empty">No classes in this semester.</div>';
    inProgressSummary.classList.add("hidden");
    return;
  }

  inProgressClasses.innerHTML = "";

  for (const c of sem.classes) {
    const theo = theoreticalGrades[c.courseCode];
    const currentGrade = theo?.letterGrade || c.letterGrade || "";

    const row = document.createElement("div");
    row.className = "ip-row";

    let gradeOpts = "";
    for (const [grade, gpa] of Object.entries(GRADE_GPA)) {
      gradeOpts += `<option value="${grade}"${currentGrade === grade ? " selected" : ""}>${grade} (${gpa.toFixed(1)})</option>`;
    }

    row.innerHTML = `
      <span class="dot ${gradeDotClass(theo?.gpaMultiplier ?? c.gpaMultiplier)}"></span>
      <div class="ip-info">
        <span class="ip-code">${escapeHtml(c.courseCode)}</span>
        <span class="ip-name">${escapeHtml(c.courseName)}</span>
      </div>
      <div class="ip-controls">
        <select class="ip-grade" data-code="${escapeHtml(c.courseCode)}">
          ${gradeOpts}
        </select>
        <span class="ip-credits">${c.attemptCredits} cr</span>
      </div>
    `;

    const sel = row.querySelector(".ip-grade");
    const dot = row.querySelector(".dot");
    sel.addEventListener("change", () => {
      const newGrade = sel.value;
      const newGpa = GRADE_GPA[newGrade] ?? 0;
      theoreticalGrades[c.courseCode] = {
        letterGrade: newGrade,
        gpaMultiplier: newGpa
      };
      dot.className = `dot ${gradeDotClass(newGpa)}`;
      updateGPADisplay();
      updateIPSummary(sem);
    });

    inProgressClasses.appendChild(row);
  }

  updateIPSummary(sem);
}

function updateIPSummary(sem) {
  if (!sem || !sem.classes.length) {
    inProgressSummary.classList.add("hidden");
    return;
  }
  const result = calcGPA(sem.classes, theoreticalGrades);
  let totalAttempt = 0;
  for (const c of sem.classes) totalAttempt += c.attemptCredits || 0;

  inProgressSummary.innerHTML = `
    Semester GPA: <strong>${result.gpa.toFixed(2)}</strong>
    &nbsp;·&nbsp;
    ${totalAttempt} credits
  `;
  inProgressSummary.classList.remove("hidden");
}

function renderTranscript() {
  transcriptContainer.innerHTML = "";

  const semesters = allSemesters.filter(s => s.id !== selectedInProgressId);

  if (!semesters.length && !selectedInProgressId) {
    transcriptEmpty.classList.remove("hidden");
    return;
  }
  transcriptEmpty.classList.add("hidden");

  if (!semesters.length) {
    transcriptContainer.innerHTML = '<div class="subtle" style="padding:8px 0;">No previous semesters to display.</div>';
    return;
  }

  const ordered = [...semesters].reverse();

  for (const sem of ordered) {
    const semGPA = calcGPA(sem.classes);
    let semEarned = 0, semAttempted = 0;
    for (const c of sem.classes) {
      semEarned += c.earnedCredits || 0;
      semAttempted += c.attemptCredits || 0;
    }

    const hasInProgress = sem.classes.some(c => c.inProgress);

    const block = document.createElement("div");
    block.className = "transcript-semester card";

    let headerHtml = `<span class="transcript-sem-name">${escapeHtml(sem.id)}`;
    if (hasInProgress) {
      headerHtml += `<span class="in-progress-tag">In Progress</span>`;
    }
    headerHtml += `</span>`;

    let statsHtml = `GPA: <strong>${sem.classes.length ? semGPA.gpa.toFixed(2) : "—"}</strong>`;
    statsHtml += ` · ${semEarned} earned / ${semAttempted} attempted`;

    block.innerHTML = `
      <div class="transcript-header">
        ${headerHtml}
        <span class="transcript-sem-stats">${statsHtml}</span>
      </div>
    `;

    for (const c of sem.classes) {
      const dotClass = gradeDotClass(c.gpaMultiplier);
      const row = document.createElement("div");
      row.className = "t-row";
      row.innerHTML = `
        <span class="dot ${dotClass}"></span>
        <div class="t-info">
          <div class="t-code">${escapeHtml(c.courseCode)}<span style="font-weight:400; color:var(--muted); margin-left:8px;">${escapeHtml(c.courseName)}</span></div>
        </div>
        <div class="t-grade">
          <span class="badge score-badge">
            ${escapeHtml(c.letterGrade || "—")} &nbsp;
            <span class="subtle">${c.gpaMultiplier.toFixed(1)}</span>
            &nbsp;·&nbsp; ${c.attemptCredits} cr
          </span>
        </div>
      `;
      block.appendChild(row);
    }

    transcriptContainer.appendChild(block);
  }
}

/* --- Event listeners --- */
inProgressSelect.addEventListener("change", () => {
  selectedInProgressId = inProgressSelect.value || null;
  initTheoreticalGrades();
  renderAll();
});

signInBtn.addEventListener("click", async () => {
  try { await signInWithPopup(auth, provider); }
  catch (e) { showToast("Sign-in failed."); }
});

signOutBtn.addEventListener("click", async () => {
  try { await signOut(auth); }
  catch (e) { showToast("Sign-out failed."); }
});

/* --- Auth state --- */
onAuthStateChanged(auth, (user) => {
  const signedIn = !!user;
  signInBtn.classList.toggle("hidden", signedIn);
  signOutBtn.classList.toggle("hidden", !signedIn);
  userPill.classList.toggle("hidden", !signedIn);
  authShell.classList.toggle("hidden", signedIn);

  if (!user) {
    appShell.classList.add("hidden");
    userPill.textContent = "";
    allSemesters = [];
    selectedInProgressId = null;
    theoreticalGrades = {};
    return;
  }

  userPill.textContent = user.email || user.displayName || "Signed in";
  appShell.classList.remove("hidden");
  loadAllData();
});
