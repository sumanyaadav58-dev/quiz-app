/* =========================================================
   LIVE EXAM PROCTORING (Socket.IO)

   Socket.IO carries only small messages: who is sitting an exam,
   camera / microphone / connection status, and WebRTC signaling
   (offer, answer, ICE candidates). The camera and microphone stream
   itself goes directly from the candidate's browser to the admin's
   browser over WebRTC. Nothing is recorded or stored.

   Events
   candidate -> server : join-exam, media-status, webrtc-offer, ice-candidate, leave-exam
   server -> candidate : monitor-request, webrtc-answer, ice-candidate, monitor-stop, viewers, session-replaced
   admin -> server     : monitor-list, monitor-start, webrtc-answer, ice-candidate, monitor-stop
   server -> admin     : exam-sessions, exam-user-update, exam-ended, webrtc-offer, ice-candidate, candidate-offline

   Security
   - Every socket must present a valid login token (same JWT as the REST API)
     and the account must still exist and be enabled.
   - Only role "admin" can list candidates, request a stream or receive one.
   - A candidate can only join with their own in-progress attempt.
   - Signaling is only relayed between a candidate and the admins who asked
     to watch that candidate, so streams never mix.
========================================================= */

const jwt = require("jsonwebtoken");
const { Server } = require("socket.io");

const User = require("../models/User");
const Attempt = require("../models/Attempt");
const ProctorSession = require("../models/ProctorSession");
const { isId } = require("./validate");
const engine = require("./examEngine");

/* attemptId -> live state (one entry per candidate sitting an exam) */
const sessions = new Map();
let io = null;

/* ---------------- helpers ---------------- */

function iceServers() {
    const list = [];
    const stun = (process.env.STUN_URLS || "stun:stun.l.google.com:19302")
        .split(",").map(s => s.trim()).filter(Boolean);
    if (stun.length) list.push({ urls: stun });
    if (process.env.TURN_URL) {
        list.push({
            urls: process.env.TURN_URL.split(",").map(s => s.trim()).filter(Boolean),
            username: process.env.TURN_USERNAME || "",
            credential: process.env.TURN_CREDENTIAL || ""
        });
    }
    return list;
}

function publicSession(s) {
    return {
        sessionId: s.attemptId,
        attemptId: s.attemptId,
        userId: s.userId,
        userName: s.userName,
        email: s.email,
        avatar: s.avatar,
        quizId: s.quizId,
        quizTitle: s.quizTitle,
        startedAt: s.startedAt,
        expiresAt: s.expiresAt,
        camera: s.camera,
        mic: s.mic,
        cameraPermission: s.cameraPermission,
        micPermission: s.micPermission,
        connection: s.socketId ? "connected" : "disconnected",
        lastSeenAt: s.lastSeenAt,
        viewers: s.viewers.size
    };
}

function list() {
    return [...sessions.values()]
        .map(publicSession)
        .sort((a, b) => new Date(a.startedAt) - new Date(b.startedAt));
}

function toAdmins(event, payload) {
    if (io) io.to("admins").emit(event, payload);
}

function broadcast(s) {
    toAdmins("exam-user-update", publicSession(s));
}

function tellViewerCount(s) {
    if (io && s.socketId) io.to(s.socketId).emit("viewers", { count: s.viewers.size });
}

/* write to MongoDB without ever blocking or crashing the socket handlers */
function persist(attemptId, set, eventType) {
    const update = { $set: { ...set, lastSeenAt: new Date() } };
    if (eventType) update.$push = { events: { $each: [{ type: eventType, at: new Date() }], $slice: -100 } };
    ProctorSession.updateOne({ attemptId }, update).catch(err => console.error("Proctor save failed:", err.message));
}

const onOff = (v) => (v ? "active" : "off");

/* ---------------- end a session ---------------- */

function endSession(attemptId, reason = "submitted") {
    attemptId = String(attemptId);
    const s = sessions.get(attemptId);
    if (!s) return false;
    sessions.delete(attemptId);

    for (const viewerId of s.viewers) {
        io.to(viewerId).emit("candidate-offline", { sessionId: attemptId, reason: "ended" });
    }
    if (s.socketId) io.to(s.socketId).emit("exam-closed", { reason });

    persist(attemptId, {
        endedAt: new Date(),
        endReason: reason,
        connectionStatus: "ended",
        cameraStatus: "off",
        micStatus: "off"
    }, "ended:" + reason);

    toAdmins("exam-ended", { sessionId: attemptId, reason });
    return true;
}

/* Called by the REST submit route, so the admin list updates even if the
   candidate's socket message never arrives. */
function endByAttempt(attemptId, reason) {
    return endSession(attemptId, reason);
}

/* Attempts submitted by the server sweeper (time ran out with the browser closed) */
async function sweep() {
    if (!sessions.size) return;
    const ids = [...sessions.keys()];
    const attempts = await Attempt.find({ _id: { $in: ids } }).select("status expiresAt").lean();
    const byId = new Map(attempts.map(a => [String(a._id), a]));
    for (const id of ids) {
        const a = byId.get(id);
        if (!a) endSession(id, "removed");
        else if (a.status === "submitted") endSession(id, "submitted");
        else if (engine.isExpired(a)) endSession(id, "time-up");
    }
}

/* ---------------- socket authentication ---------------- */

async function authenticate(socket, next) {
    try {
        const raw = (socket.handshake.auth && socket.handshake.auth.token) || "";
        const token = String(raw).replace(/^Bearer\s+/i, "");
        if (!token) return next(new Error("AUTH_REQUIRED"));

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.id).select("name email role isActive avatar").lean();
        if (!user) return next(new Error("AUTH_INVALID"));
        if (user.isActive === false) return next(new Error("ACCOUNT_DISABLED"));

        socket.data.user = {
            id: String(user._id),
            name: user.name,
            email: user.email,
            role: user.role,
            avatar: user.avatar || ""
        };
        next();
    } catch (error) {
        next(new Error("AUTH_INVALID"));
    }
}

/* ---------------- candidate handlers ---------------- */

function candidateHandlers(socket) {
    const me = socket.data.user;
    let mySessionId = null;

    const mine = () => {
        const s = mySessionId && sessions.get(mySessionId);
        return s && s.socketId === socket.id ? s : null;
    };

    socket.on("join-exam", async (payload = {}, ack = () => {}) => {
        try {
            const attemptId = String(payload.attemptId || "");
            if (!isId(attemptId)) return ack({ ok: false, message: "Invalid attempt" });

            const attempt = await Attempt.findById(attemptId).select("userId quizId quizTitle status expiresAt startedAt").lean();
            if (!attempt || String(attempt.userId) !== me.id) return ack({ ok: false, message: "Attempt not found" });
            if (attempt.status !== "in_progress" || engine.isExpired(attempt)) {
                return ack({ ok: false, message: "This attempt is no longer running" });
            }

            const camera = Boolean(payload.camera);
            const mic = Boolean(payload.mic);
            const perm = (v) => (["granted", "denied"].includes(v) ? v : "unknown");

            let s = sessions.get(attemptId);
            const reconnect = Boolean(s);

            if (s && s.socketId && s.socketId !== socket.id) {
                /* the exam was opened in another tab or the page was reloaded */
                io.to(s.socketId).emit("session-replaced");
                for (const viewerId of s.viewers) io.to(viewerId).emit("candidate-offline", { sessionId: attemptId, reason: "reconnecting" });
                s.viewers.clear();
            }

            if (!s) {
                s = {
                    attemptId,
                    userId: me.id,
                    userName: me.name,
                    email: me.email,
                    avatar: me.avatar,
                    quizId: String(attempt.quizId),
                    quizTitle: attempt.quizTitle || "Examination",
                    startedAt: attempt.startedAt || new Date(),
                    expiresAt: attempt.expiresAt,
                    viewers: new Set()
                };
                sessions.set(attemptId, s);
            }

            s.socketId = socket.id;
            s.camera = camera;
            s.mic = mic;
            s.cameraPermission = perm(payload.cameraPermission);
            s.micPermission = perm(payload.micPermission);
            s.lastSeenAt = new Date();
            mySessionId = attemptId;
            socket.join("exam:" + attemptId);

            await ProctorSession.updateOne(
                { attemptId },
                {
                    $setOnInsert: {
                        userId: me.id,
                        quizId: attempt.quizId,
                        startedAt: new Date()
                    },
                    $set: {
                        userName: me.name,
                        quizTitle: s.quizTitle,
                        cameraPermission: s.cameraPermission,
                        micPermission: s.micPermission,
                        cameraStatus: onOff(camera),
                        micStatus: onOff(mic),
                        connectionStatus: "connected",
                        endedAt: null,
                        endReason: "",
                        lastSeenAt: new Date()
                    },
                    $push: { events: { $each: [{ type: reconnect ? "reconnected" : "joined", at: new Date() }], $slice: -100 } }
                },
                { upsert: true }
            );

            broadcast(s);
            ack({ ok: true, sessionId: attemptId, iceServers: iceServers() });
        } catch (error) {
            console.error("join-exam failed:", error.message);
            ack({ ok: false, message: "Could not connect to live monitoring" });
        }
    });

    socket.on("media-status", (payload = {}) => {
        const s = mine();
        if (!s) return;
        const camera = Boolean(payload.camera);
        const mic = Boolean(payload.mic);
        const changes = [];
        if (camera !== s.camera) changes.push("camera-" + (camera ? "on" : "off"));
        if (mic !== s.mic) changes.push("mic-" + (mic ? "on" : "off"));
        s.camera = camera;
        s.mic = mic;
        s.lastSeenAt = new Date();
        if (changes.length) {
            persist(s.attemptId, { cameraStatus: onOff(camera), micStatus: onOff(mic) }, changes.join(","));
            broadcast(s);
        }
    });

    /* candidate -> one specific admin who asked to watch */
    socket.on("webrtc-offer", (payload = {}) => {
        const s = mine();
        if (!s || !payload.to || !s.viewers.has(payload.to) || !payload.sdp) return;
        io.to(payload.to).emit("webrtc-offer", { sessionId: s.attemptId, sdp: payload.sdp });
    });

    socket.on("ice-candidate", (payload = {}) => {
        const s = mine();
        if (!s || !payload.to || !s.viewers.has(payload.to)) return;
        io.to(payload.to).emit("ice-candidate", { sessionId: s.attemptId, candidate: payload.candidate || null });
    });

    socket.on("leave-exam", (payload = {}) => {
        const s = mine();
        if (!s) return;
        const reason = ["submitted", "time-up", "left"].includes(payload.reason) ? payload.reason : "left";
        endSession(s.attemptId, reason);
        mySessionId = null;
    });

    socket.on("disconnect", () => {
        const s = mine();
        if (!s) return;
        /* closed the tab, lost the network, or the computer went to sleep */
        s.socketId = null;
        s.camera = false;
        s.mic = false;
        s.lastSeenAt = new Date();
        for (const viewerId of s.viewers) io.to(viewerId).emit("candidate-offline", { sessionId: s.attemptId, reason: "disconnected" });
        s.viewers.clear();
        persist(s.attemptId, { connectionStatus: "disconnected", cameraStatus: "off", micStatus: "off" }, "disconnected");
        broadcast(s);
    });
}

/* ---------------- admin handlers ---------------- */

function adminHandlers(socket) {
    const watching = new Set();   /* sessionIds this admin socket is viewing */

    socket.join("admins");
    socket.emit("exam-sessions", list());

    socket.on("monitor-list", (_, ack) => {
        if (typeof ack === "function") ack(list());
        else socket.emit("exam-sessions", list());
    });

    socket.on("monitor-start", (payload = {}, ack = () => {}) => {
        const s = sessions.get(String(payload.sessionId || ""));
        if (!s) return ack({ ok: false, message: "This candidate is no longer sitting the exam." });
        if (!s.socketId) return ack({ ok: false, message: "The candidate is offline right now. Live video will be available when they reconnect." });

        s.viewers.add(socket.id);
        watching.add(s.attemptId);
        io.to(s.socketId).emit("monitor-request", { viewerId: socket.id });
        tellViewerCount(s);
        broadcast(s);
        ack({ ok: true, session: publicSession(s), iceServers: iceServers() });
    });

    socket.on("webrtc-answer", (payload = {}) => {
        const s = sessions.get(String(payload.sessionId || ""));
        if (!s || !s.socketId || !s.viewers.has(socket.id) || !payload.sdp) return;
        io.to(s.socketId).emit("webrtc-answer", { from: socket.id, sdp: payload.sdp });
    });

    socket.on("ice-candidate", (payload = {}) => {
        const s = sessions.get(String(payload.sessionId || ""));
        if (!s || !s.socketId || !s.viewers.has(socket.id)) return;
        io.to(s.socketId).emit("ice-candidate", { from: socket.id, candidate: payload.candidate || null });
    });

    const stop = (sessionId) => {
        const s = sessions.get(sessionId);
        watching.delete(sessionId);
        if (!s || !s.viewers.delete(socket.id)) return;
        if (s.socketId) io.to(s.socketId).emit("monitor-stop", { viewerId: socket.id });
        tellViewerCount(s);
        broadcast(s);
    };

    socket.on("monitor-stop", (payload = {}) => stop(String(payload.sessionId || "")));
    socket.on("disconnect", () => [...watching].forEach(stop));
}

/* ---------------- setup ---------------- */

function attach(httpServer) {
    io = new Server(httpServer, {
        cors: process.env.CORS_ORIGIN ? { origin: process.env.CORS_ORIGIN.split(",") } : undefined,
        maxHttpBufferSize: 1e6,       /* signaling messages are small */
        pingInterval: 10000,          /* notice a lost network within ~15 seconds */
        pingTimeout: 5000
    });

    io.use(authenticate);

    io.on("connection", (socket) => {
        if (socket.data.user.role === "admin") adminHandlers(socket);
        else candidateHandlers(socket);
    });

    const timer = setInterval(() => sweep().catch(err => console.error("Proctor sweep:", err.message)), 15000);
    timer.unref();

    return io;
}

module.exports = { attach, list, endByAttempt, iceServers };
