# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This App Does

A personal Canvas LMS grade viewer and assignment tracker. Users sign in with Google (Firebase Auth), then can:
1. **Refresh grades** — the backend pulls current grades from Canvas and stores them in Firestore; the frontend displays them in real time via an `onSnapshot` listener.
2. **Browse assignments** — all assignments (with submission/grade status) are synced from Canvas to Firestore and displayed grouped by due date, filterable by course, with a "Jump to Today" shortcut.
3. **Admin panel** — a separate page (`admin.html`) lets the hardcoded admin manage the email allowlist (add, remove, enable/disable).

## Repository Layout

```
public/                 # Firebase Hosting: vanilla JS SPA (no build step)
  index.html            # Main page — grades + assignments views
  app.js                # Firebase SDK (CDN), auth, Firestore listeners, backend calls
  admin.html            # Admin page — manage allowed emails
  admin.js              # Admin page logic (list/add/remove/toggle emails)
  styles.css            # Shared stylesheet for both pages
  404.html              # Custom 404 page

server.js               # Single-file Node.js/Express backend — all routes, helpers, Firebase Admin init
package.json            # ES modules ("type":"module"), node 18, express/cors/firebase-admin

firebase.json           # Firebase project config (Hosting + Firestore)
firestore.rules         # Firestore security rules
firestore.indexes.json  # Firestore composite indexes
.github/workflows/      # GitHub Actions for Firebase Hosting deploy on merge/PR
```

## Architecture

**Two separate runtimes:**

| Layer | Runtime | Deploy |
|---|---|---|
| Frontend | Firebase Hosting (static) | GitHub Actions on merge + PR preview |
| Backend | Ubuntu home server, pm2 | GitHub webhook auto-deploy |

**Request flow:**
1. Browser acquires a Firebase ID token via `user.getIdToken()`.
2. Token is sent as `Authorization: Bearer <token>` to the backend (`https://grades-backend.ndsironwood.com`).
3. Backend verifies with Firebase Admin SDK, then checks Firestore `allowedEmails/{email}` (60 s in-memory cache) before touching Canvas.
4. Canvas API calls paginate via `Link` headers; concurrency is limited to 5 parallel requests for assignments.
5. Data is written to Firestore via batches; `onSnapshot` listeners in the frontend auto-update the UI.

**Multi-Canvas support:** The backend supports multiple Canvas instances. The primary instance is configured via `CANVAS_BASE_URL`/`CANVAS_TOKEN`. An optional second instance can be added via `CANVAS2_BASE_URL`/`CANVAS2_TOKEN` — both are queried in parallel during refresh.

**Backend routes:**
- `GET /health` — liveness check
- `POST /refresh` — fetch all active Canvas courses + scores → write to Firestore `grades/{courseId}`
- `POST /refresh-assignments` — fetch all assignments (with submission data) for every active course → write to Firestore `assignments/{assignmentId}`
- `POST /admin/emails` — manage allowed emails; body `{ action, email?, enabled? }` where action is `list`, `add`, `remove`, or `toggle` (admin-only, hardcoded to `smi23081@byui.edu`)
- `POST /deploy` — GitHub webhook (HMAC-SHA256 verified); runs `git pull && npm install && pm2 restart firebase-grades`

**Firestore collections:**
- `grades/{courseId}` — course name, grade letter, numeric score, last checked timestamp
- `assignments/{assignmentId}` — assignment name, course, due date, submission/graded status, score, last updated
- `allowedEmails/{email}` — `{ enabled: boolean }` access control

**Ignored courses:** `IGNORED_COURSE_IDS` in `server.js` and `IGNORED_COURSE_NAMES` in `app.js` filter out non-class entries from Canvas.

## Running the Backend Locally

```bash
npm install
```

Required environment variables (set before starting):
```
CANVAS_BASE_URL=https://byui.instructure.com
CANVAS_TOKEN=<canvas api token>
ADMIN_EMAIL=<your email>
FIREBASE_SERVICE_ACCOUNT_JSON=<service account json as a single-line string>
PORT=8080                          # optional, defaults to 8080
CANVAS2_BASE_URL=<second url>      # optional, second Canvas instance
CANVAS2_TOKEN=<second token>       # optional, second Canvas instance
GITHUB_WEBHOOK_SECRET=<secret>     # optional, only needed for /deploy
```

```bash
node server.js
```

On the home server, the process is managed by pm2 under the name `firebase-grades`.

## Deploying the Frontend

```bash
firebase deploy          # deploys public/ to Firebase Hosting
firebase deploy --only hosting   # hosting only
```

GitHub Actions also auto-deploy on merge to main and create preview URLs on PRs.

The Firebase project is `nigelsmith-pf`. The live URL is `https://grades.ndsironwood.com`.

## Authorization Model

Access to the backend is restricted by the `allowedEmails` Firestore collection. To grant access to a user:
- Create a document at `allowedEmails/{email}` with `{ enabled: true }`, or use the admin page at `/admin.html`.

The admin page and `/admin/emails` endpoint are restricted to the hardcoded admin email (`smi23081@byui.edu`).

## Key Design Decisions

- **No build toolchain** — the frontend is plain HTML/JS using Firebase SDK from CDN. No npm, no bundler.
- **Single-file backend** — all logic lives in `server.js`. Keep it that way unless complexity demands otherwise.
- **Canvas pagination safety cap** — `fetchAllCanvas` stops after 20 pages to prevent runaway requests on the home server.
- **Firestore batch limit** — assignment writes chunk at 500 docs per batch (Firestore's limit).
- **30 s request timeout** — Express middleware hard-stops requests that take too long.
- **CORS allowlist** is hardcoded in `server.js` (`allowedOrigins` array). Update it when adding new frontend origins.
