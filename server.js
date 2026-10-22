require("dotenv").config();

const http = require("http");
const fs = require("fs");
const express = require("express");
const cors = require("cors");
const path = require("path");
const connectDB = require("./config/db");
const { startSweeper, finalizeExpired } = require("./utils/examEngine");

const authRoutes = require("./routes/authRoutes");
const adminRoutes = require("./routes/adminRoutes");
const quizRoutes = require("./routes/quizRoutes");
const attemptRoutes = require("./routes/attemptRoutes");
const proctor = require("./utils/proctor");

/* ---------- config checks ---------- */

if (!process.env.JWT_SECRET) {
    console.error("JWT_SECRET is missing. Copy .env.example to .env and set it.");
    process.exit(1);
}

if (process.env.JWT_SECRET === "change_this_to_a_long_random_secret_key" || process.env.JWT_SECRET.length < 24) {
    console.warn("WARNING: JWT_SECRET is weak or still the default. Set a long random value in .env before going live.");
}

const app = express();

app.disable("x-powered-by");
app.set("trust proxy", 1);

/* All query strings in this app are flat (?quizId=...&search=...), so use
   Node's simple parser instead of qs (smaller attack surface). */
app.set("query parser", "simple");

/* Basic security headers (no extra dependency needed) */
app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    /* camera and microphone are allowed for this site only (live exam proctoring) */
    res.setHeader("Permissions-Policy", "camera=(self), microphone=(self), geolocation=()");
    next();
});

app.use(cors(process.env.CORS_ORIGIN ? { origin: process.env.CORS_ORIGIN.split(",") } : undefined));
/* profile photos are sent as a small base64 image, so this one route gets a bigger limit */
app.use("/api/auth/avatar", express.json({ limit: "3mb" }));
app.use(express.json({ limit: "200kb" }));
app.use(express.urlencoded({ extended: true, limit: "200kb" }));

/* API responses must never be cached (answers, timers, results) */
app.use("/api", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
});

/* FRONTEND  (/login also works for /login.html) */
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));

/* Uploaded profile photos */
const AVATAR_DIR = path.join(__dirname, "uploads", "avatars");
fs.mkdirSync(AVATAR_DIR, { recursive: true });
app.use("/uploads/avatars", express.static(AVATAR_DIR, { maxAge: "7d" }));

/* API ROUTES */
app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/quiz", quizRoutes);
app.use("/api/attempt", attemptRoutes);

/* TEST API (unchanged) */
app.get("/api/test", (req, res) => {
    res.json({
        success: true,
        message: "Quiz App API is working"
    });
});

/* Server clock, used by the home page and the exam timer */
app.get("/api/time", (req, res) => {
    res.json({ success: true, serverNow: new Date() });
});

/* Unknown API route */
app.use("/api", (req, res) => {
    res.status(404).json({ success: false, message: "API route not found" });
});

/* Unknown page */
app.use((req, res) => {
    res.status(404).sendFile(path.join(__dirname, "public", "404.html"));
});

/* Error handler (e.g. malformed JSON body) */
app.use((err, req, res, next) => {
    if (err.type === "entity.parse.failed") {
        return res.status(400).json({ success: false, message: "The request was not valid JSON" });
    }
    if (err.type === "entity.too.large") {
        return res.status(413).json({ success: false, message: "The request is too large" });
    }
    console.error("UNHANDLED ERROR:", err);
    res.status(500).json({ success: false, message: "Something went wrong on the server" });
});

/* START SERVER (after the database is ready) */
const PORT = process.env.PORT || 3000;

connectDB().then(() => {

    finalizeExpired().catch(() => {});
    startSweeper();

    /* one HTTP server shared by Express and Socket.IO (live proctoring) */
    const server = http.createServer(app);
    proctor.attach(server);

    server.on("error", (error) => {
        if (error.code === "EADDRINUSE") {
            console.error(`Port ${PORT} is already in use. Close the other server or set a different PORT in .env.`);
        } else {
            console.error("Server error:", error.message);
        }
        process.exit(1);
    });

    server.listen(PORT, () => {
        console.log("=================================");
        console.log("Quiz App Server Started");
        console.log("http://localhost:" + PORT);
        console.log("=================================");
    });
});
