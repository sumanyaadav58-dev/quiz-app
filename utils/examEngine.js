/*
 * EXAM ENGINE
 * The server is the single source of truth for time and scoring.
 *  - The deadline (expiresAt) is fixed when the attempt starts.
 *  - Refreshing the page resumes the same attempt with the same deadline.
 *  - Answers arriving after the deadline (plus a small network grace) are rejected.
 *  - Expired attempts are finalised automatically, even if the browser was closed.
 */

const Quiz = require("../models/Quiz");
const Attempt = require("../models/Attempt");

/* allowance for network latency when the last answer and auto-submit race the clock */
const GRACE_MS = 5000;

function shuffle(list) {
    const arr = list.slice();
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function round2(n) {
    return Math.round(n * 100) / 100;
}

/* Is the quiz open for a new attempt right now? Returns an error message or null. */
function availabilityProblem(quiz, now = new Date()) {
    if (!quiz || quiz.status !== "published") return "This examination is not available right now.";
    if (!quiz.questions || quiz.questions.length === 0) return "This examination has no questions yet.";
    if (quiz.startAt && now < quiz.startAt) return "This examination has not opened yet.";
    if (quiz.endAt && now > quiz.endAt) return "This examination window has closed.";
    return null;
}

function newAttemptDoc(quiz, user) {

    const ids = quiz.questions.map(q => q._id);
    const order = quiz.randomizeQuestions ? shuffle(ids) : ids;

    const byId = new Map(quiz.questions.map(q => [String(q._id), q]));

    const optionOrder = order.map(id => {
        const count = byId.get(String(id)).options.length;
        const base = Array.from({ length: count }, (_, i) => i);
        return quiz.randomizeOptions ? shuffle(base) : base;
    });

    const startedAt = new Date();

    return {
        userId: user.id,
        quizId: quiz._id,
        userName: user.name,
        quizTitle: quiz.title,
        quizCategory: quiz.category,
        duration: quiz.duration,
        totalMarks: quiz.totalMarks,
        startedAt,
        expiresAt: new Date(startedAt.getTime() + quiz.duration * 60 * 1000),
        questionOrder: order,
        answers: order.map((id, i) => ({ questionId: id, selected: null, marked: false, visited: false, optionOrder: optionOrder[i] })),
        status: "in_progress"
    };
}

/* Questions for the candidate: in attempt order, options shuffled, NO correct answers. */
function candidateQuestions(quiz, attempt) {

    const byId = new Map(quiz.questions.map(q => [String(q._id), q]));
    const answerById = new Map(attempt.answers.map(a => [String(a.questionId), a]));
    const out = [];

    attempt.questionOrder.forEach((id) => {
        const q = byId.get(String(id));
        if (!q) return; /* question removed by admin after the attempt started */
        const order = optionOrderFor(answerById.get(String(id)), q);
        out.push({
            _id: q._id,
            question: q.question,
            options: order.map(i => q.options[i]),
            marks: q.marks,
            negativeMarks: quiz.negativeMarking ? q.negativeMarks : 0,
            difficulty: q.difficulty
        });
    });

    return out;
}

function optionOrderFor(answer, q) {
    const order = answer && answer.optionOrder;
    if (Array.isArray(order) && order.length === q.options.length) return order;
    return q.options.map((_, i) => i);
}

function isExpired(attempt, now = Date.now()) {
    return now > new Date(attempt.expiresAt).getTime() + GRACE_MS;
}

/* Apply client answer updates to an in-progress attempt (validated). */
function applyUpdates(attempt, quiz, updates) {

    if (!Array.isArray(updates)) return 0;

    const byId = new Map(quiz ? quiz.questions.map(q => [String(q._id), q]) : []);
    const answerById = new Map(attempt.answers.map(a => [String(a.questionId), a]));
    let applied = 0;

    for (const u of updates.slice(0, 500)) {
        if (!u || !u.questionId) continue;
        const answer = answerById.get(String(u.questionId));
        const q = byId.get(String(u.questionId));
        if (!answer || !q) continue;

        if (u.selected === null || u.selected === "") {
            answer.selected = null;
        } else if (typeof u.selected === "string") {
            if (!q.options.includes(u.selected)) continue; /* ignore values that aren't real options */
            answer.selected = u.selected;
        }
        if (typeof u.marked === "boolean") answer.marked = u.marked;
        if (u.visited === true) answer.visited = true;
        applied++;
    }

    return applied;
}

/* Score and close an attempt. Safe to call more than once. */
async function finalize(attempt, { auto = false, quiz = null } = {}) {

    if (attempt.status === "submitted") return attempt;

    quiz = quiz || await Quiz.findById(attempt.quizId).lean();

    const now = new Date();
    const deadline = new Date(attempt.expiresAt);
    const endedAt = now > deadline ? deadline : now;
    const lateOrTimeout = now.getTime() > deadline.getTime();

    const answerById = new Map(attempt.answers.map(a => [String(a.questionId), a]));
    const byId = new Map(quiz ? quiz.questions.map(q => [String(q._id), q]) : []);
    const negative = quiz ? quiz.negativeMarking : false;

    let score = 0, correct = 0, incorrect = 0, unanswered = 0, maxMarks = 0;
    const review = [];

    attempt.questionOrder.forEach((id) => {
        const q = byId.get(String(id));
        if (!q) return;

        const a = answerById.get(String(id));
        const selected = a && a.selected ? a.selected : null;
        const marks = Number(q.marks) || 0;
        const neg = negative ? Number(q.negativeMarks) || 0 : 0;
        maxMarks += marks;

        let result, awarded;
        if (!selected) {
            result = "unanswered"; awarded = 0; unanswered++;
        } else if (selected === q.correct) {
            result = "correct"; awarded = marks; correct++;
        } else {
            result = "incorrect"; awarded = -neg; incorrect++;
        }
        score += awarded;

        const order = optionOrderFor(a, q);

        review.push({
            questionId: q._id,
            question: q.question,
            options: order.map(i => q.options[i]),
            correct: q.correct,
            selected,
            marks,
            negativeMarks: neg,
            awarded,
            difficulty: q.difficulty,
            topic: q.topic || "",
            explanation: q.explanation || "",
            result
        });
    });

    score = round2(score);

    attempt.score = score;
    attempt.totalMarks = maxMarks;
    attempt.correctAnswers = correct;
    attempt.incorrectAnswers = incorrect;
    attempt.unanswered = unanswered;
    attempt.percentage = maxMarks > 0 ? round2(Math.max(0, score) / maxMarks * 100) : 0;
    attempt.passed = score >= (quiz ? quiz.passingMarks : 0);
    attempt.timeTaken = Math.max(0, Math.round((endedAt - new Date(attempt.startedAt)) / 1000));
    attempt.submittedAutomatically = Boolean(auto || lateOrTimeout);
    attempt.submittedAt = endedAt;
    attempt.status = "submitted";
    attempt.review = review;

    await attempt.save();
    return attempt;
}

/* Background sweep: finalise attempts whose time ran out while the browser was closed. */
async function finalizeExpired() {
    const cutoff = new Date(Date.now() - GRACE_MS);
    const stale = await Attempt.find({ status: "in_progress", expiresAt: { $lt: cutoff } }).limit(200);
    for (const attempt of stale) {
        try {
            await finalize(attempt, { auto: true });
        } catch (error) {
            console.error("Auto-finalise failed for attempt", String(attempt._id), error.message);
        }
    }
    return stale.length;
}

function startSweeper(intervalMs = 30000) {
    const timer = setInterval(() => {
        finalizeExpired().catch(error => console.error("Sweeper error:", error.message));
    }, intervalMs);
    timer.unref();
    return timer;
}

module.exports = {
    GRACE_MS,
    availabilityProblem,
    newAttemptDoc,
    candidateQuestions,
    isExpired,
    applyUpdates,
    finalize,
    finalizeExpired,
    startSweeper
};
