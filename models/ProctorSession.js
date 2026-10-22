const mongoose = require("mongoose");

/*
 * Live exam monitoring metadata. One document per proctored attempt.
 * No video or audio is ever stored here: the live stream goes browser to
 * browser over WebRTC. This only records who sat the exam, when, and what
 * happened to their camera, microphone and connection.
 */

const eventSchema = new mongoose.Schema(
    {
        type: { type: String },       /* e.g. camera-off, mic-on, disconnected, reconnected */
        at: { type: Date, default: Date.now }
    },
    { _id: false }
);

const proctorSessionSchema = new mongoose.Schema(
    {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
        attemptId: { type: mongoose.Schema.Types.ObjectId, ref: "Attempt", required: true, unique: true },
        quizId: { type: mongoose.Schema.Types.ObjectId, ref: "Quiz", required: true, index: true },

        userName: { type: String, default: "" },
        quizTitle: { type: String, default: "" },

        startedAt: { type: Date, default: Date.now },
        endedAt: { type: Date, default: null },
        endReason: { type: String, default: "" },   /* submitted, time-up, left */

        cameraPermission: { type: String, enum: ["granted", "denied", "unknown"], default: "unknown" },
        micPermission: { type: String, enum: ["granted", "denied", "unknown"], default: "unknown" },

        cameraStatus: { type: String, enum: ["active", "off"], default: "off" },
        micStatus: { type: String, enum: ["active", "off"], default: "off" },
        connectionStatus: { type: String, enum: ["connected", "disconnected", "ended"], default: "connected" },

        lastSeenAt: { type: Date, default: Date.now },

        /* capped at the last 100 events */
        events: { type: [eventSchema], default: [] }
    },
    { timestamps: true }
);

module.exports = mongoose.model("ProctorSession", proctorSessionSchema);
