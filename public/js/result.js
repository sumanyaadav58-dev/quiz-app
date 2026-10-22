/* =========================================================
   RESULT   result.html?attempt=<attemptId>
   All numbers come from the saved attempt on the server.
========================================================= */

const user = App.guard();
App.nav(user.role === "admin" ? "admin" : "profile");
App.scene();

const esc = App.esc;
const attemptId = App.qs("attempt");
const root = document.getElementById("resultPage");
let review = [];
let filter = "all";

/* the old result page read a score from localStorage; send those visits somewhere useful */
if (!attemptId) location.replace(user.role === "admin" ? "admin.html" : "profile.html");

async function load() {
    try {
        const data = await App.api("/api/attempt/" + encodeURIComponent(attemptId));
        render(data);
    } catch (error) {
        if (error.data && error.data.code === "IN_PROGRESS") {
            root.innerHTML = empty("bi-hourglass-split", "This examination is still in progress", "Go back and finish it. The timer is still running.",
                `<a class="btn btn--amber" href="quiz.html?id=${esc(error.data.quizId)}">Resume examination</a>`);
            return;
        }
        root.innerHTML = empty("bi-exclamation-circle", "Couldn't open this result", error.message, `<a class="btn" href="home.html">Back to dashboard</a>`);
    }
}

function empty(icon, title, text, action) {
    return `<div class="panel empty"><i class="bi ${icon}"></i><strong>${esc(title)}</strong>${esc(text)}<br>${action}</div>`;
}

function summary(a, negativeMarking) {
    const answered = a.correctAnswers + a.incorrectAnswers;
    const total = answered + a.unanswered;
    const parts = [`You answered ${answered} of ${total} question${total === 1 ? "" : "s"} and got ${a.correctAnswers} right.`];
    const lost = review.reduce((s, r) => s + (r.awarded < 0 ? -r.awarded : 0), 0);
    if (negativeMarking && lost > 0) parts.push(`Negative marking cost you ${App.marks(lost)} mark${lost === 1 ? "" : "s"}.`);
    if (a.unanswered > 0) parts.push(`${a.unanswered} left blank.`);
    if (a.submittedAutomatically) parts.push("Time ran out, so the paper was submitted automatically.");
    return parts.join(" ");
}

function render(data) {
    const a = data.attempt;
    review = a.review || [];
    document.title = `${a.quizTitle} result | Quiz App`;

    const answered = a.correctAnswers + a.incorrectAnswers;
    const accuracy = answered ? Math.round(a.correctAnswers / answered * 1000) / 10 : 0;
    const allowed = (a.duration || 0) * 60;
    const gained = review.reduce((s, r) => s + (r.awarded > 0 ? r.awarded : 0), 0);
    const lost = review.reduce((s, r) => s + (r.awarded < 0 ? -r.awarded : 0), 0);
    const R = 80, C = 2 * Math.PI * R;
    const isOwner = user.role !== "admin";

    root.innerHTML = `
        ${App.qs("fresh") ? `<div class="alert alert--success no-print"><i class="bi bi-check-circle"></i><div>${a.submittedAutomatically ? "Time's up. Your answers were submitted automatically and scored." : "Submitted. Here's how you did."}</div></div>` : ""}

        <section class="panel result-hero">
            <div class="ring ${a.passed ? "is-pass" : "is-fail"}" role="img" aria-label="Score ${App.pct(a.percentage)}">
                <svg viewBox="0 0 190 190"><circle class="ring__track" cx="95" cy="95" r="${R}"/><circle class="ring__bar" id="ringBar" cx="95" cy="95" r="${R}" stroke-dasharray="${C}" stroke-dashoffset="${C}"/></svg>
                <div class="ring__center"><div><strong class="num">${App.pct(a.percentage)}</strong><span>Score</span></div></div>
            </div>
            <div>
                <span class="verdict ${a.passed ? "verdict--pass" : "verdict--fail"}"><i class="bi ${a.passed ? "bi-patch-check-fill" : "bi-x-octagon-fill"}"></i> ${a.passed ? "Passed" : "Not passed"}</span>
                <h1>${esc(a.quizTitle)}</h1>
                <p class="result-score"><strong class="num">${App.marks(a.score)}</strong> / ${App.marks(a.totalMarks)} marks${data.passingMarks !== null ? ` <span class="faint">(pass mark ${App.marks(data.passingMarks)})</span>` : ""}</p>
                <p class="result-summary">${esc(summary(a, data.negativeMarking))}</p>
                ${!isOwner ? `<p class="faint" style="margin-top:8px">Candidate: <b>${esc(a.userName)}</b></p>` : ""}
                <div class="result-actions no-print">
                    <a class="btn btn--primary" href="leaderboard.html?quiz=${a.quizId}"><i class="bi bi-trophy"></i> Leaderboard${data.rank ? ` (rank ${data.rank} of ${data.candidates})` : ""}</a>
                    <a class="btn" href="${isOwner ? "home.html" : "admin.html#results"}"><i class="bi bi-arrow-left"></i> ${isOwner ? "Dashboard" : "Back to results"}</a>
                    <button class="btn btn--ghost" onclick="window.print()"><i class="bi bi-printer"></i> Print</button>
                </div>
            </div>
        </section>

        <section class="kpis">
            <div class="kpi kpi--green"><span><i class="bi bi-check-circle-fill"></i> Correct</span><strong>${a.correctAnswers}</strong><small>+${App.marks(gained)} marks</small></div>
            <div class="kpi kpi--red"><span><i class="bi bi-x-circle-fill"></i> Incorrect</span><strong>${a.incorrectAnswers}</strong><small>${lost ? "&minus;" + App.marks(lost) + " marks" : "No marks lost"}</small></div>
            <div class="kpi kpi--grey"><span><i class="bi bi-dash-circle-fill"></i> Unanswered</span><strong>${a.unanswered}</strong><small>0 marks</small></div>
            <div class="kpi"><span><i class="bi bi-bullseye"></i> Accuracy</span><strong>${App.pct(accuracy)}</strong><small>of answered questions</small></div>
            <div class="kpi kpi--amber"><span><i class="bi bi-stopwatch"></i> Time taken</span><strong>${App.clock(a.timeTaken)}</strong><small>of ${a.duration} min</small></div>
            <div class="kpi"><span><i class="bi bi-hash"></i> Rank</span><strong>${data.rank ? data.rank : "-"}</strong><small>${data.candidates} candidate${data.candidates === 1 ? "" : "s"}</small></div>
        </section>

        <section class="split" style="margin-bottom:20px">
            <div class="panel panel--pad">
                <div class="panel__head"><div><h3>Answer breakdown</h3><p>${review.length} questions</p></div></div>
                <div class="stack-bar" id="stackBar">
                    <span class="s-correct" data-grow="${a.correctAnswers}"></span>
                    <span class="s-incorrect" data-grow="${a.incorrectAnswers}"></span>
                    <span class="s-unanswered" data-grow="${a.unanswered}"></span>
                </div>
                <div class="legend">
                    <span><i style="background:var(--green)"></i>Correct ${a.correctAnswers}</span>
                    <span><i style="background:var(--red)"></i>Incorrect ${a.incorrectAnswers}</span>
                    <span><i style="background:var(--text-3)"></i>Unanswered ${a.unanswered}</span>
                </div>
            </div>
            <div class="panel panel--pad">
                <div class="panel__head"><div><h3>Time</h3><p>${a.submittedAutomatically ? "Auto-submitted when time ran out" : "Submitted by you"}</p></div></div>
                <div class="time-compare">
                    <div class="time-compare__row"><span class="muted">Allowed</span><div class="meter"><span data-w="100"></span></div><b>${App.clock(allowed)}</b></div>
                    <div class="time-compare__row"><span class="muted">Used</span><div class="meter ${a.timeTaken >= allowed ? "is-low" : "is-good"}"><span data-w="${allowed ? Math.min(100, a.timeTaken / allowed * 100) : 0}"></span></div><b>${App.clock(a.timeTaken)}</b></div>
                </div>
                <p class="faint" style="font-size:.84rem;margin-top:14px">Started ${esc(App.date(a.startedAt))}. Submitted ${esc(App.date(a.submittedAt))}.</p>
            </div>
        </section>

        <section class="panel panel--pad">
            <div class="panel__head">
                <div><h3>Answer review</h3><p>Your answer next to the correct one for every question.</p></div>
                <div class="segmented no-print" id="reviewFilter">
                    <button class="is-active" data-f="all">All ${review.length}</button>
                    <button data-f="correct">Correct ${a.correctAnswers}</button>
                    <button data-f="incorrect">Incorrect ${a.incorrectAnswers}</button>
                    <button data-f="unanswered">Unanswered ${a.unanswered}</button>
                </div>
            </div>
            <div class="review" id="reviewList"></div>
        </section>`;

    renderReview();

    /* one orchestrated moment: ring, bars and meters fill together */
    requestAnimationFrame(() => requestAnimationFrame(() => {
        const bar = document.getElementById("ringBar");
        if (bar) bar.style.strokeDashoffset = C * (1 - Math.min(100, a.percentage) / 100);
        document.querySelectorAll("#stackBar [data-grow]").forEach(s => { s.style.flexGrow = s.dataset.grow; });
        document.querySelectorAll("[data-w]").forEach(s => { s.style.width = s.dataset.w + "%"; });
    }));

    document.getElementById("reviewFilter").addEventListener("click", (e) => {
        const b = e.target.closest("[data-f]");
        if (!b) return;
        filter = b.dataset.f;
        document.querySelectorAll("#reviewFilter button").forEach(x => x.classList.toggle("is-active", x === b));
        renderReview();
    });
}

function renderReview() {
    const list = review.map((r, i) => ({ ...r, n: i + 1 })).filter(r => filter === "all" || r.result === filter);
    const host = document.getElementById("reviewList");
    if (!list.length) {
        host.innerHTML = `<div class="empty"><i class="bi bi-funnel"></i><strong>Nothing here</strong>No questions in this group.</div>`;
        return;
    }
    host.innerHTML = list.map(r => {
        const label = { correct: ["badge--green", "Correct"], incorrect: ["badge--red", "Incorrect"], unanswered: ["", "Not answered"] }[r.result];
        return `
        <article class="review-item is-${r.result}">
            <div class="review-item__head">
                <span>Question ${r.n}${r.topic ? " | " + esc(r.topic) : ""}</span>
                <span><span class="badge ${label[0]}">${label[1]}</span> <span class="badge">${r.awarded > 0 ? "+" : r.awarded < 0 ? "&minus;" : ""}${App.marks(Math.abs(r.awarded))} marks</span></span>
            </div>
            <div class="review-item__q">${esc(r.question)}</div>
            <div class="review-opts">
                ${r.options.map((o, k) => {
                    const right = o === r.correct, mine = o === r.selected;
                    const cls = right ? "is-right" : (mine ? "is-wrong" : "");
                    const tag = right && mine ? "Your answer, correct" : right ? "Correct answer" : mine ? "Your answer" : "";
                    return `<div class="review-opt ${cls}"><span class="bubble"><span>${"ABCDEF"[k]}</span></span><span>${esc(o)}</span>${tag ? `<span class="review-opt__tag">${tag}</span>` : ""}</div>`;
                }).join("")}
            </div>
            ${r.explanation ? `<div class="review-explain"><b>Explanation:</b> ${esc(r.explanation)}</div>` : ""}
        </article>`;
    }).join("");
}

load();
