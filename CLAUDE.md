# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This App Does

A personal Canvas LMS grade viewer and assignment tracker. Users sign in with Google (Firebase Auth), then can:
1. **Refresh grades** — the backend pulls current grades from Canvas and stores them in Firestore; the frontend displays them in real time via an `onSnapshot` listener.
2. **Browse assignments** — all assignments (with submission/grade status) are synced from Canvas to Firestore and displayed grouped by due date, filterable by course, with a "Jump to Today" shortcut.
3. **Admin panel** — a separate page (`admin.html`) lets the hardcoded admin manage the email allowlist (add, remove, enable/disable).
4. **Automated notifications** — a cron process checks for unsubmitted assignments due within 4 hours and sends email alerts via Resend.

## Architecture

**Three separate processes:**

| Process | Runtime | pm2 name | Deploy |
|---|---|---|---|
| Frontend | Firebase Hosting (static) | — | GitHub Actions on merge + PR preview |
| Backend (`server.js`) | Ubuntu home server, pm2 | `firebase-grades` | GitHub webhook auto-deploy |
| Cron (`cron.js`) | Ubuntu home server, pm2 | `firebase-grades-cron` | GitHub webhook auto-deploy |

**Request flow:**
1. Browser acquires a Firebase ID token via `user.getIdToken()`.
2. Token is sent as `Authorization: Bearer <token>` to the backend (`https://grades-backend.ndsironwood.com`).
3. Backend verifies with Firebase Admin SDK, then checks Firestore `allowedEmails/{email}` (60 s in-memory cache) before touching Canvas.
4. Canvas API calls paginate via `Link` headers; concurrency is limited to 5 parallel requests for assignments.
5. Data is written to Firestore via batches; `onSnapshot` listeners in the frontend auto-update the UI.

**Cron → Backend communication:** `cron.js` calls `server.js` endpoints via `http://localhost:{port}`. Localhost requests bypass Firebase auth — see `isLocalhostRequest()` in `server.js`.

**Multi-Canvas support:** The primary instance is configured via `CANVAS_BASE_URL`/`CANVAS_TOKEN`. An optional second instance via `CANVAS2_BASE_URL`/`CANVAS2_TOKEN` — both are queried in parallel during refresh.

## Running Locally

```bash
npm install
node server.js     # start the backend
node cron.js       # start the cron worker (requires backend to be running)
```

There are no npm scripts, no test runner, and no linter configured.

**Required `.env` variables:**
```
CANVAS_BASE_URL=https://byui.instructure.com
CANVAS_TOKEN=<canvas api token>
ADMIN_EMAIL=<your email>
RESEND_API_KEY=<resend api key>           # required for cron.js only
PORT=8080                                  # optional, defaults to 8080
BACKEND_PORT=8080                          # optional, used by cron.js, defaults to 8080
CANVAS2_BASE_URL=<second url>              # optional
CANVAS2_TOKEN=<second token>               # optional
GITHUB_WEBHOOK_SECRET=<secret>             # optional, only needed for /deploy
```

Firebase Admin credentials must be in `firebase-admin.json` at the project root (not committed).

**pm2 on the home server:**
```bash
pm2 start server.js --name firebase-grades
pm2 start cron.js --name firebase-grades-cron
```

## Deploying the Frontend

```bash
firebase deploy --only hosting
```

GitHub Actions auto-deploy on merge to `main` and create preview URLs on PRs. Both workflows also post a Discord notification with commit/PR info and the deployed URL. Firebase project: `nigelsmith-pf`. Live URL: `https://grades.ndsironwood.com`.

## Backend Routes (`server.js`)

- `GET /health` — liveness check, no auth
- `POST /refresh` — fetch all active Canvas courses + scores → write to Firestore `grades/{courseId}`
- `POST /refresh-assignments` — fetch all assignments with submission data → write to Firestore `assignments/{assignmentId}`
- `POST /admin/emails` — manage allowlist; body `{ action, email?, enabled? }` where action is `list`, `add`, `remove`, or `toggle`; admin-only (hardcoded to the `ADMIN_EMAIL`)
- `POST /deploy` — GitHub webhook (HMAC-SHA256 verified); runs `git pull && npm install && pm2 restart ...`

## Cron Jobs (`cron.js`)

- Every 2 hours — calls `POST /refresh-assignments` on the local backend
- Every 15 minutes — queries Firestore for unsubmitted assignments due within 4 hours, sends email via Resend, marks them `notified: true`
- Both jobs also run once at startup

## Firestore Collections

- `grades/{courseId}` — `course_id`, `course_name`, `grade` (letter or null), `score` (number or null), `date_checked` (Timestamp). Written with `merge: true` to preserve any extra fields.
- `assignments/{assignmentId}` — `course_id`, `course_name`, `name`, `due_date`, `submission_date`, `submitted`, `graded`, `points`, `max_points`, `notified`, `last_updated`
- `allowedEmails/{email}` — `{ enabled: boolean }` — access control list
- `semesterGrades/{semesterId}/classes/{classId}` — GPA calculator data; clients with allowlisted emails can read/write directly

## Authorization Model

Access requires a document at `allowedEmails/{email}` with `{ enabled: true }`. Add via admin page at `/admin.html` or directly in Firestore.

The `/admin/emails` endpoint is restricted to the hardcoded `ADMIN_EMAIL`. Localhost requests (from `cron.js`) bypass token verification entirely — see `isLocalhostRequest()`.

## Key Helpers in `server.js`

- `fetchAllCanvas(url, token)` — paginates Canvas API via `Link` headers, hard-stops at 20 pages
- `mapLimit(items, limit, asyncFn)` — concurrency-limited async map; used with limit=5 for assignment fetches
- `withTimeout(promise, ms)` — wraps a promise with a timeout rejection
- `fetchWithTimeout(url, opts)` — `fetch` with a 15 s AbortController timeout
- `allowCache` — 60 s in-memory TTL cache for `allowedEmails` lookups; invalidated on add/remove/toggle

## Key Design Decisions

- **No build toolchain** — frontend is plain HTML/JS using Firebase SDK from CDN.
- **Single-file backend** — all logic lives in `server.js`. Keep it that way unless complexity demands otherwise.
- **ES modules** — `package.json` has `"type": "module"`; use `import`/`export` throughout.
- **Ignored courses** — `IGNORED_COURSE_IDS` (48558, 47054) in `server.js` and `IGNORED_COURSE_NAMES` ("cse majors", "mathematics majors") in `app.js` filter out non-class Canvas entries.
- **CORS allowlist** — hardcoded `allowedOrigins` array in `server.js`; update when adding new frontend origins.
- **Firestore batch limit** — assignment writes chunk at 500 docs per batch.
- **30 s request timeout** — Express middleware hard-stops requests that take too long.
- **Email deduplication** — `notified` flag on assignment docs prevents duplicate Resend alerts.
