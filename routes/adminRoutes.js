const router = require("express").Router();

const Quiz = require("../models/Quiz");
const User = require("../models/User");
const Attempt = require("../models/Attempt");

const auth = require("../middleware/authMiddleware");
const admin = require("../middleware/adminMiddleware");
const { isId, str, escapeRegex } = require("../utils/validate");
const engine = require("../utils/examEngine");
const proctor = require("../utils/proctor");
const ProctorSession = require("../models/ProctorSession");

/* every route in this file requires a logged-in admin */
router.use(auth, admin);

const DIFFICULTIES = ["Easy", "Medium", "Hard"];

function fail(res, status, message, extra = {}) {
    return res.status(status).json({ success: false, message, ...extra });
}

function serverError(res, error, message) {
    console.error(message, error);
    return fail(res, 500, message);
}

function toBool(v) {
    return v === true || v === "true" || v === "on" || v === 1 || v === "1";
}

function toDate(v) {
    if (v === null || v === "" || v === undefined) return null;
    const d = new Date(v);
    return isNaN(d.getTime()) ? undefined : d;
}

/*
 * Reads quiz settings from a request body.
 * partial=true (edit) only touches fields that were sent.
 * Returns { data } or { error }.
 */
function readQuizFields(body, partial) {

    const data = {};
    const has = (k) => body[k] !== undefined;

    if (!partial || has("title")) {
        const title = str(body.title, 150);
        if (!title) return { error: "Quiz title is required" };
        data.title = title;
    }

    if (has("description")) data.description = str(body.description, 1000);
    if (has("category")) data.category = str(body.category, 60) || "General";

    if (has("difficulty")) {
        if (!DIFFICULTIES.includes(body.difficulty)) return { error: "Choose Easy, Medium or Hard" };
        data.difficulty = body.difficulty;
    }

    if (!partial || has("duration")) {
        const duration = Number(body.duration);
        if (!Number.isFinite(duration) || duration < 1) return { error: "Duration must be at least 1 minute" };
        if (duration > 600) return { error: "Duration can't be more than 600 minutes" };
        data.duration = Math.round(duration);
    }

    if (has("passingMarks")) {
        const p = Number(body.passingMarks);
        if (!Number.isFinite(p) || p < 0) return { error: "Passing marks must be 0 or more" };
        data.passingMarks = p;
    }

    if (has("negativeMarking")) data.negativeMarking = toBool(body.negativeMarking);
    if (has("randomizeQuestions")) data.randomizeQuestions = toBool(body.randomizeQuestions);
    if (has("randomizeOptions")) data.randomizeOptions = toBool(body.randomizeOptions);

    if (has("attemptLimit")) {
        const n = Number(body.attemptLimit);
        if (!Number.isFinite(n) || n < 0) return { error: "Attempt limit must be 0 (unlimited) or more" };
        data.attemptLimit = Math.round(n);
    }

    if (has("startAt")) {
        const d = toDate(body.startAt);
        if (d === undefined) return { error: "Start time is not a valid date" };
        data.startAt = d;
    }

    if (has("endAt")) {
        const d = toDate(body.endAt);
        if (d === undefined) return { error: "End time is not a valid date" };
        data.endAt = d;
    }

    if (data.startAt && data.endAt && data.endAt <= data.startAt) {
        return { error: "End time must be after start time" };
    }

    if (has("instructions")) {
        let list = body.instructions;
        if (typeof list === "string") list = list.split("\n");
        if (!Array.isArray(list)) return { error: "Instructions must be a list" };
        data.instructions = list.map(s => str(s, 500)).filter(Boolean).slice(0, 30);
    }

    return { data };
}

function readQuestion(body) {

    const question = str(body.question, 2000);
    if (!question) return { error: "Question text is required" };

    if (!Array.isArray(body.options) || body.options.length !== 4) {
        return { error: "Exactly 4 options are required" };
    }

    const options = body.options.map(o => str(o, 500));
    if (options.some(o => !o)) return { error: "All 4 options need text" };

    const unique = new Set(options.map(o => o.toLowerCase()));
    if (unique.size !== 4) return { error: "Options must all be different" };

    let correct;
    if (body.correctIndex !== undefined && body.correctIndex !== null && body.correctIndex !== "") {
        const i = Number(body.correctIndex);
        if (!Number.isInteger(i) || i < 0 || i > 3) return { error: "Pick the correct option" };
        correct = options[i];
    } else {
        correct = str(body.correct, 500);
        /* allow "A".."D" as in the old prompt-based admin */
        if (/^[A-Da-d]$/.test(correct) && !options.includes(correct)) correct = options["ABCD".indexOf(correct.toUpperCase())];
    }

    if (!correct) return { error: "Correct answer is required" };
    if (!options.includes(correct)) return { error: "The correct answer must match one of the options" };

    const marks = body.marks === undefined || body.marks === "" ? 1 : Number(body.marks);
    if (!Number.isFinite(marks) || marks < 0) return { error: "Marks must be 0 or more" };

    const negativeMarks = body.negativeMarks === undefined || body.negativeMarks === "" ? 0 : Number(body.negativeMarks);
    if (!Number.isFinite(negativeMarks) || negativeMarks < 0) return { error: "Negative marks must be 0 or more" };

    const difficulty = DIFFICULTIES.includes(body.difficulty) ? body.difficulty : "Medium";

    return {
        data: {
            question,
            options,
            correct,
            marks,
            negativeMarks,
            difficulty,
            topic: str(body.topic, 80),
            explanation: str(body.explanation, 2000)
        }
    };
}

async function loadQuiz(res, id) {
    if (!isId(id)) { fail(res, 404, "Quiz not found"); return null; }
    const quiz = await Quiz.findById(id);
    if (!quiz) { fail(res, 404, "Quiz not found"); return null; }
    return quiz;
}


/* =====================================================
   ADMIN DASHBOARD STATISTICS  (original endpoint, extended)
===================================================== */

router.get("/stats", async (req, res) => {
    try {
        const [totalQuizzes, totalUsers, activeUsers, totalAttempts, inProgress, publishedQuizzes, draftQuizzes, closedQuizzes, quizzes, submitted] =
            await Promise.all([
                Quiz.countDocuments(),
                User.countDocuments({ role: "user" }),
                User.countDocuments({ role: "user", isActive: { $ne: false } }),
                Attempt.countDocuments({ status: { $ne: "in_progress" } }),
                Attempt.countDocuments({ status: "in_progress", expiresAt: { $gt: new Date() } }),
                Quiz.countDocuments({ status: "published" }),
                Quiz.countDocuments({ status: "draft" }),
                Quiz.countDocuments({ status: "closed" }),
                Quiz.find().select("questions._id").lean(),
                Attempt.find({ status: { $ne: "in_progress" } }).select("percentage passed").lean()
            ]);

        const totalQuestions = quizzes.reduce((s, q) => s + (q.questions || []).length, 0);
        const averagePercentage = submitted.length
            ? Math.round(submitted.reduce((s, a) => s + (a.percentage || 0), 0) / submitted.length * 10) / 10
            : 0;
        const passRate = submitted.length
            ? Math.round(submitted.filter(a => a.passed).length / submitted.length * 1000) / 10
            : 0;

        res.json({
            success: true,
            stats: {
                totalQuizzes, totalUsers, activeUsers, totalAttempts, inProgress,
                publishedQuizzes, draftQuizzes, closedQuizzes,
                totalQuestions, averagePercentage, passRate
            }
        });
    } catch (error) {
        serverError(res, error, "Unable to load dashboard statistics");
    }
});


/* =====================================================
   ANALYTICS
===================================================== */

router.get("/analytics", async (req, res) => {
    try {
        const days = 14;
        const since = new Date();
        since.setHours(0, 0, 0, 0);
        since.setDate(since.getDate() - (days - 1));

        const [attempts, quizzes] = await Promise.all([
            Attempt.find({ status: "submitted" })
                .select("quizId quizTitle userName userId percentage passed timeTaken submittedAt score totalMarks submittedAutomatically")
                .sort({ submittedAt: -1 })
                .lean(),
            Quiz.find().select("title category status duration questions._id").lean()
        ]);

        /* attempts per day (local server date) */
        const byDay = [];
        for (let i = 0; i < days; i++) {
            const d = new Date(since);
            d.setDate(since.getDate() + i);
            byDay.push({ date: d.toISOString().slice(0, 10), count: 0 });
        }
        const dayIndex = new Map(byDay.map((d, i) => [d.date, i]));
        attempts.forEach(a => {
            if (!a.submittedAt || new Date(a.submittedAt) < since) return;
            const key = new Date(a.submittedAt).toISOString().slice(0, 10);
            if (dayIndex.has(key)) byDay[dayIndex.get(key)].count++;
        });

        /* score distribution in 5 buckets */
        const buckets = [
            { label: "0 to 20%", count: 0 }, { label: "20 to 40%", count: 0 },
            { label: "40 to 60%", count: 0 }, { label: "60 to 80%", count: 0 },
            { label: "80 to 100%", count: 0 }
        ];
        attempts.forEach(a => {
            const i = Math.min(4, Math.floor((a.percentage || 0) / 20));
            buckets[i].count++;
        });

        /* per-quiz performance */
        const perQuiz = new Map();
        attempts.forEach(a => {
            const k = String(a.quizId);
            if (!perQuiz.has(k)) perQuiz.set(k, { attempts: 0, pct: 0, passed: 0, time: 0, candidates: new Set() });
            const p = perQuiz.get(k);
            p.attempts++; p.pct += a.percentage || 0; p.time += a.timeTaken || 0;
            if (a.passed) p.passed++;
            p.candidates.add(String(a.userId));
        });

        const quizPerformance = quizzes.map(q => {
            const p = perQuiz.get(String(q._id));
            return {
                quizId: q._id,
                title: q.title,
                category: q.category,
                status: q.status,
                questions: (q.questions || []).length,
                attempts: p ? p.attempts : 0,
                candidates: p ? p.candidates.size : 0,
                averagePercentage: p ? Math.round(p.pct / p.attempts * 10) / 10 : 0,
                passRate: p ? Math.round(p.passed / p.attempts * 1000) / 10 : 0,
                averageTime: p ? Math.round(p.time / p.attempts) : 0
            };
        }).sort((a, b) => b.attempts - a.attempts);

        res.json({
            success: true,
            attemptsByDay: byDay,
            scoreDistribution: buckets,
            quizPerformance,
            recentAttempts: attempts.slice(0, 8)
        });
    } catch (error) {
        serverError(res, error, "Unable to load analytics");
    }
});

/* per-question analytics for one quiz */
router.get("/analytics/quiz/:id", async (req, res) => {
    try {
        const quiz = await loadQuiz(res, req.params.id);
        if (!quiz) return;

        const attempts = await Attempt.find({ quizId: quiz._id, status: "submitted" }).select("review").lean();

        const stats = new Map(quiz.questions.map(q => [String(q._id), { correct: 0, incorrect: 0, unanswered: 0 }]));
        attempts.forEach(a => (a.review || []).forEach(r => {
            const s = stats.get(String(r.questionId));
            if (s && s[r.result] !== undefined) s[r.result]++;
        }));

        const questions = quiz.questions.map((q, i) => {
            const s = stats.get(String(q._id));
            const seen = s.correct + s.incorrect + s.unanswered;
            return {
                number: i + 1,
                questionId: q._id,
                question: q.question,
                difficulty: q.difficulty,
                ...s,
                seen,
                accuracy: seen ? Math.round(s.correct / seen * 1000) / 10 : null
            };
        });

        res.json({ success: true, quiz: { _id: quiz._id, title: quiz.title }, attempts: attempts.length, questions });
    } catch (error) {
        serverError(res, error, "Unable to load question analytics");
    }
});


/* =====================================================
   QUIZZES
===================================================== */

router.post("/create-quiz", async (req, res) => {
    try {
        const { data, error } = readQuizFields(req.body, false);
        if (error) return fail(res, 400, error);

        const quiz = await Quiz.create({ ...data, status: "draft", questions: [] });

        res.status(201).json({ success: true, message: "Quiz created", quiz });
    } catch (error) {
        serverError(res, error, "Unable to create quiz");
    }
});

router.get("/quizzes", async (req, res) => {
    try {
        const quizzes = await Quiz.find().sort({ createdAt: -1 }).lean();
        const counts = await Attempt.find({ status: "submitted" }).select("quizId").lean();
        const map = new Map();
        counts.forEach(c => map.set(String(c.quizId), (map.get(String(c.quizId)) || 0) + 1));
        quizzes.forEach(q => { q.attemptCount = map.get(String(q._id)) || 0; q.questionCount = q.questions.length; });
        res.json({ success: true, quizzes });
    } catch (error) {
        serverError(res, error, "Unable to load quizzes");
    }
});

router.get("/quiz/:id", async (req, res) => {
    try {
        const quiz = await loadQuiz(res, req.params.id);
        if (!quiz) return;
        res.json({ success: true, quiz });
    } catch (error) {
        serverError(res, error, "Unable to load quiz");
    }
});

router.put("/quiz/:id", async (req, res) => {
    try {
        const quiz = await loadQuiz(res, req.params.id);
        if (!quiz) return;

        const { data, error } = readQuizFields(req.body, true);
        if (error) return fail(res, 400, error);

        const start = data.startAt !== undefined ? data.startAt : quiz.startAt;
        const end = data.endAt !== undefined ? data.endAt : quiz.endAt;
        if (start && end && end <= start) return fail(res, 400, "End time must be after start time");

        Object.assign(quiz, data);
        await quiz.save();

        res.json({ success: true, message: "Quiz updated", quiz });
    } catch (error) {
        serverError(res, error, "Unable to update quiz");
    }
});

router.delete("/quiz/:id", async (req, res) => {
    try {
        const quiz = await loadQuiz(res, req.params.id);
        if (!quiz) return;

        const removed = await Attempt.deleteMany({ quizId: quiz._id });
        await Quiz.findByIdAndDelete(quiz._id);

        res.json({ success: true, message: "Quiz deleted", attemptsRemoved: removed.deletedCount || 0 });
    } catch (error) {
        serverError(res, error, "Unable to delete quiz");
    }
});

router.post("/quiz/:id/duplicate", async (req, res) => {
    try {
        const quiz = await loadQuiz(res, req.params.id);
        if (!quiz) return;

        const copy = quiz.toObject();
        delete copy._id; delete copy.createdAt; delete copy.updatedAt; delete copy.__v;
        copy.title = (copy.title + " (copy)").slice(0, 150);
        copy.status = "draft";
        copy.questions = copy.questions.map(q => { const c = { ...q }; delete c._id; return c; });

        const created = await Quiz.create(copy);
        res.status(201).json({ success: true, message: "Quiz duplicated as a draft", quiz: created });
    } catch (error) {
        serverError(res, error, "Unable to duplicate quiz");
    }
});

router.patch("/quiz/:id/status", async (req, res) => {
    try {
        const { status } = req.body;
        if (!["draft", "published", "closed"].includes(status)) return fail(res, 400, "Invalid quiz status");

        const quiz = await loadQuiz(res, req.params.id);
        if (!quiz) return;

        if (status === "published" && quiz.questions.length === 0) {
            return fail(res, 400, "Add at least one question before publishing");
        }

        quiz.status = status;
        await quiz.save();

        const label = { draft: "moved to draft", published: "published", closed: "closed" }[status];
        res.json({ success: true, message: `Quiz ${label}`, quiz });
    } catch (error) {
        serverError(res, error, "Unable to change quiz status");
    }
});


/* =====================================================
   QUESTIONS
===================================================== */

router.post("/add-question/:id", async (req, res) => {
    try {
        const { data, error } = readQuestion(req.body);
        if (error) return fail(res, 400, error);

        const quiz = await loadQuiz(res, req.params.id);
        if (!quiz) return;

        quiz.questions.push(data);
        await quiz.save();

        res.status(201).json({ success: true, message: "Question added", quiz });
    } catch (error) {
        serverError(res, error, "Unable to add question");
    }
});

router.put("/quiz/:quizId/question/:questionId", async (req, res) => {
    try {
        const { data, error } = readQuestion(req.body);
        if (error) return fail(res, 400, error);

        const quiz = await loadQuiz(res, req.params.quizId);
        if (!quiz) return;

        const question = isId(req.params.questionId) && quiz.questions.id(req.params.questionId);
        if (!question) return fail(res, 404, "Question not found");

        question.set(data);
        await quiz.save();

        res.json({ success: true, message: "Question updated", quiz });
    } catch (error) {
        serverError(res, error, "Unable to update question");
    }
});

router.delete("/quiz/:quizId/question/:questionId", async (req, res) => {
    try {
        const quiz = await loadQuiz(res, req.params.quizId);
        if (!quiz) return;

        const question = isId(req.params.questionId) && quiz.questions.id(req.params.questionId);
        if (!question) return fail(res, 404, "Question not found");

        /* rewrite the array (a plain $set) rather than $pull: works on every MongoDB-compatible server */
        quiz.questions = quiz.questions.filter(q => String(q._id) !== String(req.params.questionId));

        if (quiz.questions.length === 0 && quiz.status === "published") quiz.status = "draft";

        await quiz.save();

        res.json({ success: true, message: "Question deleted", quiz });
    } catch (error) {
        serverError(res, error, "Unable to delete question");
    }
});

/* Question bank: every question across every quiz, searchable */
router.get("/questions", async (req, res) => {
    try {
        const search = str(req.query.search, 100).toLowerCase();
        const { difficulty, category, quizId } = req.query;

        const filter = {};
        if (category) filter.category = category;
        if (quizId && isId(quizId)) filter._id = quizId;

        const quizzes = await Quiz.find(filter).select("title category status questions").lean();

        let rows = [];
        quizzes.forEach(q => q.questions.forEach(item => rows.push({
            ...item,
            quizId: q._id,
            quizTitle: q.title,
            category: q.category,
            quizStatus: q.status
        })));

        if (difficulty) rows = rows.filter(r => r.difficulty === difficulty);
        if (search) {
            rows = rows.filter(r =>
                r.question.toLowerCase().includes(search) ||
                (r.topic || "").toLowerCase().includes(search) ||
                r.options.some(o => o.toLowerCase().includes(search))
            );
        }

        const categories = await Quiz.distinct("category");

        res.json({ success: true, total: rows.length, categories, questions: rows.slice(0, 500) });
    } catch (error) {
        serverError(res, error, "Unable to load the question bank");
    }
});


/* =====================================================
   USERS
===================================================== */

router.get("/users", async (req, res) => {
    try {
        const search = str(req.query.search, 100);
        const filter = {};
        if (search) {
            const re = new RegExp(escapeRegex(search), "i");
            filter.$or = [{ name: re }, { email: re }];
        }
        if (req.query.role && ["user", "admin"].includes(req.query.role)) filter.role = req.query.role;

        const users = await User.find(filter).select("-password -emailCode").sort({ createdAt: -1 }).lean();
        const attempts = await Attempt.find({ status: "submitted" }).select("userId percentage").lean();

        const map = new Map();
        attempts.forEach(a => {
            const k = String(a.userId);
            const m = map.get(k) || { n: 0, sum: 0, best: 0 };
            m.n++; m.sum += a.percentage || 0; m.best = Math.max(m.best, a.percentage || 0);
            map.set(k, m);
        });

        res.json({
            success: true,
            users: users.map(u => {
                const m = map.get(String(u._id));
                return {
                    ...u,
                    isActive: u.isActive !== false,
                    attempts: m ? m.n : 0,
                    averagePercentage: m ? Math.round(m.sum / m.n * 10) / 10 : 0,
                    bestPercentage: m ? m.best : 0
                };
            })
        });
    } catch (error) {
        serverError(res, error, "Unable to load users");
    }
});

router.get("/users/:id", async (req, res) => {
    try {
        if (!isId(req.params.id)) return fail(res, 404, "User not found");
        const user = await User.findById(req.params.id).select("-password -emailCode").lean();
        if (!user) return fail(res, 404, "User not found");

        const attempts = await Attempt.find({ userId: user._id })
            .select("-review -answers -questionOrder")
            .sort({ createdAt: -1 })
            .lean();

        res.json({ success: true, user: { ...user, isActive: user.isActive !== false }, attempts });
    } catch (error) {
        serverError(res, error, "Unable to load user");
    }
});

router.patch("/users/:id/status", async (req, res) => {
    try {
        if (!isId(req.params.id)) return fail(res, 404, "User not found");
        if (req.params.id === req.user.id) return fail(res, 400, "You can't disable your own account");

        const user = await User.findById(req.params.id);
        if (!user) return fail(res, 404, "User not found");

        user.isActive = toBool(req.body.isActive);
        await user.save();

        res.json({ success: true, message: user.isActive ? "Account enabled" : "Account disabled" });
    } catch (error) {
        serverError(res, error, "Unable to update user");
    }
});


/* =====================================================
   RESULTS
===================================================== */

async function findResults(query) {
    const filter = { status: "submitted" };
    if (query.quizId && isId(query.quizId)) filter.quizId = query.quizId;
    if (query.userId && isId(query.userId)) filter.userId = query.userId;
    if (query.result === "passed") filter.passed = true;
    if (query.result === "failed") filter.passed = false;

    let rows = await Attempt.find(filter)
        .select("-review -answers -questionOrder")
        .sort({ submittedAt: -1 })
        .limit(2000)
        .lean();

    const users = await User.find({ _id: { $in: [...new Set(rows.map(r => String(r.userId)))] } })
        .select("name email").lean();
    const map = new Map(users.map(u => [String(u._id), u]));
    rows.forEach(r => {
        const u = map.get(String(r.userId));
        r.userName = u ? u.name : (r.userName || "Deleted user");
        r.userEmail = u ? u.email : "";
    });

    const search = str(query.search, 100).toLowerCase();
    if (search) {
        rows = rows.filter(r =>
            r.userName.toLowerCase().includes(search) ||
            r.userEmail.toLowerCase().includes(search) ||
            (r.quizTitle || "").toLowerCase().includes(search));
    }
    return rows;
}

router.get("/results", async (req, res) => {
    try {
        await engine.finalizeExpired();
        const rows = await findResults(req.query);
        res.json({ success: true, total: rows.length, results: rows });
    } catch (error) {
        serverError(res, error, "Unable to load results");
    }
});

router.get("/results/export", async (req, res) => {
    try {
        const rows = await findResults(req.query);
        const cell = (v) => {
            let s = v === null || v === undefined ? "" : String(v);
            if (/^[=+\-@]/.test(s)) s = "'" + s; /* stop spreadsheet formula injection */
            return '"' + s.replace(/"/g, '""') + '"';
        };
        const header = ["Candidate", "Email", "Quiz", "Score", "Max marks", "Percentage", "Correct", "Incorrect", "Unanswered", "Time taken (s)", "Passed", "Auto submitted", "Submitted at"];
        const lines = [header.map(cell).join(",")].concat(rows.map(r => [
            r.userName, r.userEmail, r.quizTitle, r.score, r.totalMarks, r.percentage,
            r.correctAnswers, r.incorrectAnswers, r.unanswered, r.timeTaken,
            r.passed ? "Yes" : "No", r.submittedAutomatically ? "Yes" : "No",
            r.submittedAt ? new Date(r.submittedAt).toISOString() : ""
        ].map(cell).join(",")));

        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="quiz-results-${new Date().toISOString().slice(0, 10)}.csv"`);
        res.send("\uFEFF" + lines.join("\r\n"));
    } catch (error) {
        serverError(res, error, "Unable to export results");
    }
});

router.delete("/results/:id", async (req, res) => {
    try {
        if (!isId(req.params.id)) return fail(res, 404, "Result not found");
        const removed = await Attempt.findByIdAndDelete(req.params.id);
        if (!removed) return fail(res, 404, "Result not found");
        res.json({ success: true, message: "Result deleted" });
    } catch (error) {
        serverError(res, error, "Unable to delete result");
    }
});


/* =====================================================
   LIVE EXAM MONITORING
   The live list and real-time updates come over Socket.IO.
   This endpoint is a fallback snapshot plus recent history.
===================================================== */

router.get("/proctor/sessions", async (req, res) => {
    try {
        const recent = await ProctorSession.find({ endedAt: { $ne: null } })
            .select("-events")
            .sort({ endedAt: -1 })
            .limit(Math.min(Number(req.query.limit) || 20, 100))
            .lean();
        res.json({ success: true, live: proctor.list(), recent });
    } catch (error) {
        serverError(res, error, "Unable to load monitoring sessions");
    }
});

router.get("/proctor/sessions/:attemptId", async (req, res) => {
    try {
        if (!isId(req.params.attemptId)) return fail(res, 404, "Session not found");
        const session = await ProctorSession.findOne({ attemptId: req.params.attemptId }).lean();
        if (!session) return fail(res, 404, "Session not found");
        res.json({ success: true, session });
    } catch (error) {
        serverError(res, error, "Unable to load this session");
    }
});

module.exports = router;
