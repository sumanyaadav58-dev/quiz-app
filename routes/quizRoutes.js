const router = require("express").Router();

const Quiz = require("../models/Quiz");
const Attempt = require("../models/Attempt");
const auth = require("../middleware/authMiddleware");
const { isId } = require("../utils/validate");
const { availabilityProblem } = require("../utils/examEngine");

/* Public, safe view of a quiz. Never includes questions or answers. */
function summary(quiz) {
    return {
        _id: quiz._id,
        title: quiz.title,
        description: quiz.description,
        category: quiz.category,
        difficulty: quiz.difficulty,
        duration: quiz.duration,
        totalMarks: quiz.totalMarks,
        passingMarks: quiz.passingMarks,
        negativeMarking: quiz.negativeMarking,
        attemptLimit: quiz.attemptLimit,
        startAt: quiz.startAt,
        endAt: quiz.endAt,
        questionCount: (quiz.questions || []).length,
        status: quiz.status
    };
}


/*
 * GET /api/quiz
 * Kept for backward compatibility: still returns an array,
 * but now only published quizzes and WITHOUT questions/answers
 * (the old version leaked every correct answer to the browser).
 */
router.get("/", async (req, res) => {
    try {
        const quizzes = await Quiz.find({ status: "published" }).sort({ createdAt: -1 }).lean();
        res.json(quizzes.map(summary));
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Unable to load quizzes" });
    }
});


/* GET /api/quiz/available : published quizzes + this user's attempt info */
router.get("/available", auth, async (req, res) => {
    try {
        const quizzes = await Quiz.find({ status: "published" }).sort({ createdAt: -1 }).lean();
        const attempts = await Attempt.find({ userId: req.user.id })
            .select("quizId status percentage score expiresAt")
            .lean();

        const now = new Date();

        const list = quizzes.map(quiz => {
            const mine = attempts.filter(a => String(a.quizId) === String(quiz._id));
            const done = mine.filter(a => a.status === "submitted");
            const running = mine.find(a => a.status === "in_progress" && new Date(a.expiresAt) > now);
            const limitReached = quiz.attemptLimit > 0 && done.length >= quiz.attemptLimit;

            return {
                ...summary(quiz),
                attemptsUsed: done.length,
                bestPercentage: done.length ? Math.max(...done.map(a => a.percentage || 0)) : null,
                inProgress: Boolean(running),
                limitReached,
                unavailableReason: running ? null : (limitReached ? "Attempt limit reached" : availabilityProblem(quiz, now))
            };
        });

        res.json({ success: true, quizzes: list });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Unable to load quizzes" });
    }
});


/* GET /api/quiz/:id : details + instructions for the instructions screen */
router.get("/:id", auth, async (req, res) => {
    try {
        if (!isId(req.params.id)) {
            return res.status(404).json({ success: false, message: "Examination not found" });
        }

        const quiz = await Quiz.findById(req.params.id).lean();

        if (!quiz || (quiz.status !== "published" && req.user.role !== "admin")) {
            return res.status(404).json({ success: false, message: "Examination not found" });
        }

        const done = await Attempt.countDocuments({ userId: req.user.id, quizId: quiz._id, status: "submitted" });
        const running = await Attempt.findOne({
            userId: req.user.id, quizId: quiz._id, status: "in_progress", expiresAt: { $gt: new Date() }
        }).select("_id expiresAt").lean();

        const limitReached = quiz.attemptLimit > 0 && done >= quiz.attemptLimit;

        res.json({
            success: true,
            quiz: {
                ...summary(quiz),
                instructions: quiz.instructions || [],
                randomizeQuestions: quiz.randomizeQuestions,
                randomizeOptions: quiz.randomizeOptions
            },
            attemptsUsed: done,
            inProgress: Boolean(running),
            canStart: Boolean(running) || (!limitReached && !availabilityProblem(quiz)),
            reason: running ? null : (limitReached ? "You have used all your attempts for this examination." : availabilityProblem(quiz))
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Unable to load examination" });
    }
});

module.exports = router;
