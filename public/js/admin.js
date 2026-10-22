/* =========================================================
   ADMIN PORTAL
   Hash routes: #dashboard  #exams  #exam/<id>  #bank  #users  #results  #analytics
   Every call goes to /api/admin/* which the server protects with
   auth + admin middleware; the checks here are only for UX.
========================================================= */

const admin = App.guard("admin");
const API = "/api/admin";
const $ = (id) => document.getElementById(id);
const esc = App.esc;
const view = $("view");

App.scene();

let quizCache = [];
let quizCtx = null;        /* quiz open in the question manager / editor */
let questionCtx = null;    /* { quizId, questionId, negativeMarking } */
let editingQuizId = null;
let routeToken = 0;


/* =========================================================
   BOOT
========================================================= */

(async function boot() {
    try {
        const { user } = await App.api("/api/auth/me");
        if (user.role !== "admin") return location.replace("home.html");
        App.Session.update(user);
        $("adminName").textContent = user.name;
        App.paintAvatar($("adminAvatar"), user);
        LiveMonitor.connect();   /* real-time candidate list for Live Exam Monitoring */
        document.body.classList.remove("is-guarding");
        App.setTheme(App.getTheme());
        refreshCounts();
        route();
    } catch (error) {
        document.body.classList.remove("is-guarding");
        view.innerHTML = emptyBox("bi-exclamation-circle", "Couldn't load the admin portal", error.message);
    }
})();

window.addEventListener("hashchange", route);

async function refreshCounts() {
    try {
        const { stats } = await App.api(API + "/stats");
        $("navExams").textContent = stats.totalQuizzes;
        $("navQuestions").textContent = stats.totalQuestions;
        $("navUsers").textContent = stats.totalUsers;
        $("liveBadge").innerHTML = stats.inProgress
            ? `<a href="#live" class="badge badge--amber hide-sm" title="Open Live Exam Monitoring" style="text-decoration:none"><i class="bi bi-broadcast"></i> ${stats.inProgress} sitting now</a>`
            : "";
        return stats;
    } catch (e) { return null; }
}


/* =========================================================
   ROUTER
========================================================= */

const routes = {
    dashboard: ["Dashboard", "Everything at a glance", renderDashboard],
    live: ["Live Exam Monitoring", "Candidates sitting an exam right now, with live camera and microphone", (arg, token) => LiveMonitor.render(view, () => stale(token))],
    exams: ["Examinations", "Create, schedule and publish examinations", renderExams],
    exam: ["Questions", "", renderExamDetail],
    bank: ["Question bank", "Every question across every examination", renderBank],
    users: ["Candidates", "Registered accounts and their performance", renderUsers],
    results: ["Results", "Every submitted attempt", renderResults],
    analytics: ["Analytics", "How examinations and questions are performing", renderAnalytics]
};

function route() {
    const [name, arg] = (location.hash.replace("#", "") || "dashboard").split("/");
    const r = routes[name] || routes.dashboard;
    const key = routes[name] ? name : "dashboard";

    document.querySelectorAll("[data-nav]").forEach(a => {
        const active = a.dataset.nav === key || (key === "exam" && a.dataset.nav === "exams");
        a.classList.toggle("is-active", active);
        if (active) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });

    $("pageTitle").textContent = r[0];
    $("pageSubtitle").textContent = r[1];
    document.title = r[0] + " | Admin | Quiz App";
    closeSidebar();

    const token = ++routeToken;
    view.innerHTML = `<div class="aview"><div class="skeleton" style="height:120px;margin-bottom:16px"></div><div class="skeleton" style="height:260px"></div></div>`;
    r[2](arg, token);
    window.scrollTo(0, 0);
}

function stale(token) { return token !== routeToken; }


/* =========================================================
   SHARED BITS
========================================================= */

function emptyBox(icon, title, text, action = "") {
    return `<div class="panel empty"><i class="bi ${icon}"></i><strong>${esc(title)}</strong>${esc(text)}${action ? "<br>" + action : ""}</div>`;
}

function statusBadge(s) {
    return {
        published: '<span class="badge badge--green"><i class="bi bi-broadcast"></i> Published</span>',
        draft: '<span class="badge"><i class="bi bi-pencil"></i> Draft</span>',
        closed: '<span class="badge badge--red"><i class="bi bi-lock"></i> Closed</span>'
    }[s] || esc(s);
}

function diffBadge(d) {
    return `<span class="badge ${{ Easy: "badge--green", Medium: "badge--amber", Hard: "badge--red" }[d] || ""}">${esc(d)}</span>`;
}

async function loadQuizCache() {
    const { quizzes } = await App.api(API + "/quizzes");
    quizCache = quizzes;
    return quizzes;
}

function quizOptions(selected, allLabel = "All examinations") {
    return `<option value="">${allLabel}</option>` + quizCache.map(q => `<option value="${q._id}" ${q._id === selected ? "selected" : ""}>${esc(q.title)}</option>`).join("");
}

/* dropdown menus */
document.addEventListener("click", (e) => {
    const trigger = e.target.closest("[data-menu]");
    document.querySelectorAll(".menu.is-open").forEach(m => { if (!trigger || m !== trigger.parentElement) m.classList.remove("is-open"); });
    if (trigger) trigger.parentElement.classList.toggle("is-open");
});

/* sidebar on small screens */
function openSidebar() { $("sidebar").classList.add("is-open"); $("sideBackdrop").classList.add("is-open"); }
function closeSidebar() { $("sidebar").classList.remove("is-open"); $("sideBackdrop").classList.remove("is-open"); }
$("menuBtn").addEventListener("click", openSidebar);
$("sideBackdrop").addEventListener("click", closeSidebar);
$("navCreate").addEventListener("click", () => { closeSidebar(); openQuizEditor(); });

function debounce(fn, ms = 250) {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

function toLocalInput(value) {
    if (!value) return "";
    const d = new Date(value);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}


/* =========================================================
   DASHBOARD
========================================================= */

async function renderDashboard(_, token) {
    try {
        const [stats, analytics] = await Promise.all([refreshCounts(), App.api(API + "/analytics")]);
        if (stale(token) || !stats) return;

        const days = analytics.attemptsByDay;
        const maxDay = Math.max(1, ...days.map(d => d.count));
        const dist = analytics.scoreDistribution;
        const maxDist = Math.max(1, ...dist.map(d => d.count));
        const top = analytics.quizPerformance.filter(q => q.attempts > 0).slice(0, 5);

        view.innerHTML = `
        <div class="aview">
            <section class="tiles">
                ${tile("bi-people", "", "Candidates", stats.totalUsers, `${stats.activeUsers} active`)}
                ${tile("bi-journal-text", "violet", "Examinations", stats.totalQuizzes, `${stats.publishedQuizzes} published, ${stats.draftQuizzes} draft, ${stats.closedQuizzes} closed`)}
                ${tile("bi-collection", "amber", "Questions", stats.totalQuestions, "Across all examinations")}
                ${tile("bi-clipboard-check", "green", "Attempts", stats.totalAttempts, `Average ${App.pct(stats.averagePercentage)}, pass rate ${App.pct(stats.passRate)}`)}
            </section>

            <section class="agrid">
                <div class="panel panel--pad">
                    <div class="panel__head"><div><h3>Attempts, last 14 days</h3><p>${days.reduce((s, d) => s + d.count, 0)} submitted in this period</p></div></div>
                    <div class="cols" role="img" aria-label="Attempts per day for the last 14 days">
                        ${days.map(d => `
                            <div class="cols__col" title="${esc(d.date)}: ${d.count}">
                                <div class="cols__bar ${d.count ? "" : "is-zero"}" data-h="${d.count / maxDay * 100}">${d.count ? `<span>${d.count}</span>` : ""}</div>
                                <div class="cols__lbl">${new Date(d.date + "T00:00").toLocaleDateString(undefined, { day: "numeric", month: "short" })}</div>
                            </div>`).join("")}
                    </div>
                </div>
                <div class="panel panel--pad">
                    <div class="panel__head"><div><h3>Score distribution</h3><p>All submitted attempts</p></div></div>
                    <div class="hbars">
                        ${dist.map(b => `<div class="hbar"><span class="muted">${b.label}</span><div class="meter"><span data-w="${b.count / maxDist * 100}"></span></div><b>${b.count}</b></div>`).join("")}
                    </div>
                </div>
            </section>

            <section class="agrid agrid--even">
                <div class="panel panel--pad">
                    <div class="panel__head"><div><h3>Most attempted</h3><p>By submitted attempts</p></div><a class="btn btn--sm btn--ghost" href="#analytics">Analytics</a></div>
                    ${top.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Examination</th><th class="t-right">Attempts</th><th class="t-right">Avg</th><th class="t-right">Pass rate</th></tr></thead><tbody>
                        ${top.map(q => `<tr><td class="qcell"><strong>${esc(q.title)}</strong><span>${esc(q.category)}</span></td><td class="t-right num">${q.attempts}</td><td class="t-right num">${App.pct(q.averagePercentage)}</td><td class="t-right num">${App.pct(q.passRate)}</td></tr>`).join("")}
                    </tbody></table></div>` : `<div class="empty"><i class="bi bi-bar-chart"></i><strong>No attempts yet</strong>Publish an examination to start collecting results.</div>`}
                </div>
                <div class="panel panel--pad">
                    <div class="panel__head"><div><h3>Recent attempts</h3><p>Latest submissions</p></div><a class="btn btn--sm btn--ghost" href="#results">All results</a></div>
                    ${analytics.recentAttempts.length ? `<div class="table-wrap"><table class="table"><tbody>
                        ${analytics.recentAttempts.map(a => `<tr>
                            <td class="qcell"><strong>${esc(a.userName || "Candidate")}</strong><span>${esc(a.quizTitle)}</span></td>
                            <td class="t-right num t-strong">${App.pct(a.percentage)}</td>
                            <td class="t-right">${a.passed ? '<span class="badge badge--green">Pass</span>' : '<span class="badge badge--red">Fail</span>'}</td>
                            <td class="t-right faint hide-sm" style="font-size:.82rem">${esc(App.relative(a.submittedAt))}</td>
                        </tr>`).join("")}
                    </tbody></table></div>` : `<div class="empty"><i class="bi bi-inbox"></i><strong>Nothing submitted yet</strong></div>`}
                </div>
            </section>

            <section class="panel panel--pad">
                <div class="panel__head"><div><h3>Quick actions</h3></div></div>
                <div class="chip-row">
                    <button class="btn btn--primary" onclick="openQuizEditor()"><i class="bi bi-plus-lg"></i> New examination</button>
                    <a class="btn" href="#exams"><i class="bi bi-journal-text"></i> Manage examinations</a>
                    <a class="btn" href="#bank"><i class="bi bi-collection"></i> Question bank</a>
                    <a class="btn" href="#users"><i class="bi bi-people"></i> Candidates</a>
                    <button class="btn" onclick="exportResults()"><i class="bi bi-download"></i> Export results (CSV)</button>
                </div>
            </section>
        </div>`;

        requestAnimationFrame(() => requestAnimationFrame(() => {
            view.querySelectorAll("[data-h]").forEach(el => el.style.height = Math.max(2, el.dataset.h) + "%");
            view.querySelectorAll("[data-w]").forEach(el => el.style.width = el.dataset.w + "%");
        }));
    } catch (error) {
        if (!stale(token)) view.innerHTML = emptyBox("bi-exclamation-circle", "Couldn't load the dashboard", error.message, `<button class="btn" onclick="route()">Try again</button>`);
    }
}

function tile(icon, tone, label, value, sub) {
    return `<div class="tile"><div class="tile__top"><span>${label}</span><span class="tile__icon ${tone}"><i class="bi ${icon}"></i></span></div><div class="tile__value">${value}</div><div class="tile__sub">${esc(sub)}</div></div>`;
}


/* =========================================================
   EXAMINATIONS LIST
========================================================= */

let examFilter = { search: "", status: "" };

async function renderExams(_, token) {
    try {
        await loadQuizCache();
        if (stale(token)) return;

        view.innerHTML = `
        <div class="aview">
            <div class="atoolbar">
                <div class="input-wrap"><i class="bi bi-search"></i><input class="input" id="exSearch" type="search" placeholder="Search by title or subject" value="${esc(examFilter.search)}" aria-label="Search examinations"></div>
                <select class="input" id="exStatus" aria-label="Filter by status">
                    <option value="">Any status</option>
                    <option value="published" ${examFilter.status === "published" ? "selected" : ""}>Published</option>
                    <option value="draft" ${examFilter.status === "draft" ? "selected" : ""}>Draft</option>
                    <option value="closed" ${examFilter.status === "closed" ? "selected" : ""}>Closed</option>
                </select>
                <div class="atoolbar__end"><button class="btn btn--primary" onclick="openQuizEditor()"><i class="bi bi-plus-lg"></i> New examination</button></div>
            </div>
            <div class="panel" style="padding:6px 8px"><div class="table-wrap" id="examTable"></div></div>
        </div>`;

        $("exSearch").addEventListener("input", debounce(e => { examFilter.search = e.target.value; drawExamTable(); }, 150));
        $("exStatus").addEventListener("change", e => { examFilter.status = e.target.value; drawExamTable(); });
        drawExamTable();
    } catch (error) {
        if (!stale(token)) view.innerHTML = emptyBox("bi-exclamation-circle", "Couldn't load examinations", error.message);
    }
}

function drawExamTable() {
    const term = examFilter.search.trim().toLowerCase();
    const list = quizCache.filter(q =>
        (!examFilter.status || q.status === examFilter.status) &&
        (!term || q.title.toLowerCase().includes(term) || (q.category || "").toLowerCase().includes(term)));

    if (!quizCache.length) {
        $("examTable").innerHTML = `<div class="empty"><i class="bi bi-journal-plus"></i><strong>No examinations yet</strong>Create one, add questions, then publish it for candidates.<br><button class="btn btn--primary" onclick="openQuizEditor()">New examination</button></div>`;
        return;
    }
    if (!list.length) {
        $("examTable").innerHTML = `<div class="empty"><i class="bi bi-search"></i><strong>No examinations match</strong>Try another search or status.</div>`;
        return;
    }

    $("examTable").innerHTML = `
        <table class="table">
            <thead><tr><th>Examination</th><th>Status</th><th class="t-right hide-sm">Questions</th><th class="t-right hide-sm">Duration</th><th class="t-right hide-sm">Marks</th><th class="t-right hide-sm">Attempts</th><th class="t-right">Actions</th></tr></thead>
            <tbody>
            ${list.map(q => `
                <tr>
                    <td class="qcell"><strong>${esc(q.title)}</strong><span>${esc(q.category)} | ${esc(q.difficulty)} | ${q.questionCount} Q, ${q.duration} min${q.negativeMarking ? " | negative marking" : ""}${q.endAt ? " | closes " + esc(App.date(q.endAt)) : ""}</span></td>
                    <td>${statusBadge(q.status)}</td>
                    <td class="t-right num hide-sm">${q.questionCount}</td>
                    <td class="t-right num hide-sm">${q.duration} min</td>
                    <td class="t-right num hide-sm">${App.marks(q.totalMarks)}</td>
                    <td class="t-right num hide-sm">${q.attemptCount}</td>
                    <td>
                        <div class="actions">
                            <a class="btn btn--sm" href="#exam/${q._id}"><i class="bi bi-list-check"></i> <span class="hide-sm">Questions</span></a>
                            <div class="menu">
                                <button class="btn btn--sm btn--icon" type="button" data-menu aria-label="More actions for ${esc(q.title)}"><i class="bi bi-three-dots"></i></button>
                                <div class="menu__list">
                                    <button type="button" onclick="openQuizEditor('${q._id}')"><i class="bi bi-gear"></i> Edit settings and timer</button>
                                    <button type="button" onclick="previewQuiz('${q._id}')"><i class="bi bi-eye"></i> Preview</button>
                                    ${q.status !== "published" ? `<button type="button" onclick="setStatus('${q._id}','published')"><i class="bi bi-broadcast"></i> Publish</button>` : ""}
                                    ${q.status === "published" ? `<button type="button" onclick="setStatus('${q._id}','draft')"><i class="bi bi-pause-circle"></i> Unpublish (move to draft)</button>` : ""}
                                    ${q.status !== "closed" ? `<button type="button" onclick="setStatus('${q._id}','closed')"><i class="bi bi-lock"></i> Close</button>` : ""}
                                    <button type="button" onclick="duplicateQuiz('${q._id}')"><i class="bi bi-copy"></i> Duplicate</button>
                                    <button type="button" onclick="location.hash='results';setTimeout(()=>filterResultsByQuiz('${q._id}'),0)"><i class="bi bi-clipboard-data"></i> View results</button>
                                    <button type="button" onclick="location.href='leaderboard.html?quiz=${q._id}'"><i class="bi bi-trophy"></i> Leaderboard</button>
                                    <hr>
                                    <button type="button" class="danger" onclick="deleteQuiz('${q._id}')"><i class="bi bi-trash"></i> Delete</button>
                                </div>
                            </div>
                        </div>
                    </td>
                </tr>`).join("")}
            </tbody>
        </table>`;
}

async function setStatus(id, status) {
    try {
        const data = await App.api(`${API}/quiz/${id}/status`, { method: "PATCH", body: { status } });
        App.toast(data.message, "success");
        refreshCounts();
        route();
    } catch (error) {
        App.toast(error.message, "error");
    }
}

async function duplicateQuiz(id) {
    try {
        const data = await App.api(`${API}/quiz/${id}/duplicate`, { method: "POST" });
        App.toast(data.message, "success");
        refreshCounts();
        location.hash = "exam/" + data.quiz._id;
    } catch (error) {
        App.toast(error.message, "error");
    }
}

async function deleteQuiz(id) {
    const q = quizCache.find(x => x._id === id) || quizCtx || {};
    const ok = await App.confirm({
        title: `Delete "${q.title || "this examination"}"?`,
        message: `This removes the examination, its ${q.questionCount ?? (q.questions || []).length} questions and ${q.attemptCount || "all"} result record(s). It can't be undone.`,
        confirmText: "Delete examination",
        tone: "danger"
    });
    if (!ok) return;
    try {
        await App.api(`${API}/quiz/${id}`, { method: "DELETE" });
        App.toast("Examination deleted", "success");
        refreshCounts();
        if (location.hash.startsWith("#exam/")) location.hash = "exams"; else route();
    } catch (error) {
        App.toast(error.message, "error");
    }
}


/* =========================================================
   QUIZ EDITOR (create + edit, including the timer)
========================================================= */

const DEFAULT_INSTRUCTIONS = [
    "Read every question carefully before answering.",
    "Each question has one correct answer.",
    "Use Save & Next to move on, or jump to any question from the palette.",
    "Mark a question for review if you want to come back to it.",
    "The examination submits automatically when the timer reaches zero."
].join("\n");

async function openQuizEditor(id) {
    editingQuizId = id || null;
    $("quizFormError").innerHTML = "";
    $("quizForm").reset();

    let q = null;
    if (id) {
        try { q = (await App.api(`${API}/quiz/${id}`)).quiz; }
        catch (error) { return App.toast(error.message, "error"); }
    }

    try { if (!quizCache.length) await loadQuizCache(); } catch (e) { /* datalist is optional */ }
    $("categoryList").innerHTML = [...new Set(quizCache.map(x => x.category).filter(Boolean))].map(c => `<option value="${esc(c)}">`).join("");

    $("quizModalTitle").textContent = q ? "Edit examination" : "New examination";
    $("quizModalSub").textContent = q
        ? "Changes apply to attempts started from now on. Running attempts keep their original deadline."
        : "Set it up, then add questions. It stays a draft until you publish.";
    $("quizSave").innerHTML = `<i class="bi bi-check2 btn__icon"></i> ${q ? "Save changes" : "Create examination"}`;

    $("fTitle").value = q ? q.title : "";
    $("fDesc").value = q ? q.description : "";
    $("fCategory").value = q ? q.category : "";
    setDifficulty(q ? q.difficulty : "Medium");
    $("fDuration").value = q ? q.duration : 30;
    $("fPassing").value = q ? q.passingMarks : 0;
    $("fAttempts").value = q ? q.attemptLimit || 0 : 0;
    $("fNegative").checked = q ? q.negativeMarking : false;
    $("fRandQ").checked = q ? q.randomizeQuestions : false;
    $("fRandO").checked = q ? q.randomizeOptions : false;
    $("fStart").value = q ? toLocalInput(q.startAt) : "";
    $("fEnd").value = q ? toLocalInput(q.endAt) : "";
    $("fInstructions").value = q ? (q.instructions || []).join("\n") : DEFAULT_INSTRUCTIONS;
    syncPresets();

    App.openModal("quizModal");
}

function setDifficulty(v) {
    document.querySelectorAll("#fDifficulty button").forEach(b => b.classList.toggle("is-active", b.dataset.v === v));
}
$("fDifficulty").addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (b) setDifficulty(b.dataset.v); });

function syncPresets() {
    const v = Number($("fDuration").value);
    document.querySelectorAll("#durationPresets .chip").forEach(c => c.classList.toggle("is-active", Number(c.dataset.min) === v));
}
$("durationPresets").addEventListener("click", (e) => {
    const c = e.target.closest("[data-min]");
    if (!c) return;
    $("fDuration").value = c.dataset.min;
    syncPresets();
});
$("fDuration").addEventListener("input", syncPresets);

$("quizForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = (m) => { $("quizFormError").innerHTML = `<div class="alert alert--error shake"><i class="bi bi-exclamation-circle"></i><div>${esc(m)}</div></div>`; $("quizModal").querySelector(".modal__box").scrollTop = 0; };

    const title = $("fTitle").value.trim();
    const duration = Number($("fDuration").value);
    if (!title) return err("Give the examination a title.");
    if (!Number.isFinite(duration) || duration < 1 || duration > 600) return err("Duration must be between 1 and 600 minutes.");
    if ($("fStart").value && $("fEnd").value && new Date($("fEnd").value) <= new Date($("fStart").value)) return err("The closing time must be after the opening time.");

    const body = {
        title,
        description: $("fDesc").value.trim(),
        category: $("fCategory").value.trim() || "General",
        difficulty: document.querySelector("#fDifficulty .is-active").dataset.v,
        duration,
        passingMarks: Number($("fPassing").value) || 0,
        attemptLimit: Number($("fAttempts").value) || 0,
        negativeMarking: $("fNegative").checked,
        randomizeQuestions: $("fRandQ").checked,
        randomizeOptions: $("fRandO").checked,
        startAt: $("fStart").value ? new Date($("fStart").value).toISOString() : null,
        endAt: $("fEnd").value ? new Date($("fEnd").value).toISOString() : null,
        instructions: $("fInstructions").value.split("\n").map(s => s.trim()).filter(Boolean)
    };

    App.busy($("quizSave"), true, "Saving");
    try {
        const data = editingQuizId
            ? await App.api(`${API}/quiz/${editingQuizId}`, { method: "PUT", body })
            : await App.api(`${API}/create-quiz`, { method: "POST", body });
        App.closeModal("quizModal");
        App.toast(editingQuizId ? "Examination updated" : "Examination created. Now add some questions.", "success");
        refreshCounts();
        if (!editingQuizId) location.hash = "exam/" + data.quiz._id;
        else route();
    } catch (error) {
        err(error.message);
    } finally {
        App.busy($("quizSave"), false);
    }
});


/* =========================================================
   QUESTION MANAGER (one examination)
========================================================= */

async function renderExamDetail(id, token) {
    try {
        const { quiz } = await App.api(`${API}/quiz/${encodeURIComponent(id)}`);
        if (stale(token)) return;
        quizCtx = quiz;
        $("pageTitle").textContent = quiz.title;
        $("pageSubtitle").textContent = "Questions and settings";
        document.title = quiz.title + " | Admin | Quiz App";
        drawExamDetail();
    } catch (error) {
        if (!stale(token)) view.innerHTML = emptyBox("bi-exclamation-circle", "Couldn't open this examination", error.message, `<a class="btn" href="#exams">Back to examinations</a>`);
    }
}

function drawExamDetail() {
    const q = quizCtx;
    const neg = q.questions.reduce((s, x) => s + (x.negativeMarks || 0), 0);

    view.innerHTML = `
    <div class="aview">
        <a class="btn btn--ghost btn--sm" href="#exams" style="margin-bottom:12px"><i class="bi bi-arrow-left"></i> All examinations</a>

        <section class="panel qm-head">
            <div style="min-width:0;flex:1">
                <div class="faint" style="font-weight:700;font-size:.84rem">${esc(q.category)}</div>
                <h2>${esc(q.title)}</h2>
                <div class="qm-meta">
                    ${statusBadge(q.status)} ${diffBadge(q.difficulty)}
                    <span class="badge badge--amber"><i class="bi bi-stopwatch"></i> ${q.duration} min</span>
                    <span class="badge">${q.questions.length} questions</span>
                    <span class="badge">${App.marks(q.totalMarks)} marks, pass ${App.marks(q.passingMarks)}</span>
                    ${q.negativeMarking ? `<span class="badge badge--red">Negative marking on</span>` : `<span class="badge">No negative marking</span>`}
                    ${q.randomizeQuestions ? `<span class="badge badge--violet">Shuffled questions</span>` : ""}
                    ${q.randomizeOptions ? `<span class="badge badge--violet">Shuffled options</span>` : ""}
                    ${q.attemptLimit ? `<span class="badge">${q.attemptLimit} attempt${q.attemptLimit === 1 ? "" : "s"} max</span>` : ""}
                </div>
                ${q.negativeMarking && neg === 0 && q.questions.length ? `<div class="alert alert--warn" style="margin:14px 0 0"><i class="bi bi-exclamation-triangle"></i><div>Negative marking is on, but no question has negative marks set yet.</div></div>` : ""}
            </div>
            <div class="chip-row">
                <button class="btn" onclick="openQuizEditor('${q._id}')"><i class="bi bi-gear"></i> Settings &amp; timer</button>
                <button class="btn" onclick="previewQuiz('${q._id}')" ${q.questions.length ? "" : "disabled"}><i class="bi bi-eye"></i> Preview</button>
                ${q.status === "published"
                    ? `<button class="btn" onclick="setStatus('${q._id}','draft')"><i class="bi bi-pause-circle"></i> Unpublish</button>`
                    : `<button class="btn btn--success" onclick="setStatus('${q._id}','published')" ${q.questions.length ? "" : 'disabled title="Add a question first"'}><i class="bi bi-broadcast"></i> Publish</button>`}
            </div>
        </section>

        <div class="atoolbar">
            <h3 style="margin-right:auto">Questions</h3>
            <button class="btn btn--primary" onclick="openQuestionEditor('${q._id}')"><i class="bi bi-plus-lg"></i> Add question</button>
        </div>

        <div class="qlist">
            ${q.questions.length ? q.questions.map((x, i) => questionCard(x, i, q)).join("")
                : emptyBox("bi-question-square", "No questions yet", "Add at least one question before publishing.", `<button class="btn btn--primary" onclick="openQuestionEditor('${q._id}')">Add the first question</button>`)}
        </div>
    </div>`;
}

function questionCard(x, i, q) {
    return `
        <article class="qitem">
            <div class="qitem__head">
                <div class="qitem__n">Question ${i + 1}${x.topic ? " | " + esc(x.topic) : ""}</div>
                <div class="actions">
                    <button class="btn btn--sm" onclick="openQuestionEditor('${q._id}','${x._id}')"><i class="bi bi-pencil"></i> Edit</button>
                    <button class="btn btn--sm btn--danger btn--icon" onclick="deleteQuestion('${q._id}','${x._id}')" aria-label="Delete question ${i + 1}"><i class="bi bi-trash"></i></button>
                </div>
            </div>
            <div class="qitem__q">${esc(x.question)}</div>
            <div class="qitem__opts">
                ${x.options.map((o, k) => `<div class="qitem__opt ${o === x.correct ? "is-correct" : ""}"><span class="bubble"><span>${"ABCD"[k]}</span></span>${esc(o)}</div>`).join("")}
            </div>
            <div class="qitem__foot">
                ${diffBadge(x.difficulty)}
                <span class="badge badge--green">+${App.marks(x.marks)}</span>
                ${x.negativeMarks ? `<span class="badge badge--red">&minus;${App.marks(x.negativeMarks)}${q.negativeMarking ? "" : " (off)"}</span>` : ""}
                ${x.explanation ? `<span class="badge badge--blue" title="${esc(x.explanation)}"><i class="bi bi-info-circle"></i> Has explanation</span>` : ""}
            </div>
        </article>`;
}

async function deleteQuestion(quizId, questionId) {
    const ok = await App.confirm({ title: "Delete this question?", message: "Past results keep their own copy, so they won't change.", confirmText: "Delete question", tone: "danger" });
    if (!ok) return;
    try {
        const data = await App.api(`${API}/quiz/${quizId}/question/${questionId}`, { method: "DELETE" });
        App.toast("Question deleted", "success");
        refreshCounts();
        if (location.hash.startsWith("#exam/")) { quizCtx = data.quiz; drawExamDetail(); }
        else route();
    } catch (error) {
        App.toast(error.message, "error");
    }
}


/* =========================================================
   QUESTION EDITOR (add + edit)
========================================================= */

function buildOptionRows(options = ["", "", "", ""], correctIndex = -1) {
    $("optEdit").innerHTML = options.map((o, k) => `
        <div class="opt-row">
            <label title="Mark ${"ABCD"[k]} as the correct answer">
                <input type="radio" name="correctOpt" value="${k}" ${k === correctIndex ? "checked" : ""} aria-label="Option ${"ABCD"[k]} is correct">
                <span class="bubble"><span>${"ABCD"[k]}</span></span>
            </label>
            <input class="input" data-opt="${k}" maxlength="500" placeholder="Option ${"ABCD"[k]}" value="${esc(o)}">
        </div>`).join("");
}

async function openQuestionEditor(quizId, questionId) {
    $("questionFormError").innerHTML = "";
    let quiz = quizCtx && quizCtx._id === quizId ? quizCtx : null;
    if (!quiz) {
        try { quiz = (await App.api(`${API}/quiz/${quizId}`)).quiz; }
        catch (error) { return App.toast(error.message, "error"); }
    }
    const x = questionId ? quiz.questions.find(q => q._id === questionId) : null;
    questionCtx = { quizId, questionId: x ? x._id : null, quizTitle: quiz.title };

    $("questionModalTitle").textContent = x ? "Edit question" : "Add question";
    $("questionModalSub").textContent = quiz.title;
    $("qText").value = x ? x.question : "";
    buildOptionRows(x ? x.options : undefined, x ? x.options.indexOf(x.correct) : -1);
    const last = quiz.questions[quiz.questions.length - 1];
    $("qMarksIn").value = x ? x.marks : (last ? last.marks : 1);
    $("qNeg").value = x ? x.negativeMarks : (last ? last.negativeMarks : 0);
    $("qDifficulty").value = x ? x.difficulty : "Medium";
    $("qTopic").value = x ? x.topic || "" : (last ? last.topic || "" : "");
    $("qExplain").value = x ? x.explanation || "" : "";
    $("qNegHint").textContent = quiz.negativeMarking ? "" : "Negative marking is off for this examination, so this won't apply until you turn it on.";
    $("questionSaveAnother").classList.toggle("hidden", Boolean(x));
    App.openModal("questionModal");
}

async function saveQuestion(another) {
    const err = (m) => { $("questionFormError").innerHTML = `<div class="alert alert--error shake"><i class="bi bi-exclamation-circle"></i><div>${esc(m)}</div></div>`; };
    const question = $("qText").value.trim();
    const options = [...document.querySelectorAll("#optEdit [data-opt]")].map(i => i.value.trim());
    const picked = document.querySelector('input[name="correctOpt"]:checked');

    if (!question) return err("Type the question.");
    if (options.some(o => !o)) return err("All four options need text.");
    if (new Set(options.map(o => o.toLowerCase())).size !== 4) return err("Each option must be different.");
    if (!picked) return err("Click the letter next to the correct option.");

    const body = {
        question,
        options,
        correctIndex: Number(picked.value),
        marks: Number($("qMarksIn").value) || 0,
        negativeMarks: Number($("qNeg").value) || 0,
        difficulty: $("qDifficulty").value,
        topic: $("qTopic").value.trim(),
        explanation: $("qExplain").value.trim()
    };

    const btn = another ? $("questionSaveAnother") : $("questionSave");
    App.busy(btn, true, "Saving");
    try {
        const { quizId, questionId } = questionCtx;
        const data = questionId
            ? await App.api(`${API}/quiz/${quizId}/question/${questionId}`, { method: "PUT", body })
            : await App.api(`${API}/add-question/${quizId}`, { method: "POST", body });

        App.toast(questionId ? "Question updated" : "Question added", "success");
        refreshCounts();
        if (location.hash === "#exam/" + quizId) { quizCtx = data.quiz; drawExamDetail(); }
        else if (location.hash === "#bank") drawBank();

        if (another) {
            $("qText").value = "";
            $("qExplain").value = "";
            buildOptionRows();
            $("questionFormError").innerHTML = "";
            $("qText").focus();
        } else {
            App.closeModal("questionModal");
        }
    } catch (error) {
        err(error.message);
    } finally {
        App.busy(btn, false);
    }
}

$("questionForm").addEventListener("submit", (e) => { e.preventDefault(); saveQuestion(false); });
$("questionSaveAnother").addEventListener("click", () => saveQuestion(true));


/* =========================================================
   PREVIEW
========================================================= */

async function previewQuiz(id) {
    try {
        const { quiz } = await App.api(`${API}/quiz/${id}`);
        $("previewTitle").textContent = quiz.title;
        $("previewSub").textContent = `${quiz.questions.length} questions | ${quiz.duration} min | ${App.marks(quiz.totalMarks)} marks`;
        $("previewAnswers").checked = false;
        $("previewBody").innerHTML = quiz.questions.length ? quiz.questions.map((x, i) => `
            <div class="preview-q">
                <div class="faint" style="font-weight:700;font-size:.82rem;margin-bottom:6px">Question ${i + 1} | +${App.marks(x.marks)}${quiz.negativeMarking && x.negativeMarks ? " | &minus;" + App.marks(x.negativeMarks) : ""}</div>
                <div style="font-weight:700;margin-bottom:12px;white-space:pre-wrap">${esc(x.question)}</div>
                <div class="xopts" style="display:grid;gap:8px">
                    ${x.options.map((o, k) => `<div class="xopt" data-correct="${o === x.correct}" style="display:flex;align-items:center;gap:12px;padding:10px 14px;border-radius:12px;border:1.5px solid var(--line-strong);background:var(--surface-sunk)"><span class="bubble" style="--size:28px"><span>${"ABCD"[k]}</span></span>${esc(o)}</div>`).join("")}
                </div>
            </div>`).join("") : `<div class="empty"><strong>No questions to preview</strong></div>`;
        $("previewFoot").innerHTML = `
            <button class="btn" data-close-modal>Close</button>
            ${quiz.status !== "published" && quiz.questions.length ? `<button class="btn btn--success" onclick="App.closeModal('previewModal');setStatus('${quiz._id}','published')"><i class="bi bi-broadcast"></i> Publish</button>` : ""}`;
        App.openModal("previewModal");
    } catch (error) {
        App.toast(error.message, "error");
    }
}

$("previewAnswers").addEventListener("change", (e) => {
    document.querySelectorAll('#previewBody [data-correct="true"]').forEach(el => el.classList.toggle("is-answer", e.target.checked));
});


/* =========================================================
   QUESTION BANK
========================================================= */

let bankFilter = { search: "", category: "", difficulty: "", quizId: "" };
let bankData = null;

async function renderBank(_, token) {
    try {
        await loadQuizCache();
        if (stale(token)) return;
        view.innerHTML = `
        <div class="aview">
            <div class="atoolbar">
                <div class="input-wrap"><i class="bi bi-search"></i><input class="input" id="bkSearch" type="search" placeholder="Search question, option or topic" value="${esc(bankFilter.search)}" aria-label="Search questions"></div>
                <select class="input" id="bkCategory" aria-label="Filter by subject"><option value="">Any subject</option></select>
                <select class="input" id="bkDifficulty" aria-label="Filter by difficulty">
                    <option value="">Any difficulty</option>
                    ${["Easy", "Medium", "Hard"].map(d => `<option ${bankFilter.difficulty === d ? "selected" : ""}>${d}</option>`).join("")}
                </select>
                <select class="input" id="bkQuiz" aria-label="Filter by examination">${quizOptions(bankFilter.quizId)}</select>
            </div>
            <div id="bankList"></div>
        </div>`;
        $("bkSearch").addEventListener("input", debounce(e => { bankFilter.search = e.target.value; drawBank(); }, 250));
        $("bkCategory").addEventListener("change", e => { bankFilter.category = e.target.value; drawBank(); });
        $("bkDifficulty").addEventListener("change", e => { bankFilter.difficulty = e.target.value; drawBank(); });
        $("bkQuiz").addEventListener("change", e => { bankFilter.quizId = e.target.value; drawBank(); });
        drawBank();
    } catch (error) {
        if (!stale(token)) view.innerHTML = emptyBox("bi-exclamation-circle", "Couldn't load the question bank", error.message);
    }
}

async function drawBank() {
    const host = $("bankList");
    if (!host) return;
    host.innerHTML = `<div class="skeleton" style="height:200px"></div>`;
    try {
        const qs = new URLSearchParams(Object.entries(bankFilter).filter(([, v]) => v)).toString();
        bankData = await App.api(`${API}/questions?${qs}`);
        const cat = $("bkCategory");
        if (cat && cat.options.length === 1) cat.innerHTML += bankData.categories.map(c => `<option ${bankFilter.category === c ? "selected" : ""}>${esc(c)}</option>`).join("");

        if (!bankData.questions.length) {
            host.innerHTML = emptyBox("bi-collection", "No questions found", quizCache.length ? "Try other filters, or add questions from an examination." : "Create an examination first, then add questions to it.");
            return;
        }
        host.innerHTML = `
            <p class="faint" style="margin-bottom:10px;font-size:.88rem">${bankData.total} question${bankData.total === 1 ? "" : "s"}${bankData.total > bankData.questions.length ? `, showing the first ${bankData.questions.length}` : ""}</p>
            <div class="qlist">
            ${bankData.questions.map(x => `
                <article class="qitem">
                    <div class="qitem__head">
                        <div class="qitem__n"><a href="#exam/${x.quizId}" style="text-decoration:none">${esc(x.quizTitle)}</a> | ${esc(x.category)}${x.topic ? " | " + esc(x.topic) : ""}</div>
                        <div class="actions">
                            <button class="btn btn--sm" onclick="openQuestionEditor('${x.quizId}','${x._id}')"><i class="bi bi-pencil"></i> Edit</button>
                            <button class="btn btn--sm btn--danger btn--icon" onclick="deleteQuestion('${x.quizId}','${x._id}')" aria-label="Delete question"><i class="bi bi-trash"></i></button>
                        </div>
                    </div>
                    <div class="qitem__q">${esc(x.question)}</div>
                    <div class="qitem__opts">${x.options.map((o, k) => `<div class="qitem__opt ${o === x.correct ? "is-correct" : ""}"><span class="bubble"><span>${"ABCD"[k]}</span></span>${esc(o)}</div>`).join("")}</div>
                    <div class="qitem__foot">${diffBadge(x.difficulty)} <span class="badge badge--green">+${App.marks(x.marks)}</span>${x.negativeMarks ? ` <span class="badge badge--red">&minus;${App.marks(x.negativeMarks)}</span>` : ""} ${statusBadge(x.quizStatus)}</div>
                </article>`).join("")}
            </div>`;
    } catch (error) {
        host.innerHTML = emptyBox("bi-exclamation-circle", "Couldn't search questions", error.message);
    }
}


/* =========================================================
   CANDIDATES
========================================================= */

let usersData = [];
let userSearch = "";

async function renderUsers(_, token) {
    try {
        const { users } = await App.api(`${API}/users`);
        if (stale(token)) return;
        usersData = users;
        view.innerHTML = `
        <div class="aview">
            <div class="atoolbar">
                <div class="input-wrap"><i class="bi bi-search"></i><input class="input" id="usSearch" type="search" placeholder="Search by name or email" value="${esc(userSearch)}" aria-label="Search candidates"></div>
                <div class="atoolbar__end faint" style="font-size:.88rem">${users.filter(u => u.role === "user").length} candidates, ${users.filter(u => u.role === "admin").length} admin${users.filter(u => u.role === "admin").length === 1 ? "" : "s"}</div>
            </div>
            <div class="panel" style="padding:6px 8px"><div class="table-wrap" id="userTable"></div></div>
        </div>`;
        $("usSearch").addEventListener("input", debounce(e => { userSearch = e.target.value; drawUsers(); }, 120));
        drawUsers();
    } catch (error) {
        if (!stale(token)) view.innerHTML = emptyBox("bi-exclamation-circle", "Couldn't load candidates", error.message);
    }
}

function drawUsers() {
    const term = userSearch.trim().toLowerCase();
    const list = usersData.filter(u => !term || u.name.toLowerCase().includes(term) || u.email.toLowerCase().includes(term));
    if (!list.length) {
        $("userTable").innerHTML = `<div class="empty"><i class="bi bi-people"></i><strong>${usersData.length ? "No one matches that search" : "No one has registered yet"}</strong></div>`;
        return;
    }
    $("userTable").innerHTML = `
        <table class="table">
            <thead><tr><th>Name</th><th class="hide-sm">Joined</th><th class="hide-sm">Last login</th><th class="t-right">Attempts</th><th class="t-right">Average</th><th class="t-right hide-sm">Best</th><th>Account</th><th></th></tr></thead>
            <tbody>
            ${list.map(u => `
                <tr>
                    <td><div class="who">${App.avatar(u)}<div class="qcell" style="min-width:0"><strong>${esc(u.name)} ${u.role === "admin" ? '<span class="badge badge--violet">Admin</span>' : ""}</strong><span>${esc(u.email)}</span></div></div></td>
                    <td class="hide-sm">${esc(App.date(u.createdAt, false))}</td>
                    <td class="hide-sm">${esc(App.relative(u.lastLogin))}</td>
                    <td class="t-right num">${u.attempts}</td>
                    <td class="t-right num">${u.attempts ? App.pct(u.averagePercentage) : "-"}</td>
                    <td class="t-right num hide-sm">${u.attempts ? App.pct(u.bestPercentage) : "-"}</td>
                    <td>${u.role === "admin" ? '<span class="faint" style="font-size:.84rem">Always on</span>' : `
                        <label class="switch" style="padding:0" title="${u.isActive ? "Disable" : "Enable"} this account">
                            <input type="checkbox" ${u.isActive ? "checked" : ""} onchange="toggleUser('${u._id}', this)" aria-label="Account enabled for ${esc(u.name)}">
                            <span class="switch__track"></span><span class="switch__text"><span>${u.isActive ? "Enabled" : "Disabled"}</span></span>
                        </label>`}</td>
                    <td class="t-right"><button class="btn btn--sm" onclick="openUser('${u._id}')">View</button></td>
                </tr>`).join("")}
            </tbody>
        </table>`;
}

async function toggleUser(id, input) {
    const enable = input.checked;
    const u = usersData.find(x => x._id === id);
    if (!enable) {
        const ok = await App.confirm({ title: `Disable ${u ? u.name : "this account"}?`, message: "They'll be logged out right away and hidden from leaderboards. Their results are kept.", confirmText: "Disable account", tone: "danger" });
        if (!ok) { input.checked = true; return; }
    }
    try {
        const data = await App.api(`${API}/users/${id}/status`, { method: "PATCH", body: { isActive: enable } });
        if (u) u.isActive = enable;
        App.toast(data.message, "success");
        drawUsers();
    } catch (error) {
        input.checked = !enable;
        App.toast(error.message, "error");
    }
}

async function openUser(id) {
    try {
        const { user, attempts } = await App.api(`${API}/users/${id}`);
        const done = attempts.filter(a => a.status === "submitted");
        $("userTitle").textContent = user.name;
        $("userSub").textContent = `${user.email} | joined ${App.date(user.createdAt, false)} | ${user.isActive ? "enabled" : "disabled"}`;
        $("userBody").innerHTML = `
            <div class="tiles tiles--3" style="margin-bottom:16px">
                ${tile("bi-journal-check", "", "Attempts", done.length, attempts.length > done.length ? `${attempts.length - done.length} in progress` : "Submitted")}
                ${tile("bi-bar-chart", "violet", "Average", done.length ? App.pct(done.reduce((s, a) => s + a.percentage, 0) / done.length) : "-", "Percentage")}
                ${tile("bi-award", "amber", "Best", done.length ? App.pct(Math.max(...done.map(a => a.percentage))) : "-", "Percentage")}
            </div>
            ${attempts.length ? `<div class="table-wrap"><table class="table">
                <thead><tr><th>Examination</th><th class="t-right">Score</th><th class="t-right">%</th><th class="hide-sm">C / I / U</th><th class="t-right hide-sm">Time</th><th>Date</th><th></th></tr></thead>
                <tbody>${attempts.map(a => `<tr>
                    <td class="qcell"><strong>${esc(a.quizTitle)}</strong>${a.status === "in_progress" ? '<span class="badge badge--amber">In progress</span>' : ""}</td>
                    <td class="t-right num">${a.status === "submitted" ? `${App.marks(a.score)} / ${App.marks(a.totalMarks)}` : "-"}</td>
                    <td class="t-right num t-strong">${a.status === "submitted" ? App.pct(a.percentage) : "-"}</td>
                    <td class="hide-sm num">${a.status === "submitted" ? `${a.correctAnswers} / ${a.incorrectAnswers} / ${a.unanswered}` : ""}</td>
                    <td class="t-right hide-sm num">${a.status === "submitted" ? App.duration(a.timeTaken) : ""}</td>
                    <td style="font-size:.84rem">${esc(App.date(a.submittedAt || a.startedAt))}</td>
                    <td class="t-right">${a.status === "submitted" ? `<a class="btn btn--sm" href="result.html?attempt=${a._id}" target="_blank" rel="noopener">Open</a>` : ""}</td>
                </tr>`).join("")}</tbody></table></div>` : `<div class="empty"><i class="bi bi-inbox"></i><strong>No attempts yet</strong></div>`}`;
        App.openModal("userModal");
    } catch (error) {
        App.toast(error.message, "error");
    }
}


/* =========================================================
   RESULTS
========================================================= */

let resultFilter = { search: "", quizId: "", result: "" };

function filterResultsByQuiz(id) {
    resultFilter.quizId = id;
    if ($("rsQuiz")) { $("rsQuiz").value = id; drawResults(); }
}

async function renderResults(_, token) {
    try {
        await loadQuizCache();
        if (stale(token)) return;
        view.innerHTML = `
        <div class="aview">
            <div class="atoolbar">
                <div class="input-wrap"><i class="bi bi-search"></i><input class="input" id="rsSearch" type="search" placeholder="Search candidate or examination" value="${esc(resultFilter.search)}" aria-label="Search results"></div>
                <select class="input" id="rsQuiz" aria-label="Filter by examination">${quizOptions(resultFilter.quizId)}</select>
                <select class="input" id="rsResult" aria-label="Filter by outcome">
                    <option value="">Pass and fail</option>
                    <option value="passed" ${resultFilter.result === "passed" ? "selected" : ""}>Passed only</option>
                    <option value="failed" ${resultFilter.result === "failed" ? "selected" : ""}>Failed only</option>
                </select>
                <div class="atoolbar__end"><button class="btn" onclick="exportResults()"><i class="bi bi-download"></i> Export CSV</button></div>
            </div>
            <div class="panel" style="padding:6px 8px"><div class="table-wrap" id="resultTable"></div></div>
        </div>`;
        $("rsSearch").addEventListener("input", debounce(e => { resultFilter.search = e.target.value; drawResults(); }, 300));
        $("rsQuiz").addEventListener("change", e => { resultFilter.quizId = e.target.value; drawResults(); });
        $("rsResult").addEventListener("change", e => { resultFilter.result = e.target.value; drawResults(); });
        drawResults();
    } catch (error) {
        if (!stale(token)) view.innerHTML = emptyBox("bi-exclamation-circle", "Couldn't load results", error.message);
    }
}

async function drawResults() {
    const host = $("resultTable");
    if (!host) return;
    host.innerHTML = `<div class="skeleton" style="height:160px;margin:8px"></div>`;
    try {
        const qs = new URLSearchParams(Object.entries(resultFilter).filter(([, v]) => v)).toString();
        const { results, total } = await App.api(`${API}/results?${qs}`);
        if (!results.length) {
            host.innerHTML = `<div class="empty"><i class="bi bi-clipboard"></i><strong>No results</strong>Nothing matches these filters yet.</div>`;
            return;
        }
        host.innerHTML = `
            <table class="table">
                <thead><tr><th>Candidate</th><th class="hide-sm">Examination</th><th class="t-right">Score</th><th class="t-right">%</th><th class="hide-sm">Correct / Incorrect / Unanswered</th><th class="t-right hide-sm">Time</th><th class="hide-sm">Submitted</th><th></th></tr></thead>
                <tbody>
                ${results.map(r => `
                    <tr>
                        <td class="qcell"><strong>${esc(r.userName)}</strong><span>${esc(r.userEmail)}</span></td>
                        <td class="hide-sm">${esc(r.quizTitle)}</td>
                        <td class="t-right num">${App.marks(r.score)} / ${App.marks(r.totalMarks)}</td>
                        <td class="t-right num"><span class="badge ${r.passed ? "badge--green" : "badge--red"}">${App.pct(r.percentage)}</span></td>
                        <td class="hide-sm num"><span style="color:var(--green);font-weight:700">${r.correctAnswers}</span> / <span style="color:var(--red);font-weight:700">${r.incorrectAnswers}</span> / <span class="faint">${r.unanswered}</span></td>
                        <td class="t-right hide-sm num">${App.duration(r.timeTaken)}${r.submittedAutomatically ? ' <span class="badge badge--amber" title="Submitted when time ran out">Auto</span>' : ""}</td>
                        <td class="hide-sm" style="font-size:.84rem">${esc(App.date(r.submittedAt))}</td>
                        <td><div class="actions">
                            <a class="btn btn--sm" href="result.html?attempt=${r._id}" target="_blank" rel="noopener">Open</a>
                            <button class="btn btn--sm btn--danger btn--icon" onclick="deleteResult('${r._id}','${esc(r.userName).replace(/'/g, "&#39;")}')" aria-label="Delete result"><i class="bi bi-trash"></i></button>
                        </div></td>
                    </tr>`).join("")}
                </tbody>
            </table>
            <p class="faint" style="padding:10px 14px;font-size:.84rem">${total} result${total === 1 ? "" : "s"}</p>`;
    } catch (error) {
        host.innerHTML = `<div class="empty"><strong>${esc(error.message)}</strong></div>`;
    }
}

async function deleteResult(id, name) {
    const ok = await App.confirm({ title: "Delete this result?", message: `${name}'s attempt will be removed from results and the leaderboard. If the examination has an attempt limit, they get that attempt back.`, confirmText: "Delete result", tone: "danger" });
    if (!ok) return;
    try {
        await App.api(`${API}/results/${id}`, { method: "DELETE" });
        App.toast("Result deleted", "success");
        drawResults();
    } catch (error) {
        App.toast(error.message, "error");
    }
}

async function exportResults() {
    try {
        const qs = new URLSearchParams(Object.entries(resultFilter).filter(([, v]) => v)).toString();
        const res = await fetch(`${API}/results/export?${qs}`, { headers: { Authorization: "Bearer " + App.Session.token() } });
        if (!res.ok) throw new Error("Export failed. Please try again.");
        const blob = await res.blob();
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `quiz-results-${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
        App.toast("CSV downloaded", "success");
    } catch (error) {
        App.toast(error.message, "error");
    }
}


/* =========================================================
   ANALYTICS
========================================================= */

async function renderAnalytics(_, token) {
    try {
        const data = await App.api(API + "/analytics");
        if (stale(token)) return;
        const perf = data.quizPerformance;
        const withAttempts = perf.filter(p => p.attempts);

        view.innerHTML = `
        <div class="aview">
            <section class="panel panel--pad" style="margin-bottom:18px">
                <div class="panel__head"><div><h3>Examination performance</h3><p>Average score, pass rate and time for each examination</p></div></div>
                ${perf.length ? `<div class="table-wrap"><table class="table">
                    <thead><tr><th>Examination</th><th class="t-right">Attempts</th><th class="t-right hide-sm">Candidates</th><th>Average score</th><th class="t-right">Pass rate</th><th class="t-right hide-sm">Avg time</th></tr></thead>
                    <tbody>${perf.map(p => `<tr>
                        <td class="qcell"><strong>${esc(p.title)}</strong><span>${esc(p.category)} | ${p.questions} questions | ${p.status}</span></td>
                        <td class="t-right num">${p.attempts}</td>
                        <td class="t-right num hide-sm">${p.candidates}</td>
                        <td style="min-width:160px"><div style="display:flex;gap:10px;align-items:center"><div class="meter" style="flex:1"><span data-w="${p.averagePercentage}"></span></div><b class="num" style="width:52px;text-align:right">${p.attempts ? App.pct(p.averagePercentage) : "-"}</b></div></td>
                        <td class="t-right num">${p.attempts ? App.pct(p.passRate) : "-"}</td>
                        <td class="t-right num hide-sm">${p.attempts ? App.duration(p.averageTime) : "-"}</td>
                    </tr>`).join("")}</tbody></table></div>` : `<div class="empty"><strong>No examinations yet</strong></div>`}
            </section>

            <section class="panel panel--pad">
                <div class="panel__head">
                    <div><h3>Question analytics</h3><p>Which questions candidates get right, sorted hardest first</p></div>
                    <select class="input" id="anQuiz" style="width:auto;min-width:220px" aria-label="Choose examination">
                        ${withAttempts.length ? withAttempts.map(p => `<option value="${p.quizId}">${esc(p.title)}</option>`).join("") : `<option value="">No attempts yet</option>`}
                    </select>
                </div>
                <div id="anQuestions">${withAttempts.length ? "" : `<div class="empty"><i class="bi bi-graph-up"></i><strong>Nothing to analyse yet</strong>Question accuracy appears once candidates submit.</div>`}</div>
            </section>
        </div>`;

        requestAnimationFrame(() => requestAnimationFrame(() => view.querySelectorAll("[data-w]").forEach(el => el.style.width = el.dataset.w + "%")));
        if (withAttempts.length) {
            $("anQuiz").addEventListener("change", e => drawQuestionAnalytics(e.target.value));
            drawQuestionAnalytics(withAttempts[0].quizId);
        }
    } catch (error) {
        if (!stale(token)) view.innerHTML = emptyBox("bi-exclamation-circle", "Couldn't load analytics", error.message);
    }
}

async function drawQuestionAnalytics(id) {
    const host = $("anQuestions");
    host.innerHTML = `<div class="skeleton" style="height:160px"></div>`;
    try {
        const data = await App.api(`${API}/analytics/quiz/${id}`);
        const qs = [...data.questions].sort((a, b) => (a.accuracy ?? 101) - (b.accuracy ?? 101));
        host.innerHTML = `<p class="faint" style="font-size:.86rem;margin-bottom:6px">Based on ${data.attempts} submitted attempt${data.attempts === 1 ? "" : "s"}.</p>` + qs.map(q => `
            <div class="accuracy-bar">
                <span class="rank-dot" style="width:28px;height:28px;font-size:.74rem">${q.number}</span>
                <div class="meter ${q.accuracy >= 70 ? "is-good" : q.accuracy !== null && q.accuracy < 40 ? "is-low" : ""}"><span data-w="${q.accuracy || 0}"></span></div>
                <b class="num" style="text-align:right">${q.accuracy === null ? "-" : App.pct(q.accuracy)}</b>
                <span class="accuracy-bar__q" title="${esc(q.question)}">${esc(q.question)} <span class="faint">(${q.correct} right, ${q.incorrect} wrong, ${q.unanswered} skipped)</span></span>
            </div>`).join("");
        requestAnimationFrame(() => requestAnimationFrame(() => host.querySelectorAll("[data-w]").forEach(el => el.style.width = el.dataset.w + "%")));
    } catch (error) {
        host.innerHTML = `<p class="muted">${esc(error.message)}</p>`;
    }
}
