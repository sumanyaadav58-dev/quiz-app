const mongoose = require("mongoose");

const DIFFICULTIES = ["Easy", "Medium", "Hard"];

const questionSchema = new mongoose.Schema(
    {
        question: {
            type: String,
            required: true,
            trim: true
        },

        options: {
            type: [String],
            required: true,
            validate: {
                validator: function (value) {
                    return value.length === 4;
                },
                message: "Exactly 4 options are required"
            }
        },

        /* Stores the option TEXT of the right answer (unchanged from original) */
        correct: {
            type: String,
            required: true,
            trim: true
        },

        marks: {
            type: Number,
            default: 1,
            min: 0
        },

        negativeMarks: {
            type: Number,
            default: 0,
            min: 0
        },

        difficulty: {
            type: String,
            enum: DIFFICULTIES,
            default: "Medium"
        },

        /* NEW: optional sub-topic for organising the question bank */
        topic: {
            type: String,
            default: "",
            trim: true
        },

        /* NEW: optional explanation shown in the answer review after submission */
        explanation: {
            type: String,
            default: "",
            trim: true
        }
    }
);

const quizSchema = new mongoose.Schema(
    {
        title: {
            type: String,
            required: true,
            trim: true
        },

        description: {
            type: String,
            default: ""
        },

        category: {
            type: String,
            default: "General",
            trim: true
        },

        difficulty: {
            type: String,
            enum: DIFFICULTIES,
            default: "Medium"
        },

        /* Exam duration in minutes. The server uses this to set the attempt deadline. */
        duration: {
            type: Number,
            required: true,
            default: 30,
            min: 1,
            max: 600
        },

        totalMarks: {
            type: Number,
            default: 0
        },

        passingMarks: {
            type: Number,
            default: 40,
            min: 0
        },

        negativeMarking: {
            type: Boolean,
            default: false
        },

        status: {
            type: String,
            enum: ["draft", "published", "closed"],
            default: "draft"
        },

        instructions: {
            type: [String],
            default: [
                "Read every question carefully.",
                "Select the most appropriate answer.",
                "You can navigate between questions.",
                "The examination will automatically submit when the time expires."
            ]
        },

        /* NEW exam settings */
        randomizeQuestions: {
            type: Boolean,
            default: false
        },

        randomizeOptions: {
            type: Boolean,
            default: false
        },

        /* 0 = unlimited attempts */
        attemptLimit: {
            type: Number,
            default: 0,
            min: 0
        },

        /* Optional availability window */
        startAt: {
            type: Date,
            default: null
        },

        endAt: {
            type: Date,
            default: null
        },

        questions: {
            type: [questionSchema],
            default: []
        }
    },
    {
        timestamps: true
    }
);

quizSchema.pre("save", function (next) {

    this.totalMarks = this.questions.reduce(
        (total, question) => total + (question.marks || 0),
        0
    );

    next();
});

quizSchema.statics.DIFFICULTIES = DIFFICULTIES;

module.exports = mongoose.model("Quiz", quizSchema);
