/* =========================================================
   LEADERBOARD   leaderboard.html?quiz=<quizId>
   Data comes from submitted attempts in the database.
========================================================= */

const user = App.guard();
App.nav("leaderboard");
App.scene();

const $ = (id) => document.getElementById(id);
const esc = App.esc;
let rows = [];
let quizMode = false;

async function loadQuizzes() {
    try {
        const list = user.role === "admin"
            ? (await App.api("/api/admin/quizzes")).quizzes
            : await App.api("/api/quiz");
        $("quizSelect").innerHTML += list.map(q => `<option value="${q._id}">${esc(q.title)}</option>`).join("");
        const pre = App.qs("quiz");
        if (pre && list.some(q => q._id === pre)) $("quizSelect").value = pre;
    } catch (e) { /* the overall board still works */ }
}

async function load() {
    const quizId = $("quizSelect").value;
    quizMode = Boolean(quizId);
    $("lbBody").innerHTML = `<tr><td colspan="6"><div class="skeleton" style="height:120px"></div></td></tr>`;
    try {
        const data = await App.api("/api/attempt/leaderboard?limit=500" + (quizId ? "&quizId=" + quizId : ""));
        rows = data.rows;
        $("lbSub").textContent = quizMode
            ? "Best attempt per candidate for this examination. Ties go to the faster time."
            : "Average of each candidate's best percentage per examination.";
        $("lbCount").textContent = `${data.total} candidate${data.total === 1 ? "" : "s"}`;
        history.replaceState(null, "", quizId ? "leaderboard.html?quiz=" + quizId : "leaderboard.html");
        renderPodium();
        renderMe(data.me);
        renderTable();
    } catch (error) {
        $("lbBody").innerHTML = `<tr><td colspan="6"><div class="empty"><i class="bi bi-exclamation-circle"></i><strong>Couldn't load the leaderboard</strong>${esc(error.message)}</div></td></tr>`;
    }
}

function scoreText(r) {
    return quizMode ? `${App.marks(r.score)} / ${App.marks(r.totalMarks)}` : `${r.quizzes} exam${r.quizzes === 1 ? "" : "s"}`;
}

function renderPodium() {
    const top = rows.slice(0, 3);
    if (!top.length) {
        $("podium").innerHTML = "";
        return;
    }
    /* visual order: 2nd, 1st, 3rd */
    const order = [top[1], top[0], top[2]];
    $("podium").innerHTML = order.map((r, i) => {
        if (!r) return "<div></div>";
        const p = [2, 1, 3][i];
        return `
            <div class="podium__slot p${p} ${r.isMe ? "is-me" : ""}">
                <div class="podium__medal">${p}</div>
                <div class="podium__name" title="${esc(r.name)}">${esc(r.name)}${r.isMe ? " (you)" : ""}</div>
                <div class="podium__pct">${App.pct(r.percentage)}</div>
                <div class="podium__sub">${esc(scoreText(r))} | ${App.duration(r.timeTaken)}</div>
            </div>`;
    }).join("");
}

function renderMe(me) {
    if (user.role === "admin") { $("meCard").innerHTML = ""; return; }
    if (!me) {
        $("meCard").innerHTML = `<div class="me-card"><i class="bi bi-person-circle" style="font-size:1.6rem"></i><div class="me-card__text"><strong>You're not on this board yet</strong><span>Finish an examination to get ranked.</span></div><a class="btn btn--primary btn--sm" href="home.html">Find an examination</a></div>`;
        return;
    }
    $("meCard").innerHTML = `
        <div class="me-card">
            <div class="me-card__rank">#${me.rank}</div>
            <div class="me-card__text"><strong>Your position</strong><span>Out of ${rows.length} candidate${rows.length === 1 ? "" : "s"}${me.rank <= 3 ? ". You're on the podium." : ""}</span></div>
            <div class="me-card__nums">
                <div><span>Percentage</span><b>${App.pct(me.percentage)}</b></div>
                <div><span>${quizMode ? "Score" : "Exams"}</span><b>${esc(scoreText(me))}</b></div>
                <div><span>Time</span><b>${App.duration(me.timeTaken)}</b></div>
            </div>
        </div>`;
}

function renderTable() {
    const term = $("lbSearch").value.trim().toLowerCase();
    const list = rows.filter(r => !term || r.name.toLowerCase().includes(term));
    if (!rows.length) {
        $("lbBody").innerHTML = `<tr><td colspan="6"><div class="empty"><i class="bi bi-trophy"></i><strong>No results yet</strong>Rankings appear once candidates submit this examination.</div></td></tr>`;
        return;
    }
    if (!list.length) {
        $("lbBody").innerHTML = `<tr><td colspan="6"><div class="empty"><i class="bi bi-search"></i><strong>No candidate matches "${esc(term)}"</strong></div></td></tr>`;
        return;
    }
    $("lbBody").innerHTML = list.map((r, i) => `
        <tr class="${r.isMe ? "is-me" : ""}" style="animation-delay:${Math.min(i, 12) * 35}ms">
            <td class="col-rank"><span class="rank-dot ${r.rank <= 3 ? "r" + r.rank : ""}">${r.rank}</span></td>
            <td class="col-who"><div class="who">${App.avatar(r)}<strong>${esc(r.name)}${r.isMe ? " (you)" : ""}</strong></div></td>
            <td class="t-right num col-hide-m">${esc(scoreText(r))}</td>
            <td class="t-right t-strong num col-main">${App.pct(r.percentage)}</td>
            <td class="col-extra"><span class="cis"><span class="c" title="Correct">${r.correct}</span><span class="i" title="Incorrect">${r.incorrect}</span><span class="u" title="Unanswered">${r.unanswered}</span></span><span class="faint m-only" style="font-size:.78rem"> correct / incorrect / unanswered</span></td>
            <td class="t-right num col-hide-m">${App.duration(r.timeTaken)}</td>
        </tr>`).join("");
}

$("quizSelect").addEventListener("change", load);
$("lbSearch").addEventListener("input", renderTable);

loadQuizzes().then(load);
