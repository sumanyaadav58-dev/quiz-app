const mongoose = require("mongoose");

/*
 * One document per exam attempt.
 * The original fields (score, totalMarks, correctAnswers, incorrectAnswers,
 * unanswered, timeTaken, submittedAutomatically) are kept as they were.
 * New fields support the server-side timer, auto-save and answer review.
 */

const answerSchema = new mongoose.Schema(
    {
        questionId: { type: mongoose.Schema.Types.ObjectId, required: true },
        selected: { type: String, default: null },
        marked: { type: Boolean, default: false },
        visited: { type: Boolean, default: false },
        /* shuffled option indexes for this question (randomised quizzes) */
        optionOrder: { type: [Number], default: [] }
    },
    { _id: false }
);

/* Snapshot written at submission, so later edits to a quiz never change old results */
const reviewSchema = new mongoose.Schema(
    {
        questionId: mongoose.Schema.Types.ObjectId,
        question: String,
        options: [String],
        correct: String,
        selected: { type: String, default: null },
        marks: Number,
        negativeMarks: Number,
        awarded: Number,
        difficulty: String,
        topic: String,
        explanation: String,
        result: {
            type: String,
            enum: ["correct", "incorrect", "unanswered"]
        }
    },
    { _id: false }
);

const attemptSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true
        },

        quizId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Quiz",
            required: true,
            index: true
        },

        score: {
            type: Number,
            default: 0
        },

        totalMarks: {
            type: Number,
            default: 0
        },

        correctAnswers: {
            type: Number,
            default: 0
        },

        incorrectAnswers: {
            type: Number,
            default: 0
        },

        unanswered: {
            type: Number,
            default: 0
        },

        /* seconds */
        timeTaken: {
            type: Number,
            default: 0
        },

        submittedAutomatically: {
            type: Boolean,
            default: false
        },

        /* ===== NEW ===== */

        status: {
            type: String,
            enum: ["in_progress", "submitted"],
            default: "in_progress",
            index: true
        },

        startedAt: {
            type: Date,
            default: Date.now
        },

        /* Server-side deadline. The client timer is only a display of this. */
        expiresAt: {
            type: Date,
            required: true
        },

        submittedAt: {
            type: Date,
            default: null
        },

        /* minutes, copied from the quiz at start */
        duration: {
            type: Number,
            default: 0
        },

        percentage: {
            type: Number,
            default: 0
        },

        passed: {
            type: Boolean,
            default: false
        },

        /* Snapshots so results stay readable if the quiz is renamed or deleted */
        quizTitle: { type: String, default: "" },
        quizCategory: { type: String, default: "" },
        userName: { type: String, default: "" },

        /* Per-attempt ordering (for randomised quizzes) */
        questionOrder: {
            type: [mongoose.Schema.Types.ObjectId],
            default: []
        },

        answers: {
            type: [answerSchema],
            default: []
        },

        review: {
            type: [reviewSchema],
            default: []
        }
    },
    {
        timestamps: true
    }
);

module.exports = mongoose.model("Attempt", attemptSchema);
