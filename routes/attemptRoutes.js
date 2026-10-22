const router = require("express").Router();

const Quiz = require("../models/Quiz");
const Attempt = require("../models/Attempt");
const User = require("../models/User");
const auth = require("../middleware/authMiddleware");
const { isId } = require("../utils/validate");
const engine = require("../utils/examEngine");
const proctor = require("../utils/proctor");

/*
 * NOTE: the original `POST /api/attempt` (score an answers array against
 * the first quiz in the database) has been replaced by the flow below.
 * It never worked (quizId was missing so saving always failed) and it let
 * the browser decide when time was up.
 *
 * New flow:
 *   POST /api/attempt/start/:quizId   start or resume (server sets deadline)
 *   PUT  /api/attempt/:id/answers     auto-save answers
 *   POST /api/attempt/:id/submit      final submit (manual or on timeout)
 *   GET  /api/attempt/:id             result + answer review
 */

function sessionPayload(attempt, quiz) {
    return {
        success: true,
        attemptId: attempt._id,
        status: attempt.status,
        quiz: {
            _id: quiz._id,
            title: quiz.title,
            category: quiz.category,
            duration: quiz.duration,
            totalMarks: quiz.totalMarks,
            negativeMarking: quiz.negativeMarking
        },
        questions: engine.candidateQuestions(quiz, attempt),
        answers: attempt.answers.map(a => ({
            questionId: a.questionId,
            selected: a.selected,
            marked: a.marked,
            visited: a.visited
        })),
        startedAt: attempt.startedAt,
        expiresAt: attempt.expiresAt,
        serverNow: new Date()
    };
}

async function ownAttempt(req, res) {
    if (!isId(req.params.id)) {
        res.status(404).json({ success: false, message: "Attempt not found" });
        return null;
    }
    const attempt = await Attempt.findById(req.params.id);
    if (!attempt || (String(attempt.userId) !== req.user.id && req.user.role !== "admin")) {
        res.status(404).json({ success: false, message: "Attempt not found" });
        return null;
    }
    return attempt;
}


/* ================= START / RESUME ================= */

router.post("/start/:quizId", auth, async (req, res) => {
    try {
        if (!isId(req.params.quizId)) {
            return res.status(404).json({ success: false, message: "Examination not found" });
        }

        const quiz = await Quiz.findById(req.params.quizId);
        if (!quiz) return res.status(404).json({ success: false, message: "Examination not found" });

        /* Resume an attempt that is still running (this is what defeats the refresh trick) */
        const running = await Attempt.findOne({
            userId: req.user.id, quizId: quiz._id, status: "in_progress"
        }).sort({ createdAt: -1 });

        if (running) {
            if (engine.isExpired(running)) {
                await engine.finalize(running, { auto: true, quiz });
                return res.status(409).json({
                    success: false,
                    code: "TIME_UP",
                    attemptId: running._id,
                    message: "Time is up for this attempt. It has been submitted automatically."
                });
            }
            return res.json({ ...sessionPayload(running, quiz), resumed: true });
        }

        const problem = engine.availabilityProblem(quiz);
        if (problem) return res.status(403).json({ success: false, message: problem });

        if (quiz.attemptLimit > 0) {
            const used = await Attempt.countDocuments({ userId: req.user.id, quizId: quiz._id, status: "submitted" });
            if (used >= quiz.attemptLimit) {
                return res.status(403).json({ success: false, message: "You have used all your attempts for this examination." });
            }
        }

        const attempt = await Attempt.create(engine.newAttemptDoc(quiz, req.user));
        res.status(201).json({ ...sessionPayload(attempt, quiz), resumed: false });

    } catch (error) {
        console.error("START ERROR:", error);
        res.status(500).json({ success: false, message: "Unable to start the examination. Please try again." });
    }
});


/* ================= AUTO-SAVE ================= */

router.put("/:id/answers", auth, async (req, res) => {
    try {
        const attempt = await ownAttempt(req, res);
        if (!attempt) return;

        if (String(attempt.userId) !== req.user.id) {
            return res.status(403).json({ success: false, message: "Not your attempt" });
        }

        if (attempt.status === "submitted") {
            return res.status(409).json({ success: false, code: "SUBMITTED", attemptId: attempt._id, message: "This attempt is already submitted." });
        }

        if (engine.isExpired(attempt)) {
            await engine.finalize(attempt, { auto: true });
            return res.status(409).json({ success: false, code: "TIME_UP", attemptId: attempt._id, message: "Time is up. Your answers were submitted automatically." });
        }

        const quiz = await Quiz.findById(attempt.quizId).lean();
        const applied = engine.applyUpdates(attempt, quiz, req.body.updates);
        if (applied) await attempt.save();

        res.json({ success: true, saved: applied, serverNow: new Date(), expiresAt: attempt.expiresAt });
    } catch (error) {
        console.error("SAVE ERROR:", error);
        res.status(500).json({ success: false, message: "Could not save your answer" });
    }
});


/* ================= SUBMIT ================= */

router.post("/:id/submit", auth, async (req, res) => {
    try {
        const attempt = await ownAttempt(req, res);
        if (!attempt) return;

        if (String(attempt.userId) !== req.user.id) {
            return res.status(403).json({ success: false, message: "Not your attempt" });
        }

        if (attempt.status === "submitted") {
            return res.json({ success: true, attemptId: attempt._id, alreadySubmitted: true });
        }

        const quiz = await Quiz.findById(attempt.quizId).lean();

        /* Last answers are accepted only while inside the deadline + grace window */
        if (!engine.isExpired(attempt)) {
            engine.applyUpdates(attempt, quiz, req.body.updates);
        }

        await engine.finalize(attempt, { auto: Boolean(req.body.auto), quiz });

        /* live monitoring: the candidate is no longer sitting this exam */
        proctor.endByAttempt(attempt._id, req.body.auto ? "time-up" : "submitted");

        res.json({ success: true, attemptId: attempt._id });
    } catch (error) {
        console.error("SUBMIT ERROR:", error);
        res.status(500).json({ success: false, message: "Could not submit. Please try again." });
    }
});


/* ================= MY HISTORY ================= */

router.get("/my", auth, async (req, res) => {
    try {
        const attempts = await Attempt.find({ userId: req.user.id, status: "submitted" })
            .select("-review -answers -questionOrder")
            .sort({ submittedAt: -1 })
            .lean();
        res.json({ success: true, attempts });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Unable to load your attempts" });
    }
});


/* ================= MY STATS ================= */

router.get("/my/stats", auth, async (req, res) => {
    try {
        const attempts = await Attempt.find({ userId: req.user.id, status: "submitted" })
            .select("quizId quizTitle quizCategory percentage score totalMarks correctAnswers incorrectAnswers unanswered timeTaken submittedAt passed")
            .sort({ submittedAt: 1 })
            .lean();

        const n = attempts.length;
        const answered = attempts.reduce((s, a) => s + a.correctAnswers + a.incorrectAnswers, 0);
        const correct = attempts.reduce((s, a) => s + a.correctAnswers, 0);

        const byCategory = {};
        attempts.forEach(a => {
            const key = a.quizCategory || "General";
            byCategory[key] = byCategory[key] || { category: key, attempts: 0, total: 0, best: 0 };
            byCategory[key].attempts++;
            byCategory[key].total += a.percentage;
            byCategory[key].best = Math.max(byCategory[key].best, a.percentage);
        });

        res.json({
            success: true,
            stats: {
                attempts: n,
                bestPercentage: n ? Math.max(...attempts.map(a => a.percentage)) : 0,
                averagePercentage: n ? Math.round(attempts.reduce((s, a) => s + a.percentage, 0) / n * 10) / 10 : 0,
                accuracy: answered ? Math.round(correct / answered * 1000) / 10 : 0,
                passed: attempts.filter(a => a.passed).length,
                totalTime: attempts.reduce((s, a) => s + a.timeTaken, 0),
                categories: Object.values(byCategory).map(c => ({
                    category: c.category,
                    attempts: c.attempts,
                    average: Math.round(c.total / c.attempts * 10) / 10,
                    best: c.best
                })),
                trend: attempts.slice(-12).map(a => ({ title: a.quizTitle, percentage: a.percentage, date: a.submittedAt }))
            }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Unable to load your statistics" });
    }
});


/* ================= LEADERBOARD ================= */
/*
 * ?quizId=<id>  best attempt per candidate for one quiz
 *               (higher score first, then faster time, then earlier submission)
 * no quizId     overall: average of each candidate's best % per quiz
 */
router.get("/leaderboard", auth, async (req, res) => {
    try {
        const quizId = req.query.quizId;
        const filter = { status: "submitted" };
        if (quizId) {
            if (!isId(quizId)) return res.status(400).json({ success: false, message: "Invalid quiz" });
            filter.quizId = quizId;
        }

        const attempts = await Attempt.find(filter)
            .select("userId userName quizId quizTitle score totalMarks percentage timeTaken correctAnswers incorrectAnswers unanswered submittedAt")
            .lean();

        /* current names (in case a user renamed themselves) and hide disabled accounts */
        const users = await User.find({ _id: { $in: [...new Set(attempts.map(a => String(a.userId)))] } })
            .select("name isActive avatar").lean();
        const userMap = new Map(users.map(u => [String(u._id), u]));

        const better = (a, b) =>
            b.percentage - a.percentage ||
            b.score - a.score ||
            a.timeTaken - b.timeTaken ||
            new Date(a.submittedAt) - new Date(b.submittedAt);

        let rows;

        if (quizId) {
            const best = new Map();
            attempts.forEach(a => {
                const key = String(a.userId);
                if (!best.has(key) || better(a, best.get(key)) < 0) best.set(key, a);
            });
            rows = [...best.values()].sort(better).map(a => ({
                userId: a.userId,
                name: (userMap.get(String(a.userId)) || {}).name || a.userName || "Candidate",
                avatar: (userMap.get(String(a.userId)) || {}).avatar || "",
                score: a.score,
                totalMarks: a.totalMarks,
                percentage: a.percentage,
                timeTaken: a.timeTaken,
                correct: a.correctAnswers,
                incorrect: a.incorrectAnswers,
                unanswered: a.unanswered,
                attemptId: a._id,
                submittedAt: a.submittedAt
            }));
        } else {
            const perUser = new Map();
            attempts.forEach(a => {
                const u = String(a.userId);
                if (!perUser.has(u)) perUser.set(u, new Map());
                const q = perUser.get(u);
                const k = String(a.quizId);
                if (!q.has(k) || better(a, q.get(k)) < 0) q.set(k, a);
            });
            rows = [...perUser.entries()].map(([u, quizzes]) => {
                const list = [...quizzes.values()];
                const sum = (f) => list.reduce((s, a) => s + (a[f] || 0), 0);
                return {
                    userId: u,
                    name: (userMap.get(u) || {}).name || list[0].userName || "Candidate",
                    avatar: (userMap.get(u) || {}).avatar || "",
                    score: Math.round(sum("score") * 100) / 100,
                    totalMarks: sum("totalMarks"),
                    percentage: Math.round(sum("percentage") / list.length * 10) / 10,
                    timeTaken: sum("timeTaken"),
                    correct: sum("correctAnswers"),
                    incorrect: sum("incorrectAnswers"),
                    unanswered: sum("unanswered"),
                    quizzes: list.length
                };
            }).sort((a, b) => b.percentage - a.percentage || b.score - a.score || a.timeTaken - b.timeTaken);
        }

        rows = rows.filter(r => (userMap.get(String(r.userId)) || {}).isActive !== false);
        rows.forEach((r, i) => { r.rank = i + 1; r.isMe = String(r.userId) === req.user.id; });

        const me = rows.find(r => r.isMe) || null;
        const limit = Math.min(Number(req.query.limit) || 100, 500);

        res.json({ success: true, total: rows.length, me, rows: rows.slice(0, limit) });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Unable to load the leaderboard" });
    }
});


/* ================= RESULT ================= */

router.get("/:id", auth, async (req, res) => {
    try {
        const attempt = await ownAttempt(req, res);
        if (!attempt) return;

        /* opening a result for an attempt whose time already ran out finalises it */
        if (attempt.status === "in_progress" && engine.isExpired(attempt)) {
            await engine.finalize(attempt, { auto: true });
        }

        if (attempt.status !== "submitted") {
            return res.status(409).json({ success: false, code: "IN_PROGRESS", quizId: attempt.quizId, message: "This attempt is still in progress." });
        }

        const quiz = await Quiz.findById(attempt.quizId).select("passingMarks negativeMarking").lean();

        /* rank among candidates for this quiz (best attempt each) */
        const all = await Attempt.find({ quizId: attempt.quizId, status: "submitted" })
            .select("userId percentage score timeTaken").lean();
        const best = new Map();
        all.forEach(a => {
            const k = String(a.userId);
            const cur = best.get(k);
            if (!cur || a.percentage > cur.percentage || (a.percentage === cur.percentage && a.timeTaken < cur.timeTaken)) best.set(k, a);
        });
        const ranked = [...best.values()].sort((a, b) => b.percentage - a.percentage || a.timeTaken - b.timeTaken);
        const myBest = best.get(String(attempt.userId));

        const out = attempt.toObject();
        delete out.answers;
        delete out.questionOrder;

        res.json({
            success: true,
            attempt: out,
            passingMarks: quiz ? quiz.passingMarks : null,
            negativeMarking: quiz ? quiz.negativeMarking : false,
            rank: myBest ? ranked.indexOf(myBest) + 1 : null,
            candidates: ranked.length
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Unable to load this result" });
    }
});

module.exports = router;
