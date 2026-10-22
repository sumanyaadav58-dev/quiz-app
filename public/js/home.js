/* =========================================================
   HOME: live clock, stats, available exams, recent attempts
========================================================= */

const user = App.guard("user");
App.nav("home");
App.scene("https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=1920&q=60");

const $ = (id) => document.getElementById(id);
const esc = App.esc;

let exams = [];
let activeCategory = "All";


/* ---------------- greeting ---------------- */

(function greet() {
    const h = new Date().getHours();
    const part = h < 5 ? "Working late" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
    const first = user.name.split(" ")[0];
    $("greeting").textContent = App.qs("welcome") ? `Welcome, ${first}` : `${part}, ${first}`;
    if (App.qs("welcome")) {
        $("heroText").textContent = "Your account is ready. Pick an examination below and read the instructions before you start.";
        history.replaceState(null, "", "home.html");
    }
})();


/* ---------------- live clock (updates every second, no reload) ---------------- */

(function clock() {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    const pad = (n) => String(n).padStart(2, "0");
    const hour12 = new Intl.DateTimeFormat(undefined, { hour: "numeric" }).resolvedOptions().hour12;

    function tick() {
        const now = new Date();
        let h = now.getHours();
        if (hour12) {
            $("clockAmPm").textContent = h >= 12 ? "PM" : "AM";
            h = h % 12 || 12;
        }
        $("clockH").textContent = pad(h);
        $("clockM").textContent = pad(now.getMinutes());
        $("clockS").textContent = pad(now.getSeconds());
        $("clockDate").textContent = now.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
        const offset = -now.getTimezoneOffset();
        const sign = offset >= 0 ? "+" : "-";
        $("clockZone").textContent = `${zone.replace(/_/g, " ")}  (UTC${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)})`;
    }

    tick();
    /* align to the next full second so the seconds never skip */
    setTimeout(() => { tick(); setInterval(tick, 1000); }, 1000 - (Date.now() % 1000));
})();


/* ---------------- stats ---------------- */

async function loadStats() {
    try {
        const { stats } = await App.api("/api/attempt/my/stats");
        const items = [
            ["bi-journal-check", "Attempts", stats.attempts, stats.passed + " passed"],
            ["bi-award", "Best score", stats.attempts ? App.pct(stats.bestPercentage) : "None yet", "Highest percentage"],
            ["bi-bar-chart", "Average", stats.attempts ? App.pct(stats.averagePercentage) : "None yet", "Across all attempts"],
            ["bi-bullseye", "Accuracy", stats.attempts ? App.pct(stats.accuracy) : "None yet", "Correct of answered"]
        ];
        $("stats").innerHTML = items.map(([icon, label, value, sub]) => `
            <div class="stat">
                <div class="stat__label"><i class="bi ${icon}"></i> ${label}</div>
                <div class="stat__value">${esc(value)}</div>
                <div class="stat__sub">${esc(sub)}</div>
            </div>`).join("");
    } catch (error) {
        $("stats").innerHTML = "";
    }
}


/* ---------------- exams ---------------- */

async function loadExams() {
    try {
        const data = await App.api("/api/quiz/available");
        exams = data.quizzes;
        renderChips();
        renderExams();

        const running = exams.find(e => e.inProgress);
        if (running) {
            $("heroCta").href = "quiz.html?id=" + running._id;
            $("heroCta").innerHTML = '<i class="bi bi-play-circle"></i> Resume ' + esc(running.title);
            $("heroCta").classList.replace("btn--primary", "btn--amber");
        }
    } catch (error) {
        $("examGrid").innerHTML = `<div class="empty panel" style="grid-column:1/-1"><i class="bi bi-wifi-off"></i><strong>Couldn't load examinations</strong>${esc(error.message)}<br><button class="btn" onclick="loadExams()">Try again</button></div>`;
        $("examsCount").textContent = "";
    }
}

function renderChips() {
    const cats = ["All", ...new Set(exams.map(e => e.category || "General"))];
    $("categoryChips").innerHTML = cats.length > 2
        ? cats.map(c => `<button class="chip ${c === activeCategory ? "is-active" : ""}" data-cat="${esc(c)}" type="button">${esc(c)}</button>`).join("")
        : "";
}

$("categoryChips").addEventListener("click", (e) => {
    const chip = e.target.closest("[data-cat]");
    if (!chip) return;
    activeCategory = chip.dataset.cat;
    renderChips();
    renderExams();
});

$("examSearch").addEventListener("input", renderExams);

function examCard(q) {
    const diff = { Easy: "badge--green", Medium: "badge--amber", Hard: "badge--red" }[q.difficulty] || "";
    const left = q.attemptLimit > 0 ? `${Math.max(0, q.attemptLimit - q.attemptsUsed)} of ${q.attemptLimit} attempts left` : (q.attemptsUsed ? `${q.attemptsUsed} attempt${q.attemptsUsed === 1 ? "" : "s"} so far` : "Unlimited attempts");

    let action;
    if (q.inProgress) {
        action = `<a class="btn btn--amber" href="quiz.html?id=${q._id}"><i class="bi bi-play-circle"></i> Resume</a>`;
    } else if (q.unavailableReason) {
        action = `<button class="btn" disabled title="${esc(q.unavailableReason)}"><i class="bi bi-lock"></i> ${esc(q.unavailableReason)}</button>`;
    } else {
        action = `<a class="btn btn--primary" href="quiz.html?id=${q._id}"><i class="bi bi-file-earmark-text"></i> View instructions</a>`;
    }

    return `
        <article class="exam-card ${q.inProgress ? "is-running" : ""}">
            <div class="exam-card__top">
                <div>
                    <div class="exam-card__cat">${esc(q.category || "General")}</div>
                    <h3>${esc(q.title)}</h3>
                </div>
                <span class="badge ${diff}">${esc(q.difficulty)}</span>
            </div>
            ${q.description ? `<p class="exam-card__desc">${esc(q.description)}</p>` : ""}
            <div class="exam-card__meta">
                <div><span>Duration</span><strong>${q.duration} min</strong></div>
                <div><span>Questions</span><strong>${q.questionCount}</strong></div>
                <div><span>Marks</span><strong>${App.marks(q.totalMarks)}</strong></div>
            </div>
            <div class="chip-row">
                ${q.negativeMarking ? '<span class="badge badge--red"><i class="bi bi-dash-circle"></i> Negative marking</span>' : '<span class="badge"><i class="bi bi-check2-circle"></i> No negative marking</span>'}
                ${q.inProgress ? '<span class="badge badge--amber"><i class="bi bi-hourglass-split"></i> In progress</span>' : ""}
                ${q.bestPercentage !== null ? `<span class="badge badge--blue">Best ${App.pct(q.bestPercentage)}</span>` : ""}
            </div>
            <div class="exam-card__foot">
                <span class="exam-card__note">${esc(left)}${q.endAt ? " · closes " + esc(App.date(q.endAt)) : ""}</span>
                ${action}
            </div>
        </article>`;
}

function renderExams() {
    const term = $("examSearch").value.trim().toLowerCase();
    const list = exams.filter(q =>
        (activeCategory === "All" || (q.category || "General") === activeCategory) &&
        (!term || q.title.toLowerCase().includes(term) || (q.description || "").toLowerCase().includes(term) || (q.category || "").toLowerCase().includes(term)));

    $("examsCount").textContent = exams.length
        ? `${list.length} of ${exams.length} examination${exams.length === 1 ? "" : "s"}`
        : "Nothing published yet";

    if (!exams.length) {
        $("examGrid").innerHTML = `<div class="empty panel" style="grid-column:1/-1"><i class="bi bi-inbox"></i><strong>No examinations yet</strong>Your administrator hasn't published any. Check back soon.</div>`;
        return;
    }
    if (!list.length) {
        $("examGrid").innerHTML = `<div class="empty panel" style="grid-column:1/-1"><i class="bi bi-search"></i><strong>No matches</strong>Try a different search or category.</div>`;
        return;
    }
    $("examGrid").innerHTML = list.map(examCard).join("");
}


/* ---------------- recent attempts & top candidates ---------------- */

async function loadRecent() {
    try {
        const { attempts } = await App.api("/api/attempt/my");
        if (!attempts.length) {
            $("recentList").innerHTML = `<div class="empty"><i class="bi bi-clock-history"></i><strong>No attempts yet</strong>Your results will show up here after your first examination.</div>`;
            return;
        }
        $("recentList").innerHTML = attempts.slice(0, 5).map(a => `
            <a class="list-item" href="result.html?attempt=${a._id}">
                <span class="badge ${a.passed ? "badge--green" : "badge--red"}">${a.passed ? "Pass" : "Fail"}</span>
                <div class="list-item__main">
                    <strong>${esc(a.quizTitle)}</strong>
                    <span>${esc(App.relative(a.submittedAt))} · ${esc(App.duration(a.timeTaken))}${a.submittedAutomatically ? " · auto-submitted" : ""}</span>
                </div>
                <div class="list-item__end">${App.pct(a.percentage)}<small>${App.marks(a.score)} / ${App.marks(a.totalMarks)}</small></div>
            </a>`).join("");
    } catch (error) {
        $("recentList").innerHTML = `<p class="muted">${esc(error.message)}</p>`;
    }
}

async function loadTop() {
    try {
        const data = await App.api("/api/attempt/leaderboard?limit=5");
        if (!data.rows.length) {
            $("topList").innerHTML = `<div class="empty"><i class="bi bi-trophy"></i><strong>The board is empty</strong>Be the first to set a score.</div>`;
            return;
        }
        let rows = data.rows.map(r => row(r)).join("");
        if (data.me && data.me.rank > 5) rows += `<div class="faint" style="text-align:center;padding:6px 0">...</div>` + row(data.me);
        $("topList").innerHTML = rows;
    } catch (error) {
        $("topList").innerHTML = `<p class="muted">${esc(error.message)}</p>`;
    }

    function row(r) {
        return `
            <div class="list-item" ${r.isMe ? 'style="background:var(--blue-soft);padding-left:10px;padding-right:10px"' : ""}>
                <span class="rank-dot ${r.rank <= 3 ? "r" + r.rank : ""}">${r.rank}</span>
                <div class="list-item__main"><strong>${esc(r.name)}${r.isMe ? " (you)" : ""}</strong><span>${r.quizzes} exam${r.quizzes === 1 ? "" : "s"}</span></div>
                <div class="list-item__end">${App.pct(r.percentage)}</div>
            </div>`;
    }
}

loadStats();
loadExams();
loadRecent();
loadTop();
