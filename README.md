# Quiz App: online examination platform

A computer-based test (CBT) platform in the style of AFCAT / JEE: timed exams with a question palette, mark for review, auto-save, auto-submit, instant results, leaderboards and a full admin portal.

Stack (unchanged from your original project): **Node.js + Express, MongoDB via Mongoose, JWT auth, plain HTML/CSS/JS frontend** in `/public`. No build step. Live proctoring adds **Socket.IO** (signaling and status) and **WebRTC** (the live camera and microphone).

---

## NEW IN THIS VERSION

1. **Live exam proctoring.** Camera + microphone are required to start an exam. Admins get a **Live Exam Monitoring** section and can **View Live** to watch and hear any candidate in real time.
2. **Profile photo.** Upload, crop, zoom, rotate, change or remove it on *My performance*. It shows in the header, on the exam screen, in the admin candidate list, on the leaderboard and in Live Exam Monitoring.
3. **Sign in with Google** and **sign in with a one-time email code**, plus a *Connected accounts* panel to connect or disconnect Google, verify your email, and set a password.

Everything that existed before still works the same way: same URLs, same database, same admin account.

### P1. Existing project structure (what was found)

| Part | Actual file |
|---|---|
| Server entry point | `server.js` (one Express app) |
| Database | `config/db.js`, MongoDB via `MONGO_URI` in `.env` |
| Auth | `routes/authRoutes.js` (JWT, 8 h), `middleware/authMiddleware.js`, `middleware/adminMiddleware.js` |
| Quiz start / submit | `routes/attemptRoutes.js` (`POST /api/attempt/start/:quizId`, `POST /api/attempt/:id/submit`) |
| Quiz page | `public/quiz.html` + `public/js/quiz.js` (Start button: `#startBtn`) |
| Admin panel | `public/admin.html` + `public/js/admin.js` (hash routes like `#dashboard`) |
| Shared front-end helpers | `public/js/core.js` |
| Models | `models/User.js`, `models/Quiz.js`, `models/Attempt.js` |

### P2. How live proctoring works

```
Candidate browser                          Server (server.js)                    Admin browser
-----------------                          ------------------                    -------------
Start -> getUserMedia(camera+mic)
  denied? exam does NOT start
POST /api/attempt/start  ------------->   creates attempt (unchanged)
Socket.IO "join-exam"    ------------->   checks JWT + own attempt  ---------->  "exam-user-update" (row appears)
"media-status"           ------------->   camera / mic changes      ---------->  table updates live
                                          <------------------------------------  "monitor-start" (View Live)
"monitor-request"        <-------------   only to that candidate
RTCPeerConnection + createOffer
"webrtc-offer"           ------------->   relayed only to that admin -------->  setRemoteDescription, createAnswer
"webrtc-answer"          <-------------   relayed only from that admin <-----  "webrtc-answer"
"ice-candidate"          <------------>   relayed both ways          <------>  "ice-candidate"
=========== live video + audio flows directly browser to browser (WebRTC) ===========>  ontrack -> <video>
Submit -> camera/mic stopped, connections closed, "leave-exam" ---->  "exam-ended"
```

- Video and audio never go through Express, MongoDB or the REST API. Nothing is recorded.
- MongoDB stores only metadata in a new `proctorsessions` collection: user, attempt, exam, start/end time, permission, camera/mic/connection status and an event log (camera-off, mic-on, disconnected, reconnected, ended).
- Every admin who clicks View Live gets their own peer connection, and every candidate is keyed by their attempt ID, so streams never mix.
- Admins previewing a paper on `quiz.html` are not proctored.

### P3. Packages

```bash
npm install socket.io google-auth-library nodemailer
```

These are already in `package.json`, so a plain `npm install` installs them. No other packages were added. **Node.js 20 or newer** is now required (nodemailer needs it).

### P4. Files modified

| File | Change |
|---|---|
| `server.js` | Creates one `http` server shared by Express and Socket.IO. **Fixed `Permissions-Policy` header**: it was `camera=(), microphone=()`, which blocked the camera on every page. Serves `/uploads/avatars`. Bigger body limit only for the photo upload route. Friendly "port in use" message. |
| `models/User.js` | Added `avatar`, `googleId`, `googleEmail`, `googlePicture`, `emailVerified`, `emailCode`. `password` is no longer required (Google-only accounts). Existing users are unaffected. |
| `routes/authRoutes.js` | All existing routes kept. Added Google sign-in, connect/disconnect Google, email code sign-in, email verification, profile photo upload/remove, set first password. |
| `routes/attemptRoutes.js` | On submit, tells Live Monitoring the exam ended. Leaderboard rows include the photo. |
| `routes/adminRoutes.js` | Added `GET /api/admin/proctor/sessions` and `/proctor/sessions/:attemptId` (admin only). The admin users list no longer sends the email-code hash. |
| `public/quiz.html`, `public/js/quiz.js` | Proctoring notice, permission check before the exam starts, error with fix-it steps when blocked, camera preview, stop on submit. Photo in the exam header and palette. |
| `public/admin.html`, `public/js/admin.js` | New sidebar item and route `#live`, the live viewer window, admin photo, candidate photos. |
| `public/login.html`, `public/js/auth.js` | Continue with Google, Email me a sign-in code. |
| `public/profile.html`, `public/js/profile.js` | Photo card with editor, Connected accounts panel, "Set a password" for Google-only accounts. |
| `public/js/core.js` | Photo helpers used by every page; header shows your photo and links to your profile. |
| `public/js/leaderboard.js` | Shows photos. |
| `public/css/app.css`, `auth.css`, `pages.css` | Styles for photos, status dots, social buttons, profile card, photo editor. |
| `.env.example`, `.env`, `.gitignore`, `package.json` | New optional settings, new packages, Node 20. |

### P5. New files

| File | Purpose |
|---|---|
| `utils/proctor.js` | Socket.IO server: login check, candidate/admin events, WebRTC signaling relay, status tracking. |
| `models/ProctorSession.js` | Monitoring metadata (no media). |
| `utils/mailer.js` | Sends email codes by SMTP, or prints them in the terminal when SMTP isn't set. |
| `public/js/proctor-candidate.js` | Camera/mic permission, preview, WebRTC publisher, status reporting, stop. |
| `public/js/proctor-admin.js` | Live Exam Monitoring table and live viewer (WebRTC receiver). |
| `public/js/social.js` | Google sign-in button. |
| `public/css/proctor.css` | Camera preview, monitoring table and viewer styles. |
| `uploads/avatars/` | Where uploaded profile photos are saved. |

### P6. Run it on Windows (VS Code)

You need **Node.js 20+** and **MongoDB** running (MongoDB Community Server as a Windows service, or a MongoDB Atlas URI in `.env`).

1. Unzip the project. In VS Code: **File > Open Folder** and pick the `The Quiz App` folder.
2. Open a terminal: **Terminal > New Terminal**.
3. Make sure you're in the project folder (the one with `server.js`):
   ```powershell
   cd "C:\path\to\The Quiz App"
   ```
4. Install dependencies:
   ```powershell
   npm install
   ```
5. First time only, create an admin and a sample exam:
   ```powershell
   npm run create-admin -- "Admin" admin@example.com "StrongPass123"
   npm run seed
   ```
6. Start the server:
   ```powershell
   npm start
   ```
   You should see `MongoDB Connected` and `http://localhost:3000`.
7. **Candidate:** open **http://localhost:3000** in Chrome. Create an account (or log in).
8. **Admin:** open a **Chrome Incognito window** (Ctrl+Shift+N) or Edge, go to **http://localhost:3000** and log in as the admin. Two windows are needed because each keeps its own login.
9. Admin: click **Live Exam Monitoring** in the sidebar.
10. Candidate: open an exam, tick the checkbox, click **Start examination**.
11. Click **Allow** when the browser asks for the camera and microphone.
12. Admin: the candidate appears instantly with Camera Active, Microphone Active, Exam in progress, Connected.
13. Click **View Live**. The candidate's live camera appears with a red LIVE label.
14. Speak near the candidate's microphone: you hear it and the green level bar moves. (Use headphones when both windows are on one computer, or you'll hear feedback.)
15. Candidate: submit the exam.
16. The candidate's camera light turns off, the viewer says the exam was submitted, and the candidate leaves the list and appears under *Recently ended*.

**Testing on two computers:** browsers only allow the camera on `https://` or `http://localhost`. If the candidate opens `http://192.168.x.x:3000` from another computer, the camera is blocked. For a quick test, run `npx cloudflared tunnel --url http://localhost:3000` (or ngrok) and use the `https://` address it prints. For a real deployment, put the app behind HTTPS (see P9).

### P7. Test checklist

| # | Test | Expected |
|---|---|---|
| 1 | Allow camera + mic | Exam starts, preview shows, Camera: Active, Microphone: Active, Link: Connected |
| 2 | Block camera | "Access to your camera was blocked" with steps for your browser. Timer not started, no attempt created. Try again works after allowing |
| 3 | Block microphone | Same, naming the microphone |
| 4 | Block both | Same, naming camera and microphone |
| 5 | No webcam / camera used by Zoom | Clear message ("couldn't find a camera" / "being used by another app") |
| 6 | Start exam | Row appears in Live Exam Monitoring without refreshing, plus a toast |
| 7 | View Live | Live video + audio, LIVE badge, Connection: Connected. Candidate sees a red LIVE label |
| 8 | Close Monitoring | Stream stops, candidate's LIVE label disappears |
| 9 | Camera unplugged / stopped mid-exam | Candidate: "Camera is off" + "Turn camera back on". Admin: Camera Off, Status Warning, toast |
| 10 | Microphone stopped mid-exam | Admin: Microphone Off, Warning |
| 11 | Turn camera back on | Admin returns to Exam in progress, live view keeps working |
| 12 | Candidate closes the tab/browser | Admin: Disconnected within a few seconds, viewer says the connection dropped |
| 13 | Network lost (Wi-Fi off) | Admin: Disconnected within ~15 s. When Wi-Fi returns, it reconnects and the open viewer resumes |
| 14 | Candidate refreshes | Must allow camera again, then resumes with the same timer; admin sees Connected again |
| 15 | Submit | Camera light off on candidate's PC, admin viewer says submitted, row moves to Recently ended |
| 16 | Time runs out | Same as submit, marked "Time up" |
| 17 | Two or three candidates at once | One row each; View Live shows the right person each time |
| 18 | Candidate opens `/admin.html#live` | Redirected to their home page |
| 19 | Candidate calls `/api/admin/proctor/sessions` | 403 |
| 20 | Candidate's socket sends admin events | Ignored by the server (no list, no stream) |
| 21 | Profile photo | Upload, drag, zoom, rotate, save. Shows in header, exam screen, admin, leaderboard. Edit and Remove work |
| 22 | Email code sign-in | Code arrives by email (or prints in the terminal), wrong code rejected, code works once |
| 23 | Google sign-in (after setting GOOGLE_CLIENT_ID) | New account is created with the Google photo, or an existing account with the same email is connected |

### P8. Optional settings (`.env`)

- **Google sign-in:** at console.cloud.google.com > APIs & Services > Credentials, create an *OAuth client ID* (Web application), add `http://localhost:3000` (and your real domain later) under *Authorised JavaScript origins*, then set `GOOGLE_CLIENT_ID=...` and restart. Until then the Google button explains this instead of failing.
- **Email codes:** set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`. For Gmail use `smtp.gmail.com`, port `465`, and a 16-character *App password*. Without SMTP, codes are printed in the terminal.
- **TURN server:** `TURN_URL`, `TURN_USERNAME`, `TURN_CREDENTIAL`. Only needed if candidates are on strict networks (see troubleshooting).

### P9. Browser requirements

- Chrome, Edge, Firefox or Safari (current versions). WebRTC and camera access are built in.
- **HTTPS is required for camera and microphone everywhere except `localhost`.** On a live server use HTTPS (for example Nginx or Caddy with a Let's Encrypt certificate, or a host that provides HTTPS). With Nginx, also forward WebSockets for `/socket.io/` (`proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";`).
- The admin's browser does not need a camera.

### P10. Troubleshooting

| Problem | Fix |
|---|---|
| **Camera permission error** | Click the camera/lock icon in the address bar, set Camera to Allow, click Try again. Make sure you're on `http://localhost:3000` or an `https://` address. In Windows: Settings > Privacy & security > Camera > allow desktop apps / your browser. |
| **Microphone permission error** | Same, for Microphone. Windows: Settings > Privacy & security > Microphone. |
| "Camera is being used by another app" | Close Zoom, Teams, Meet, OBS or another browser using the camera. |
| **WebRTC connection error** / viewer stuck on "Connecting" | Usually a firewall between the two networks. Same computer or same network works with the built-in STUN. Across strict networks, add a TURN server (`TURN_URL` etc. in `.env`; coturn or a hosted TURN service). |
| **Socket.IO connection error** ("Reconnecting" on the candidate, "Connecting..." on the admin) | The server isn't running or was restarted (it reconnects on its own). Behind a proxy, enable WebSocket forwarding. If it says "Not authorised", log out and back in. |
| **Admin can't see the candidate** | The candidate must click Start and allow camera + mic. Check the admin page says "Real-time updates on". Admins taking a test are not proctored. If the candidate's attempt already ended, it's under Recently ended. |
| **Admin sees the candidate but no video** | Candidate shows Disconnected: wait for them to reconnect (the viewer resumes automatically). Otherwise close and click View Live again, then see the WebRTC row above. |
| **Video works but no audio** | Click **Play sound** if it appears (the browser blocked autoplay). Check the speaker button isn't muted and the volume slider is up. If the green level bar moves but you hear nothing, check your own speakers. If the bar doesn't move, the candidate's Microphone shows Off: their mic is muted in Windows or unplugged. |
| `Port 3000 is already in use` | Close the other terminal running the server, or set `PORT=3001` in `.env`. |
| `Could not connect to MongoDB` | Start the MongoDB service, or fix `MONGO_URI` in `.env`. |
| Google button says "isn't switched on yet" | Set `GOOGLE_CLIENT_ID` in `.env` (P8) and restart. |
| Google popup error "origin not allowed" | Add the exact address (e.g. `http://localhost:3000`) under Authorised JavaScript origins in Google Cloud. |
| Email code never arrives | Without SMTP it's in the server terminal. With SMTP, check the settings; for Gmail you need an App password, not your normal password. |

### P11. What was tested for this version

- **API + Socket.IO (40 checks):** registration, email codes (wrong code, reuse), Google without config, photo upload validation (fake image rejected, 2 MB limit, old file deleted), admin user list hides secrets, socket rejects missing/invalid tokens, candidates can't use admin events or join someone else's attempt, offers/answers only reach the right peer, status changes, disconnect, reconnect, submit ends the session, event log saved.
- **Two real browsers with real WebRTC (34 checks):** email code login, photo upload + edit, proctored start, admin sees the candidate, live video (640x480, moving) and live audio (level meter moving) arrive at the admin, LIVE labels, two candidates at once, camera and mic stopped mid-exam and restored, browser closed, submit, unauthorised access, permission denied.
- **Layout:** exam screen with the camera preview at 1920, 1366, 1280, 1024, 820, 412 and 360 px wide: no overlap with the exam buttons or palette, no horizontal scroll.
- All existing admin and candidate pages re-checked with no script errors.
- Google sign-in was tested up to the server's verification step. The final Google popup needs your own Client ID, so it couldn't be run here.

---

# Original documentation (still valid)

## 1. Quick start

You need **Node.js 20 or newer** and **MongoDB** running locally (or a MongoDB Atlas connection string).

```bash
# 1. install dependencies
npm install

# 2. check .env (a random JWT_SECRET has already been generated for you)
#    change MONGO_URI if your database isn't on localhost

# 3. create an administrator account
npm run create-admin -- "Your Name" admin@example.com "StrongPass123"

# 4. optional: add a sample published exam (your 10 original AI questions)
npm run seed

# 5. start the server
npm start
```

Open **http://localhost:3000**. You'll land on the login page.

- **Candidates** register themselves on the login page.
- **Admins** log in with the account from step 3 and are taken to the Admin portal automatically.

`npm run dev` restarts the server whenever you save a file.

### Environment variables (`.env`)

| Variable | Required | What it does |
|---|---|---|
| `MONGO_URI` | Yes | MongoDB connection string. Default: `mongodb://127.0.0.1:27017/quiz_app` (same database as before, so existing users and quizzes carry over). |
| `JWT_SECRET` | Yes | Signs login tokens. A random 96-character value is already set. Keep it private; never put it in frontend code. |
| `PORT` | No | Defaults to 3000. |
| `CORS_ORIGIN` | No | Comma-separated origins, only if you host the frontend on a different domain. |

To make a new secret: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`. Changing it logs everyone out, which is harmless.

---

## 2. Database changes

**No migration needed.** Mongoose adds the new fields with defaults the first time a document is saved. Your existing users, admin account, passwords and quizzes keep working.

| Collection | New fields |
|---|---|
| `users` | `isActive` (admin can disable accounts), `lastLogin` |
| `quizzes` | `randomizeQuestions`, `randomizeOptions`, `attemptLimit`, `startAt`, `endAt`. Each question also gets optional `topic` and `explanation`. |
| `attempts` | `status`, `startedAt`, `expiresAt` (the server-side deadline), `submittedAt`, `duration`, `percentage`, `passed`, `answers`, `questionOrder`, `review` (a snapshot so old results never change when a quiz is edited), and name/title snapshots. All original fields are kept. |

---

## 3. Dependencies

Only one change: **`bcrypt` was removed and `bcryptjs` is used instead.** `bcryptjs` was already in your `package.json`. It creates identical `$2b$` hashes, so every existing password still works.

Why: your ZIP contained `node_modules` with a Windows-compiled `bcrypt` binary, which crashes on any other machine ("invalid ELF header"). `bcryptjs` is pure JavaScript and runs everywhere.

**Delete your old `node_modules` folder and run `npm install` fresh.**

**Security audit:** `package-lock.json` was refreshed with patch releases (for example Mongoose 7.8.9 to 7.8.12), which cleared 3 of 4 `npm audit` advisories without changing any version ranges. The remaining one is in the copy of `qs` that Express 4 uses to parse URL query strings. This app switches Express to its simple built-in query parser (`app.set("query parser", "simple")` in `server.js`), so that code is no longer used. `npm audit` will still list it because the package is installed. Upgrading to Express 5 later removes it entirely.

Icons (Bootstrap Icons) and fonts (Sora, Manrope) are now bundled in `public/vendor/`, so the app works on exam-hall networks without internet. Nothing else is loaded from a CDN except the two optional background photos, which fall back to a local answer-sheet image if they can't load.

---

## 4. What changed, file by file

### Backend: modified

| File | Change |
|---|---|
| `server.js` | Loads `.env` first, checks config, adds security headers, no-cache for the API, JSON 404s for unknown API routes, 404 page, error handler, `/api/time`, starts the auto-submit sweeper after the database connects. |
| `config/db.js` | Clear error message and exit if MongoDB isn't reachable (previously crashed with an unhandled error). |
| `models/User.js` | Added `isActive`, `lastLogin`. |
| `models/Quiz.js` | Added exam settings (shuffle, attempt limit, availability window) and question `topic` / `explanation`. |
| `models/Attempt.js` | Added server-side timer, saved answers and result snapshot. |
| `middleware/authMiddleware.js` | Re-checks the user in the database on every request, so disabling an account works immediately. |
| `middleware/adminMiddleware.js` | Consistent JSON response. |
| `routes/authRoutes.js` | **Security fix:** registration always creates a normal user (it used to accept `role: "admin"` from the browser). Email/password validation, rate limiting, disabled-account check. New: `GET/PUT /me`, `PUT /change-password`. The `role` field on login still works if sent. |
| `routes/quizRoutes.js` | **Security fix:** `GET /api/quiz` no longer sends correct answers to the browser. Still returns an array, so it stays compatible. New: `GET /available`, `GET /:id`. |
| `routes/attemptRoutes.js` | Replaced with the server-timed exam flow (see API list). The old `POST /api/attempt` never worked (it didn't set `quizId`, so saving always failed) and let the browser decide the score and the time. |
| `routes/adminRoutes.js` | All 9 original endpoints kept with the same URLs. Added edit question, duplicate, question bank, users, results, CSV export, analytics. Validation on everything. |
| `package.json` | New scripts (`dev`, `create-admin`, `seed`), `bcrypt` removed. |
| `.env` | Random `JWT_SECRET` generated. |

### Backend: new files

| File | Purpose |
|---|---|
| `utils/examEngine.js` | Timer, scoring, negative marking, shuffling, auto-finalising expired attempts. |
| `utils/validate.js` | Email, password, id and text validation helpers. |
| `middleware/rateLimit.js` | Small in-memory rate limiter for login and register (no extra dependency). |
| `scripts/createAdmin.js` | `npm run create-admin`: creates or promotes an admin. |
| `scripts/seed.js` | `npm run seed`: publishes "AI Fundamentals" using the 10 questions that were hardcoded in the old `quiz.html`. |
| `.env.example`, `.gitignore` | Config template; keeps `.env` and `node_modules` out of git. |

### Frontend: replaced (same file names)

`index.html`, `login.html`, `home.html`, `dashboard.html`, `quiz.html`, `result.html`, `leaderboard.html`, `admin.html`, `js/auth.js`, `js/home.js`, `js/quiz.js`, `js/result.js`, `js/admin.js`, `css/auth.css`, `css/admin.css`

`index.html` and `dashboard.html` now simply redirect to the right page, so old links and bookmarks still work.

### Frontend: new files

| File | Purpose |
|---|---|
| `profile.html`, `js/profile.js` | "My performance": trend chart, subject averages, attempt history, change name and password. |
| `js/leaderboard.js` | Leaderboard logic (was inline and read from localStorage). |
| `js/core.js` | Shared helpers: API calls, session, guards, toasts, dialogs, theme, navigation. |
| `css/app.css` | Design system shared by every page. |
| `css/pages.css`, `css/exam.css` | Candidate pages and the CBT exam screen. |
| `404.html` | Friendly not-found page. |
| `img/answer-sheet.svg`, `img/favicon.svg` | Local background illustration and icon. |
| `vendor/` | Bundled icons and fonts (with their licences). |

### Frontend: removed

`css/style.css`, `js/dashboard.js` were no longer used by any page. Bootstrap CSS is no longer loaded (the new design system replaces it).

### Untouched

`resetAdmin.js`, `hash.js`, `models/Question.js` are left as they were. `resetAdmin.js` still works, but prefer `npm run create-admin`, which doesn't have an email or password hardcoded in it.

---

## 5. How the timer works (and why refresh doesn't beat it)

1. When a candidate presses **Start**, the server creates the attempt and stores `expiresAt = now + duration`.
2. The browser only displays that deadline. It corrects for any difference between the computer's clock and the server's clock.
3. **Refreshing or closing the page** resumes the same attempt with the same deadline and all saved answers.
4. Every answer is auto-saved. The server rejects saves that arrive after the deadline (plus a 5-second network allowance).
5. At zero the page locks, submits and opens the result.
6. If the browser was closed, a background job on the server submits expired attempts every 30 seconds, so every attempt gets a result.
7. The recorded time taken can never exceed the exam duration.

Admins set the duration per exam (10 / 20 / 30 / 60 / 90 minutes or any value from 1 to 600). Changing it affects attempts started afterwards; running attempts keep their deadline.

---

## 6. API reference

**Auth** `/api/auth`: `POST /register`, `POST /login`, `GET /me`, `PUT /me`, `PUT /change-password`

**Quizzes (candidates)** `/api/quiz`: `GET /` (published, no answers), `GET /available`, `GET /:id`

**Attempts** `/api/attempt`:
- `POST /start/:quizId` starts or resumes an attempt.
- `PUT /:id/answers` auto-saves answers.
- `POST /:id/submit` submits.
- `GET /:id` returns the result with the answer review.
- `GET /my` and `GET /my/stats` return the candidate's history and stats.
- `GET /leaderboard?quizId=` returns the leaderboard.

**Admin** `/api/admin` (admin token required):
- Stats and analytics: `GET /stats`, `GET /analytics`, `GET /analytics/quiz/:id`
- Quizzes: `POST /create-quiz`, `GET /quizzes`, `GET|PUT|DELETE /quiz/:id`, `PATCH /quiz/:id/status`, `POST /quiz/:id/duplicate`
- Questions: `POST /add-question/:id`, `PUT|DELETE /quiz/:quizId/question/:questionId`, `GET /questions` (question bank)
- Users: `GET /users`, `GET /users/:id`, `PATCH /users/:id/status`
- Results: `GET /results`, `GET /results/export` (CSV), `DELETE /results/:id`

`GET /api/test` and `GET /api/time` are open health checks.

---

## 7. How to test every feature

### Candidate flow

1. **Register.** Open `/`, choose "Create account".
   - Try an empty form, a bad email, a weak password, mismatched passwords, and an email that's already registered. Each shows a clear message.
   - A valid form signs you straight in.
2. **Login with Enter.** Log out (icon at top right), type your email and password, press **Enter**. Also try the eye icon and a wrong password.
3. **Home.** The clock ticks every second. Your stats, exam cards, subject filters, search, recent attempts and top candidates all come from the database.
4. **Instructions.** Click "View instructions". The Start button stays disabled until you tick the checkbox.
5. **Exam.**
   - Answer with a click or the keyboard (A to D, 1 to 4).
   - Use Save & next and Previous.
   - Mark for review (or press M), and try Clear response.
   - Jump to any question from the palette and watch the status colours and progress change.
   - On a phone, the palette opens from the grid button in the header.
6. **Refresh mid-exam.** Press F5. You get a "Resume" button, and your answers and the remaining time are exactly where they were. The timer does not reset.
7. **Low-time warnings.** Create a 1-minute exam as admin: the timer turns red with a warning.
8. **Auto-submit.** Wait for zero. The exam locks, submits itself and opens the result, marked "submitted automatically".
9. **Manual submit.** On the last question, "Save & submit" (or the Submit button in the palette) shows a summary of answered, marked and unanswered questions before confirming.
10. **Result.** Check the score, percentage, pass/fail, rank, correct/incorrect/unanswered, accuracy, time used vs allowed, and the answer review with filters.
11. **Leaderboard.** Switch between exams and "All examinations". Your row is highlighted and your position is shown.
12. **My performance.** Check the trend, subjects and history, and change your name or password.
13. **Logout.** You're asked to confirm, then returned to login.

### Admin flow

1. Log in with the admin account. You go straight to the Admin portal.
2. **New examination.** Set a title, subject, difficulty, a **duration preset or custom minutes**, pass mark, negative marking, shuffling, an attempt limit and an opening/closing window.
3. **Add questions.**
   - Click a letter to mark the correct option.
   - Set marks and negative marks, a topic and an explanation.
   - "Save & add another" keeps your marks settings for the next question.
4. **Edit** and **delete** a question.
5. **Preview.** Toggle "Show correct answers", then **Publish** (you can't publish an exam with no questions).
6. **Examinations list.** Search, filter by status, and use the ••• menu: edit, publish/unpublish, close, duplicate, view results, leaderboard, delete.
7. **Question bank.** Search across all exams and filter by subject, difficulty or exam.
8. **Candidates.** Search, view a candidate's attempts, and disable an account. The candidate is logged out on their next click and hidden from leaderboards. Enabling restores them.
9. **Results.** Filter and search, open any result, delete a record, **Export CSV**.
10. **Analytics.** See each exam's average, pass rate and time, plus per-question accuracy sorted hardest first.

### Security checks you can try

- Log in as a candidate and open `/admin.html`: you're redirected. Calling `/api/admin/stats` with a candidate token returns 403.
- Send `{"role":"admin"}` to `/api/auth/register`: the account is still created as a normal user.
- `GET /api/quiz` contains no correct answers.
- After 25 login attempts in 15 minutes from one IP, further attempts get a friendly "try again in N minutes".

---

## 8. What was tested

- **API:** 75 end-to-end checks against a live MongoDB-compatible database. They cover every route, validation, role escalation, the refresh-resume deadline, late answers being rejected, auto-submit, scoring with negative marks, attempt limits, disabled accounts, CSV export, and deletes persisting to the database.
- **Browser (Chromium), candidate and admin flows:**
  - Full candidate flow on desktop and mobile, including refresh mid-exam and auto-submit at zero.
  - Full admin flow: create an exam, add, edit and delete questions, preview, publish, change the timer, visit every section, export.
  - No console errors in any flow.
- **Responsive:** every page at 1920×1080, 1366×768, 1280×720, 820×1180, 768×1024, 412×915 (Android), 390×844 (iPhone) and 360×740. No horizontal overflow and no console errors in any of the 104 combinations.

---

## 9. Troubleshooting

| Problem | Fix |
|---|---|
| `Could not connect to MongoDB` | Start MongoDB, or correct `MONGO_URI` in `.env`. |
| `invalid ELF header` / bcrypt error | Delete `node_modules` and run `npm install`. |
| `JWT_SECRET is missing` | Make sure `.env` is in the project root (next to `server.js`). |
| Everyone got logged out | Expected after `JWT_SECRET` changes, or after 8 hours (token lifetime). |
| Can't publish an exam | Add at least one question first. |
| Candidate can't start an exam | Check it's published, inside its opening window, and they haven't hit the attempt limit. |
