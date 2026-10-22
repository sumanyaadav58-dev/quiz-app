/* =========================================================
   EXAMINATION (CBT)
   quiz.html?id=<quizId>
   1. Instructions screen
   2. Exam screen with server-synced timer, palette, auto-save
   3. Auto-submit at zero, then redirect to the result page

   The countdown shown here is only a display. The deadline lives on
   the server: refreshing resumes the same attempt with the same time
   left, and answers sent after the deadline are rejected.
========================================================= */

const user = App.guard();
const $ = (id) => document.getElementById(id);
const esc = App.esc;
const quizId = App.qs("id");

/* Live proctoring applies to candidates. Admins previewing a paper are not proctored. */
const PROCTORED = user.role !== "admin";

const WARN_AT = 5 * 60;   /* seconds: amber warning */
const DANGER_AT = 60;     /* seconds: red warning */
const LETTERS = ["A", "B", "C", "D", "E", "F"];

const state = {
    attemptId: null,
    quiz: null,
    questions: [],
    answers: new Map(),     /* questionId -> { selected, marked, visited } */
    index: 0,
    expiresAt: 0,
    startedAt: 0,
    offset: 0,              /* serverTime - clientTime (ms) */
    active: false,
    submitting: false,
    warned: { warn: false, danger: false },
    pending: new Map(),     /* questionId -> update not yet saved */
    saveTimer: null,
    saving: false,
    retryDelay: 2000
};

App.scene();

if (!quizId) {
    location.replace(user.role === "admin" ? "admin.html" : "home.html");
}


/* =========================================================
   1. INSTRUCTIONS
========================================================= */

async function loadIntro() {
    try {
        const data = await App.api("/api/quiz/" + encodeURIComponent(quizId));
        const q = data.quiz;

        document.title = q.title + " | Quiz App";
        App.nav(user.role === "admin" ? "admin" : "home");

        $("introCat").textContent = q.category || "General";
        $("introTitle").textContent = q.title;
        $("introDesc").textContent = q.description || "";

        const attemptsLeft = q.attemptLimit > 0 ? Math.max(0, q.attemptLimit - data.attemptsUsed) + " of " + q.attemptLimit : "Unlimited";
        const meta = [
            ["Duration", q.duration + " min"],
            ["Questions", q.questionCount],
            ["Total marks", App.marks(q.totalMarks)],
            ["Pass mark", App.marks(q.passingMarks)],
            ["Negative marking", q.negativeMarking ? "Yes" : "No"],
            ["Attempts left", attemptsLeft]
        ];
        $("introMeta").innerHTML = meta.map(([k, v]) => `<div><span>${k}</span><strong>${esc(v)}</strong></div>`).join("");

        const steps = [...(q.instructions || [])];
        steps.push(`You have ${q.duration} minute${q.duration === 1 ? "" : "s"}. The clock keeps running even if you close or refresh the page.`);
        if (q.negativeMarking) steps.push("Wrong answers lose marks. If you're unsure, leave the question unanswered.");
        steps.push("Your answers save automatically after every change.");
        $("introSteps").innerHTML = steps.map(s => `<li>${esc(s)}</li>`).join("");

        if (data.inProgress) {
            $("introAlert").innerHTML = `<div class="alert alert--warn"><i class="bi bi-hourglass-split"></i><div>You already started this examination and the timer is still running. Resume to continue where you left off.</div></div>`;
            $("startBtn").innerHTML = '<i class="bi bi-play-fill btn__icon"></i> Resume examination';
            $("startBtn").classList.replace("btn--primary", "btn--amber");
            $("agree").checked = true;
            $("startBtn").disabled = false;
        } else if (!data.canStart) {
            $("introAlert").innerHTML = `<div class="alert alert--error"><i class="bi bi-lock"></i><div>${esc(data.reason || "This examination isn't available right now.")}</div></div>`;
            $("agree").disabled = true;
            $("startBtn").disabled = true;
        }

        if (PROCTORED) $("proctorNote").classList.remove("hidden");

        $("loading").classList.add("hidden");
        $("introView").classList.remove("hidden");

    } catch (error) {
        $("loading").innerHTML = `<div class="empty"><i class="bi bi-exclamation-circle"></i><strong>${esc(error.message)}</strong><a class="btn" href="home.html">Back to dashboard</a></div>`;
    }
}

$("agree").addEventListener("change", (e) => { $("startBtn").disabled = !e.target.checked; });
$("startBtn").addEventListener("click", startExam);


/* =========================================================
   2. START / RESUME
========================================================= */

async function startExam() {
    const button = $("startBtn");

    /* LIVE PROCTORING: camera + microphone permission comes first.
       If the candidate says no, the exam (and its timer) does not start. */
    if (PROCTORED) {
        App.busy(button, true, "Waiting for camera and microphone");
        try {
            await Proctor.requestMedia();
        } catch (error) {
            App.busy(button, false);
            showMediaError(error);
            return;
        }
    }

    App.busy(button, true, "Preparing your paper");

    try {
        const data = await App.api("/api/attempt/start/" + encodeURIComponent(quizId), { method: "POST" });
        setupExam(data);
        if (PROCTORED) {
            document.body.classList.add("is-proctored");
            Proctor.start(data.attemptId);
        }
    } catch (error) {
        App.busy(button, false);
        if (PROCTORED) Proctor.stop("left");
        if (error.data && error.data.code === "TIME_UP") {
            App.toast(error.message, "warn");
            return location.replace("result.html?attempt=" + error.data.attemptId);
        }
        $("introAlert").innerHTML = `<div class="alert alert--error"><i class="bi bi-exclamation-circle"></i><div>${esc(error.message)}</div></div>`;
    }
}

function showMediaError(error) {
    const help = error.code === "DENIED" ? Proctor.deniedHelpHtml(error.detail) : (error.detail ? `<p style="margin-top:6px">${esc(error.detail)}</p>` : "");
    $("introAlert").innerHTML = `
        <div class="alert alert--error" role="alert">
            <i class="bi bi-camera-video-off"></i>
            <div>
                <strong>${esc(error.message)}</strong>
                <p style="margin-top:4px">This is a proctored examination, so your camera and microphone must both be on before it can start. Your timer has not started.</p>
                ${help}
                <button class="btn btn--sm" type="button" id="mediaRetry" style="margin-top:10px"><i class="bi bi-arrow-clockwise"></i> Try again</button>
            </div>
        </div>`;
    $("mediaRetry").addEventListener("click", startExam);
    $("introAlert").scrollIntoView({ behavior: "smooth", block: "center" });
}

function setupExam(data) {
    state.attemptId = data.attemptId;
    state.quiz = data.quiz;
    state.questions = data.questions;
    state.expiresAt = new Date(data.expiresAt).getTime();
    state.startedAt = new Date(data.startedAt).getTime();
    syncClock(data.serverNow);

    data.answers.forEach(a => state.answers.set(String(a.questionId), { selected: a.selected, marked: a.marked, visited: a.visited }));
    state.questions.forEach(q => { if (!state.answers.has(String(q._id))) state.answers.set(String(q._id), { selected: null, marked: false, visited: false }); });

    /* resume on the first question not yet visited, or the first */
    const firstUnvisited = state.questions.findIndex(q => !state.answers.get(String(q._id)).visited);
    state.index = data.resumed && firstUnvisited > 0 ? firstUnvisited : 0;

    $("xTitle").textContent = state.quiz.title;
    $("xSub").textContent = `${state.quiz.category || "General"}  |  ${state.questions.length} questions  |  ${App.marks(state.quiz.totalMarks)} marks`;
    $("xName").textContent = user.name;
    App.paintAvatar($("xAvatar"), user);
    $("pName").textContent = user.name;
    $("pEmail").textContent = user.email;
    App.paintAvatar($("pAvatar"), user);
    $("totalCount").textContent = state.questions.length;
    document.title = "In progress: " + state.quiz.title;

    $("introView").classList.add("hidden");
    $("loading").classList.add("hidden");
    $("examView").classList.remove("hidden");
    document.getElementById("topnav").innerHTML = "";

    state.active = true;
    if (data.resumed) App.toast("Welcome back. Your answers and remaining time were restored.", "info");

    renderPalette();
    showQuestion(state.index, "jump");
    tick();
    setInterval(tick, 250);
}


/* =========================================================
   TIMER (server-synced)
========================================================= */

function syncClock(serverNow) {
    if (!serverNow) return;
    state.offset = new Date(serverNow).getTime() - Date.now();
}

function remainingSeconds() {
    return Math.max(0, (state.expiresAt - (Date.now() + state.offset)) / 1000);
}

let lastShown = -1;

function tick() {
    if (!state.active) return;

    const left = remainingSeconds();
    const whole = Math.ceil(left);

    if (whole !== lastShown) {
        lastShown = whole;
        $("timerValue").textContent = App.clock(whole);

        const total = Math.max(1, (state.expiresAt - state.startedAt) / 1000);
        $("xtime").firstElementChild.style.width = Math.min(100, (1 - left / total) * 100) + "%";

        const level = whole <= DANGER_AT ? "danger" : whole <= WARN_AT ? "warn" : "";
        $("timer").classList.toggle("is-warn", level === "warn");
        $("timer").classList.toggle("is-danger", level === "danger");
        $("xtime").classList.toggle("is-warn", level === "warn");
        $("xtime").classList.toggle("is-danger", level === "danger");

        if (level === "warn" && !state.warned.warn && whole > DANGER_AT) {
            state.warned.warn = true;
            App.toast("5 minutes left. Check any questions marked for review.", "warn", 6000);
            $("srAnnounce").textContent = "Five minutes remaining";
        }
        if (level === "danger" && !state.warned.danger) {
            state.warned.danger = true;
            App.toast("1 minute left. The examination will submit itself at zero.", "error", 6000);
            $("srAnnounce").textContent = "One minute remaining";
        }
    }

    if (left <= 0) timeUp();
}

function timeUp() {
    if (state.submitting) return;
    state.active = false;
    $("timerValue").textContent = "00:00";
    App.closeModal("submitModal");
    lock("Time's up", "Submitting your answers now. Please wait.");
    submit(true);
}


/* =========================================================
   QUESTION VIEW
========================================================= */

function current() { return state.questions[state.index]; }
function answerOf(q) { return state.answers.get(String(q._id)); }

function statusOf(q) {
    const a = answerOf(q);
    if (!a.visited && !a.selected && !a.marked) return "nv";
    if (a.selected && a.marked) return "am";
    if (a.marked) return "m";
    if (a.selected) return "a";
    return "na";
}

function showQuestion(i, dir = "next") {
    if (i < 0 || i >= state.questions.length) return;
    state.index = i;
    const q = current();
    const a = answerOf(q);

    if (!a.visited) {
        a.visited = true;
        queueSave(q, { visited: true });
    }

    $("qNum").innerHTML = `Question ${i + 1} <span>of ${state.questions.length}</span>`;
    $("qMarks").innerHTML = `<i class="bi bi-plus-circle"></i> ${App.marks(q.marks)}${q.negativeMarks ? ` <span style="opacity:.7">| &minus;${App.marks(q.negativeMarks)}</span>` : ""}`;
    $("qMarks").className = "badge badge--green";
    $("qDiff").textContent = q.difficulty;
    $("qDiff").className = "badge " + ({ Easy: "badge--green", Medium: "badge--amber", Hard: "badge--red" }[q.difficulty] || "");

    const card = $("qCard");
    card.className = "xq__card";
    card.innerHTML = `
        <div class="xq__text" id="qText">${esc(q.question)}</div>
        <div class="xopts" role="radiogroup" aria-labelledby="qText">
            ${q.options.map((opt, k) => `
                <button type="button" class="xopt ${a.selected === opt ? "is-selected" : ""}" role="radio" aria-checked="${a.selected === opt}" data-opt="${k}">
                    <span class="bubble"><span>${LETTERS[k]}</span></span>
                    <span class="xopt__text">${esc(opt)}</span>
                    <span class="xopt__key">${LETTERS[k]}</span>
                </button>`).join("")}
        </div>
        <p class="xq__hint">Press <kbd>A</kbd> to <kbd>D</kbd> to choose, <kbd>&larr;</kbd> <kbd>&rarr;</kbd> to move, <kbd>M</kbd> to mark for review.</p>`;
    void card.offsetWidth;
    card.classList.add("enter-" + dir);

    $("prevBtn").disabled = i === 0;
    $("markBtn").classList.toggle("is-on", a.marked);
    $("clearBtn").disabled = !a.selected;
    const last = i === state.questions.length - 1;
    $("nextBtn").querySelector(".lbl-long").textContent = last ? "Save & submit" : "Save & next";
    $("nextBtn").querySelector(".lbl-short").textContent = last ? "Submit" : "Save & next";
    $("nextBtn").querySelector("i").className = last ? "bi bi-send-check" : "bi bi-chevron-right";

    renderPalette();
}

$("qCard").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-opt]");
    if (btn) choose(Number(btn.dataset.opt));
});

function choose(k) {
    if (!state.active) return;
    const q = current();
    if (k < 0 || k >= q.options.length) return;
    const a = answerOf(q);
    a.selected = q.options[k];
    queueSave(q, { selected: a.selected });

    document.querySelectorAll("#qCard .xopt").forEach((el, n) => {
        el.classList.toggle("is-selected", n === k);
        el.setAttribute("aria-checked", String(n === k));
    });
    $("clearBtn").disabled = false;
    renderPalette(true);
}

function next() {
    if (state.index < state.questions.length - 1) showQuestion(state.index + 1, "next");
    else {
        /* last question: answers are already saved, open the confirmation */
        renderPalette();
        openSubmit();
    }
}

$("nextBtn").addEventListener("click", next);
$("prevBtn").addEventListener("click", () => showQuestion(state.index - 1, "prev"));

$("clearBtn").addEventListener("click", () => {
    const q = current();
    const a = answerOf(q);
    if (!a.selected) return;
    a.selected = null;
    queueSave(q, { selected: null });
    showQuestion(state.index, "jump");
});

$("markBtn").addEventListener("click", () => toggleMark(true));

function toggleMark(advance) {
    const q = current();
    const a = answerOf(q);
    a.marked = !a.marked;
    queueSave(q, { marked: a.marked });
    if (a.marked && advance && state.index < state.questions.length - 1) {
        showQuestion(state.index + 1, "next");
    } else {
        $("markBtn").classList.toggle("is-on", a.marked);
        renderPalette(true);
    }
}

/* keyboard */
document.addEventListener("keydown", (e) => {
    if (!state.active || e.ctrlKey || e.metaKey || e.altKey) return;
    if (document.querySelector(".modal.is-open")) return;
    if (/input|textarea|select/i.test(e.target.tagName)) return;

    const key = e.key.toUpperCase();
    const letter = LETTERS.indexOf(key);
    if (letter > -1 && letter < current().options.length) { e.preventDefault(); choose(letter); }
    else if (/^[1-6]$/.test(e.key)) { e.preventDefault(); choose(Number(e.key) - 1); }
    else if (e.key === "ArrowRight") { e.preventDefault(); next(); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); showQuestion(state.index - 1, "prev"); }
    else if (key === "M") { e.preventDefault(); toggleMark(false); }
});


/* =========================================================
   PALETTE
========================================================= */

function counts() {
    const c = { nv: 0, na: 0, a: 0, m: 0, am: 0 };
    state.questions.forEach(q => c[statusOf(q)]++);
    return c;
}

function renderPalette(popCurrent) {
    $("palette").innerHTML = state.questions.map((q, i) => {
        const st = statusOf(q);
        const label = { nv: "not visited", na: "not answered", a: "answered", m: "marked for review", am: "answered and marked for review" }[st];
        return `<button type="button" role="listitem" class="pbubble st-${st} ${i === state.index ? "is-current" : ""} ${popCurrent && i === state.index ? "pop" : ""}" data-q="${i}" aria-label="Question ${i + 1}, ${label}" ${i === state.index ? 'aria-current="true"' : ""}>${i + 1}</button>`;
    }).join("");

    const c = counts();
    const answered = c.a + c.am;
    $("legend").innerHTML = [
        ["st-a", c.a, "Answered"], ["st-na", c.na, "Not answered"],
        ["", c.nv, "Not visited"], ["st-m", c.m, "Marked for review"],
        ["st-am", c.am, "Answered and marked", "wide"]
    ].map(([cls, n, label, wide]) => `<div class="legend-item ${wide || ""}"><span class="pbubble ${cls}">${n}</span>${label}</div>`).join("");

    const pct = state.questions.length ? Math.round(answered / state.questions.length * 100) : 0;
    $("answeredCount").textContent = answered;
    $("progressPct").textContent = pct + "%";
    $("progressBar").style.width = pct + "%";
    $("paletteToggleText").textContent = `${state.index + 1}/${state.questions.length}`;
}

$("palette").addEventListener("click", (e) => {
    const b = e.target.closest("[data-q]");
    if (!b) return;
    const i = Number(b.dataset.q);
    if (i !== state.index) showQuestion(i, i > state.index ? "next" : "prev");
    closePalette();
});

function openPalette() {
    $("xpanel").classList.add("is-open");
    $("xbackdrop").classList.add("is-open");
    $("paletteToggle").setAttribute("aria-expanded", "true");
}
function closePalette() {
    $("xpanel").classList.remove("is-open");
    $("xbackdrop").classList.remove("is-open");
    $("paletteToggle").setAttribute("aria-expanded", "false");
}
$("paletteToggle").addEventListener("click", openPalette);
$("paletteClose").addEventListener("click", closePalette);
$("xbackdrop").addEventListener("click", closePalette);


/* =========================================================
   AUTO-SAVE (debounced, retries when offline)
========================================================= */

function queueSave(q, change) {
    const id = String(q._id);
    const merged = Object.assign(state.pending.get(id) || { questionId: id }, change);
    state.pending.set(id, merged);
    setSaveState("pending");
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(flush, 500);
}

async function flush() {
    if (state.submitting || !state.pending.size) return;
    if (state.saving) {
        /* a save is in flight: try again right after it finishes */
        clearTimeout(state.saveTimer);
        state.saveTimer = setTimeout(flush, 400);
        return;
    }
    state.saving = true;
    let failed = false;
    const batch = [...state.pending.values()];
    state.pending.clear();
    setSaveState("saving");

    try {
        const data = await App.api(`/api/attempt/${state.attemptId}/answers`, { method: "PUT", body: { updates: batch } });
        syncClock(data.serverNow);
        state.retryDelay = 2000;
        setSaveState(state.pending.size ? "pending" : "saved");
    } catch (error) {
        const code = error.data && error.data.code;
        if (code === "TIME_UP" || code === "SUBMITTED") {
            state.active = false;
            lock("Time's up", "Your examination was submitted. Opening your result.");
            return setTimeout(() => goToResult(), 900);
        }
        /* put the failed batch back (newer changes win) and retry */
        failed = true;
        batch.forEach(u => { if (!state.pending.has(u.questionId)) state.pending.set(u.questionId, u); });
        setSaveState("error");
        clearTimeout(state.saveTimer);
        state.saveTimer = setTimeout(flush, state.retryDelay);
        state.retryDelay = Math.min(state.retryDelay * 2, 15000);
    } finally {
        state.saving = false;
        if (state.pending.size && !failed && !state.submitting) {
            clearTimeout(state.saveTimer);
            state.saveTimer = setTimeout(flush, 400);
        }
    }
}

function setSaveState(s) {
    const el = $("saveState");
    const map = {
        pending: ['bi-cloud-arrow-up', 'Saving', 'is-saving'],
        saving: ['bi-cloud-arrow-up', 'Saving', 'is-saving'],
        saved: ['bi-cloud-check', 'Saved', ''],
        error: ['bi-cloud-slash', 'Not saved yet, retrying', 'is-error']
    }[s];
    el.className = "save-state " + map[2];
    el.innerHTML = `<i class="bi ${map[0]}"></i> ${map[1]}`;
}

window.addEventListener("online", () => { if (state.active) flush(); });
window.addEventListener("offline", () => { if (state.active) App.toast("You're offline. Keep going: answers will save when you reconnect.", "warn", 6000); });


/* =========================================================
   SUBMIT
========================================================= */

$("submitBtn").addEventListener("click", openSubmit);

function openSubmit() {
    closePalette();
    const c = counts();
    const row = (cls, label, n) => `<tr><td><span class="pbubble ${cls}"></span>${label}</td><td>${n}</td></tr>`;
    $("submitSummary").innerHTML =
        row("st-a", "Answered", c.a) +
        row("st-am", "Answered and marked", c.am) +
        row("st-m", "Marked, not answered", c.m) +
        row("st-na", "Not answered", c.na) +
        row("", "Not visited", c.nv);

    const unanswered = c.m + c.na + c.nv;
    $("submitWarn").innerHTML = unanswered
        ? `<div class="alert alert--warn" style="margin:14px 0 0"><i class="bi bi-exclamation-triangle"></i><div>${unanswered} question${unanswered === 1 ? " has" : "s have"} no answer and will score 0.</div></div>`
        : "";
    $("submitTimeLeft").textContent = App.clock(remainingSeconds());
    App.openModal("submitModal");
}

$("confirmSubmit").addEventListener("click", () => {
    App.closeModal("submitModal");
    lock("Submitting your answers", "Please don't close this page.");
    submit(false);
});

async function submit(auto, tries = 0) {
    if (state.submitting && tries === 0) return;
    state.autoSubmitted = Boolean(auto);
    state.submitting = true;
    state.active = false;
    clearTimeout(state.saveTimer);

    /* send every answer so nothing is lost if an auto-save was still in flight */
    const updates = state.questions.map(q => {
        const a = answerOf(q);
        return { questionId: String(q._id), selected: a.selected, marked: a.marked, visited: a.visited };
    });

    try {
        await App.api(`/api/attempt/${state.attemptId}/submit`, { method: "POST", body: { updates, auto } });
        goToResult();
    } catch (error) {
        if (tries < 3 && error.status !== 404) {
            $("lockText").textContent = "Connection problem. Retrying...";
            setTimeout(() => submit(auto, tries + 1), 1500 * (tries + 1));
        } else {
            /* the server finalises expired attempts on its own, so the result page will still work */
            $("lockText").textContent = "Couldn't reach the server. Opening your result page.";
            setTimeout(goToResult, 1500);
        }
    }
}

function goToResult() {
    window.removeEventListener("beforeunload", beforeUnload);
    /* LIVE PROCTORING: camera and microphone off, admin panel told the exam ended */
    if (PROCTORED) {
        Proctor.stop(state.autoSubmitted ? "time-up" : "submitted");
        document.body.classList.remove("is-proctored");
    }
    location.replace("result.html?attempt=" + state.attemptId + "&fresh=1");
}

function lock(title, text) {
    $("lockTitle").textContent = title;
    $("lockText").textContent = text;
    $("lock").classList.remove("hidden");
}

/* warn before leaving mid-exam (the timer keeps running on the server) */
function beforeUnload(e) {
    if (state.active) {
        if (state.pending.size) flush();
        e.preventDefault();
        e.returnValue = "";
    }
}
window.addEventListener("beforeunload", beforeUnload);


/* =========================================================
   GO
========================================================= */

loadIntro();
