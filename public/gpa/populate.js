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
  doc,
  getDocs,
  setDoc,
  deleteDoc,
  serverTimestamp
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

const ADMIN_EMAIL = "smi23081@byui.edu";

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

/* --- DOM refs --- */
const signInBtn = document.getElementById("signInBtn");
const signOutBtn = document.getElementById("signOutBtn");
const userPill = document.getElementById("userPill");
const authShell = document.getElementById("authShell");
const appShell = document.getElementById("appShell");
const toast = document.getElementById("toast");

const seasonSelect = document.getElementById("season");
const yearInput = document.getElementById("year");
const loadBtn = document.getElementById("loadBtn");
const semesterPills = document.getElementById("semesterPills");
const semesterStatus = document.getElementById("semesterStatus");

const classesContainer = document.getElementById("classesContainer");
const addClassBtn = document.getElementById("addClassBtn");
const submitBtn = document.getElementById("submitBtn");
const deleteSemesterBtn = document.getElementById("deleteSemesterBtn");

let loadedSemesterId = null;

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

function getSemesterId() {
  const season = seasonSelect.value;
  const year = yearInput.value.trim();
  if (!season || !year || !/^\d{4}$/.test(year)) return null;
  return `${season} ${year}`;
}

const SEASON_ORDER = { WINTER: 0, SPRING: 1, SUMMER: 2, FALL: 3 };

function semesterSortKey(id) {
  const [season, yearStr] = id.split(" ");
  const year = parseInt(yearStr) || 0;
  return year * 10 + (SEASON_ORDER[season] ?? 5);
}

/* --- Existing semesters --- */
async function loadExistingSemesters() {
  try {
    const snap = await getDocs(collection(db, "semesterGrades"));
    const semesters = snap.docs.map(d => d.id);
    semesters.sort((a, b) => semesterSortKey(a) - semesterSortKey(b));
    renderSemesterPills(semesters);
  } catch (e) {
    console.error("Failed to load semesters:", e);
    semesterPills.innerHTML = '<span class="subtle">Failed to load semesters.</span>';
  }
}

function renderSemesterPills(semesters) {
  semesterPills.innerHTML = "";
  if (!semesters.length) {
    semesterPills.innerHTML = '<span class="subtle">No semesters found yet.</span>';
    return;
  }
  for (const id of semesters) {
    const pill = document.createElement("button");
    pill.className = `course-pill${loadedSemesterId === id ? " active" : ""}`;
    pill.textContent = id;
    pill.type = "button";
    pill.addEventListener("click", () => {
      const [season, year] = id.split(" ");
      seasonSelect.value = season;
      yearInput.value = year;
      loadSemester(id);
    });
    semesterPills.appendChild(pill);
  }
}

/* --- Load semester classes --- */
async function loadSemester(semesterId) {
  loadedSemesterId = semesterId;
  classesContainer.innerHTML = "";

  try {
    const classesSnap = await getDocs(
      collection(db, "semesterGrades", semesterId, "classes")
    );

    if (classesSnap.empty) {
      semesterStatus.textContent = `No classes found for ${semesterId}. Add some below.`;
      semesterStatus.classList.remove("hidden");
      deleteSemesterBtn.classList.remove("hidden");
      addClassRow();
      loadExistingSemesters();
      return;
    }

    semesterStatus.textContent = `Loaded ${classesSnap.size} class(es) from ${semesterId}.`;
    semesterStatus.classList.remove("hidden");
    deleteSemesterBtn.classList.remove("hidden");

    for (const classDoc of classesSnap.docs) {
      const d = classDoc.data();
      addClassRow({
        courseCode: classDoc.id,
        courseName: d.courseName || "",
        letterGrade: d.letterGrade || "",
        gpaMultiplier: d.gpaMultiplier ?? "",
        attemptCredits: d.attemptCredits ?? "",
        earnedCredits: d.earnedCredits ?? "",
        inProgress: d.inProgress || false
      });
    }

    loadExistingSemesters();
  } catch (e) {
    console.error("Failed to load semester:", e);
    showToast("Failed to load semester: " + e.message);
  }
}

/* --- Class row management --- */
function buildGradeOptions(selected) {
  let html = `<option value="">—</option>`;
  for (const g of Object.keys(GRADE_GPA)) {
    html += `<option value="${g}"${selected === g ? " selected" : ""}>${g}</option>`;
  }
  return html;
}

function addClassRow(data = {}) {
  const row = document.createElement("div");
  row.className = "class-entry";

  row.innerHTML = `
    <div class="class-row-top">
      <div class="field">
        <label>Course Code</label>
        <input type="text" class="input courseCode" placeholder="ITM101" value="${escapeHtml(data.courseCode || "")}" />
      </div>
      <div class="field field-grow">
        <label>Course Name</label>
        <input type="text" class="input courseName" placeholder="Intro to Information Technology" value="${escapeHtml(data.courseName || "")}" />
      </div>
      <button type="button" class="btn danger remove-btn" title="Remove class">✕</button>
    </div>
    <div class="class-row-bottom">
      <div class="field">
        <label>Letter Grade</label>
        <select class="input letterGrade">
          ${buildGradeOptions(data.letterGrade)}
        </select>
      </div>
      <div class="field">
        <label>GPA Value</label>
        <input type="number" class="input gpaMultiplier" step="0.1" min="0" max="4" placeholder="3.4" value="${data.gpaMultiplier ?? ""}" />
      </div>
      <div class="field">
        <label>Attempt Credits</label>
        <input type="number" class="input attemptCredits" step="0.5" min="0" placeholder="3" value="${data.attemptCredits ?? ""}" />
      </div>
      <div class="field">
        <label>Earned Credits</label>
        <input type="number" class="input earnedCredits" step="0.5" min="0" placeholder="3" value="${data.earnedCredits ?? ""}" />
      </div>
      <div class="field field-check">
        <label class="check-label">
          <input type="checkbox" class="inProgress" ${data.inProgress ? "checked" : ""} />
          In Progress
        </label>
      </div>
    </div>
  `;

  const gradeSelect = row.querySelector(".letterGrade");
  const gpaInput = row.querySelector(".gpaMultiplier");
  gradeSelect.addEventListener("change", () => {
    const grade = gradeSelect.value;
    if (grade in GRADE_GPA) {
      gpaInput.value = GRADE_GPA[grade];
    }
  });

  row.querySelector(".remove-btn").addEventListener("click", () => row.remove());

  classesContainer.appendChild(row);
}

/* --- Collect form data --- */
function getClassesFromForm() {
  const entries = classesContainer.querySelectorAll(".class-entry");
  const classes = [];
  for (const entry of entries) {
    const courseCode = entry.querySelector(".courseCode").value.trim().toUpperCase();
    const courseName = entry.querySelector(".courseName").value.trim();
    const letterGrade = entry.querySelector(".letterGrade").value;
    const gpaMultiplier = parseFloat(entry.querySelector(".gpaMultiplier").value);
    const attemptCredits = parseFloat(entry.querySelector(".attemptCredits").value);
    const earnedCredits = parseFloat(entry.querySelector(".earnedCredits").value);
    const inProgress = entry.querySelector(".inProgress").checked;

    if (!courseCode) continue;

    classes.push({
      courseCode,
      courseName,
      letterGrade,
      gpaMultiplier: isNaN(gpaMultiplier) ? 0 : gpaMultiplier,
      attemptCredits: isNaN(attemptCredits) ? 0 : attemptCredits,
      earnedCredits: isNaN(earnedCredits) ? 0 : earnedCredits,
      inProgress
    });
  }
  return classes;
}

/* --- Submit --- */
async function submitSemester() {
  const semesterId = getSemesterId();
  if (!semesterId) {
    showToast("Please select a valid semester and year.");
    return;
  }

  const classes = getClassesFromForm();
  if (!classes.length) {
    showToast("Add at least one class before submitting.");
    return;
  }

  const codes = classes.map(c => c.courseCode);
  const dupes = codes.filter((c, i) => codes.indexOf(c) !== i);
  if (dupes.length) {
    showToast(`Duplicate course code(s): ${[...new Set(dupes)].join(", ")}`);
    return;
  }

  try {
    submitBtn.disabled = true;
    submitBtn.textContent = "Saving…";

    const semRef = doc(db, "semesterGrades", semesterId);
    await setDoc(semRef, { lastUpdated: serverTimestamp() }, { merge: true });

    const existingSnap = await getDocs(
      collection(db, "semesterGrades", semesterId, "classes")
    );
    const existingIds = new Set(existingSnap.docs.map(d => d.id));
    const newIds = new Set(classes.map(c => c.courseCode));

    for (const existingId of existingIds) {
      if (!newIds.has(existingId)) {
        await deleteDoc(doc(db, "semesterGrades", semesterId, "classes", existingId));
      }
    }

    for (const cls of classes) {
      await setDoc(
        doc(db, "semesterGrades", semesterId, "classes", cls.courseCode),
        {
          courseName: cls.courseName,
          letterGrade: cls.letterGrade,
          gpaMultiplier: cls.gpaMultiplier,
          attemptCredits: cls.attemptCredits,
          earnedCredits: cls.earnedCredits,
          inProgress: cls.inProgress
        }
      );
    }

    loadedSemesterId = semesterId;
    showToast(`Saved ${classes.length} class(es) for ${semesterId}.`);
    semesterStatus.textContent = `Saved ${classes.length} class(es) for ${semesterId}.`;
    deleteSemesterBtn.classList.remove("hidden");
    await loadExistingSemesters();
  } catch (e) {
    console.error("Submit error:", e);
    showToast("Failed to save: " + e.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Save Semester";
  }
}

/* --- Delete semester --- */
async function deleteSemester() {
  const semesterId = getSemesterId();
  if (!semesterId) {
    showToast("No semester selected.");
    return;
  }

  if (!confirm(`Delete ${semesterId} and all its classes?`)) return;

  try {
    deleteSemesterBtn.disabled = true;

    const classesSnap = await getDocs(
      collection(db, "semesterGrades", semesterId, "classes")
    );
    for (const classDoc of classesSnap.docs) {
      await deleteDoc(classDoc.ref);
    }

    await deleteDoc(doc(db, "semesterGrades", semesterId));

    loadedSemesterId = null;
    classesContainer.innerHTML = "";
    semesterStatus.classList.add("hidden");
    deleteSemesterBtn.classList.add("hidden");

    showToast(`Deleted ${semesterId}.`);
    await loadExistingSemesters();
  } catch (e) {
    console.error("Delete error:", e);
    showToast("Failed to delete: " + e.message);
  } finally {
    deleteSemesterBtn.disabled = false;
  }
}

/* --- Event listeners --- */
loadBtn.addEventListener("click", () => {
  const semesterId = getSemesterId();
  if (!semesterId) {
    showToast("Please select a valid semester and year.");
    return;
  }
  loadSemester(semesterId);
});

addClassBtn.addEventListener("click", () => addClassRow());
submitBtn.addEventListener("click", submitSemester);
deleteSemesterBtn.addEventListener("click", deleteSemester);

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
    classesContainer.innerHTML = "";
    semesterPills.innerHTML = "";
    semesterStatus.classList.add("hidden");
    deleteSemesterBtn.classList.add("hidden");
    loadedSemesterId = null;
    return;
  }

  userPill.textContent = user.email || user.displayName || "Signed in";

  if ((user.email || "").toLowerCase() !== ADMIN_EMAIL) {
    appShell.classList.add("hidden");
    authShell.classList.remove("hidden");
    authShell.querySelector(".card").innerHTML = `
      <h2 style="margin:0 0 8px; font-size:16px;">Access denied</h2>
      <p class="muted-block" style="margin:0;">
        This page is restricted to the admin account (${escapeHtml(ADMIN_EMAIL)}).
      </p>
    `;
    return;
  }

  appShell.classList.remove("hidden");
  loadExistingSemesters();
});
