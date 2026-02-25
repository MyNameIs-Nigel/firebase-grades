import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

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
const ADMIN_EMAIL = "smi23081@byui.edu";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

const signInBtn = document.getElementById("signInBtn");
const signOutBtn = document.getElementById("signOutBtn");
const userPill = document.getElementById("userPill");
const authShell = document.getElementById("authShell");
const adminShell = document.getElementById("adminShell");
const emailList = document.getElementById("emailList");
const emailError = document.getElementById("emailError");
const newEmailInput = document.getElementById("newEmail");
const addEmailBtn = document.getElementById("addEmailBtn");
const toast = document.getElementById("toast");

function showToast(msg) {
  toast.textContent = msg;
  toast.classList.remove("hidden");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.add("hidden"), 3200);
}

function showError(msg) {
  emailError.textContent = msg;
  emailError.classList.remove("hidden");
}

function clearError() {
  emailError.classList.add("hidden");
  emailError.textContent = "";
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (m) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[m]));
}

async function apiCall(action, email) {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in.");
  const idToken = await user.getIdToken(false);
  const body = { action };
  if (email) body.email = email;
  const res = await fetch(`${BACKEND_BASE_URL}/admin/emails`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${idToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || "Request failed.");
  return data;
}

async function loadEmails() {
  clearError();
  try {
    const data = await apiCall("list");
    renderEmails(data.emails || []);
  } catch (e) {
    showError(e.message);
  }
}

function renderEmails(emails) {
  emailList.innerHTML = "";
  if (!emails.length) {
    emailList.innerHTML = '<li class="subtle">No allowed emails found.</li>';
    return;
  }
  for (const entry of emails) {
    const li = document.createElement("li");
    li.className = "email-item";
    li.innerHTML = `
      <span>${escapeHtml(entry.email)}</span>
      <button class="btn danger" type="button" data-email="${escapeHtml(entry.email)}">Remove</button>
    `;
    li.querySelector("button").addEventListener("click", () => removeEmail(entry.email));
    emailList.appendChild(li);
  }
}

async function removeEmail(email) {
  clearError();
  try {
    await apiCall("remove", email);
    showToast(`Removed ${email}`);
    await loadEmails();
  } catch (e) {
    showError(e.message);
  }
}

addEmailBtn.addEventListener("click", async () => {
  clearError();
  const email = newEmailInput.value.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    showError("Please enter a valid email address.");
    return;
  }
  try {
    addEmailBtn.disabled = true;
    await apiCall("add", email);
    newEmailInput.value = "";
    showToast(`Added ${email}`);
    await loadEmails();
  } catch (e) {
    showError(e.message);
  } finally {
    addEmailBtn.disabled = false;
  }
});

signInBtn.addEventListener("click", async () => {
  try { await signInWithPopup(auth, provider); }
  catch (e) { showToast("Sign-in failed."); }
});

signOutBtn.addEventListener("click", async () => {
  try { await signOut(auth); }
  catch (e) { showToast("Sign-out failed."); }
});

onAuthStateChanged(auth, (user) => {
  const signedIn = !!user;
  signInBtn.classList.toggle("hidden", signedIn);
  signOutBtn.classList.toggle("hidden", !signedIn);
  userPill.classList.toggle("hidden", !signedIn);
  authShell.classList.toggle("hidden", signedIn);

  if (!user) {
    adminShell.classList.add("hidden");
    emailList.innerHTML = "";
    clearError();
    userPill.textContent = "";
    return;
  }

  userPill.textContent = user.email || user.displayName || "Signed in";

  if ((user.email || "").toLowerCase() !== ADMIN_EMAIL) {
    adminShell.classList.add("hidden");
    authShell.classList.remove("hidden");
    authShell.querySelector(".card").innerHTML = `
      <h2 style="margin:0 0 8px; font-size:16px;">Access denied</h2>
      <p class="muted-block" style="margin:0;">
        This page is restricted to the admin account (${escapeHtml(ADMIN_EMAIL)}).
        You are signed in as ${escapeHtml(user.email)}.
      </p>
    `;
    return;
  }

  adminShell.classList.remove("hidden");
  loadEmails();
});
