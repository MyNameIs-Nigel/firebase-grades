# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This App Does

A personal Canvas LMS grade viewer. Users sign in with Google (Firebase Auth), then can:
1. **Refresh grades** — the backend pulls current grades from Canvas and stores them in Firestore; the frontend displays them in real time via an `onSnapshot` listener.
2. **Check coursework load** — query assignments due between now and a chosen date, returned as a summary by course.

## Repository Layout

```
public/                 # Firebase Hosting: vanilla JS SPA (no build step)
  index.html            # All CSS inline; imports app.js as ES module
  app.js                # Firebase SDK (CDN), auth, Firestore listener, backend calls

context/backend/        # Node.js/Express server (runs on home Ubuntu box via pm2)
  server.js             # Single-file backend — all routes, helpers, Firebase Admin init
  package.json          # ES modules ("type":"module"), node 18, express/cors/firebase-admin
```

## Architecture

**Two separate runtimes:**

| Layer | Runtime | Deploy |
|---|---|---|
| Frontend | Firebase Hosting (static) | `firebase deploy` |
| Backend | Ubuntu home server, pm2 | GitHub webhook auto-deploy |

**Request flow:**
1. Browser acquires a Firebase ID token via `user.getIdToken()`.
2. Token is sent as `Authorization: Bearer <token>` to the backend.
3. Backend verifies with Firebase Admin SDK, then checks Firestore `allowedEmails/{email}` (60 s in-memory cache) before touching Canvas.
4. Canvas API calls paginate via `Link` headers; concurrency is limited to 5 parallel requests for the coursework summary endpoint.
5. Grades are written to Firestore `grades/{courseId}` (batch); the Firestore `onSnapshot` in the frontend auto-updates the UI.

**Backend routes:**
- `GET /health` — liveness check
- `POST /refresh` — fetch all active Canvas courses + scores → write to Firestore
- `POST /coursework-summary` — body: `{ startDate, endDate }` ISO strings → return assignments due in range, by course
- `POST /deploy` — GitHub webhook (HMAC-SHA256 verified); runs `git pull && npm install && pm2 restart grades-backend`

## Running the Backend Locally

```bash
cd context/backend
npm install
```

Required environment variables (set before starting):
```
CANVAS_BASE_URL=https://byui.instructure.com
CANVAS_TOKEN=<canvas api token>
ADMIN_EMAIL=<your email>
FIREBASE_SERVICE_ACCOUNT_JSON=<service account json as a single-line string>
PORT=8080                        # optional, defaults to 8080
GITHUB_WEBHOOK_SECRET=<secret>   # optional, only needed for /deploy
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

The Firebase project is `nigelsmith-pf`. The live URL is `https://grades.ndsironwood.com`.

## Authorization Model

Access to the backend is restricted by the `allowedEmails` Firestore collection. To grant access to a user:
- Create a document at `allowedEmails/{email}` with `{ enabled: true }`.

The `ADMIN_EMAIL` env var is required at startup but the actual authorization check is purely Firestore-driven.

## Key Design Decisions

- **No build toolchain** — the frontend is plain HTML/JS using Firebase SDK from CDN. No npm, no bundler.
- **Single-file backend** — all logic lives in `server.js`. Keep it that way unless complexity demands otherwise.
- **Canvas pagination safety cap** — `fetchAllCanvas` stops after 20 pages to prevent runaway requests on the home server.
- **CORS allowlist** is hardcoded in `server.js` (`allowedOrigins` array). Update it when adding new frontend origins.
