/* =========================================================
   MY PERFORMANCE: stats, trend, subjects, history, account
========================================================= */

const user = App.guard("user");
App.nav("profile");
App.scene();

const $ = (id) => document.getElementById(id);
const esc = App.esc;

async function loadStats() {
    try {
        const { stats } = await App.api("/api/attempt/my/stats");
        const has = stats.attempts > 0;
        $("stats").innerHTML = [
            ["bi-journal-check", "Attempts", stats.attempts, `${stats.passed} passed`],
            ["bi-award", "Best score", has ? App.pct(stats.bestPercentage) : "None yet", "Highest percentage"],
            ["bi-bar-chart", "Average", has ? App.pct(stats.averagePercentage) : "None yet", "Across all attempts"],
            ["bi-clock-history", "Time in exams", has ? App.duration(stats.totalTime) : "None yet", `Accuracy ${App.pct(stats.accuracy)}`]
        ].map(([i, l, v, s]) => `<div class="stat"><div class="stat__label"><i class="bi ${i}"></i> ${l}</div><div class="stat__value">${esc(v)}</div><div class="stat__sub">${esc(s)}</div></div>`).join("");

        renderTrend(stats.trend);

        $("subjects").innerHTML = stats.categories.length
            ? stats.categories.map(c => `
                <div class="bar-row">
                    <div class="bar-row__top"><strong>${esc(c.category)}</strong><span>avg ${App.pct(c.average)} | best ${App.pct(c.best)} | ${c.attempts} attempt${c.attempts === 1 ? "" : "s"}</span></div>
                    <div class="meter ${c.average >= 60 ? "is-good" : c.average < 35 ? "is-low" : ""}"><span data-w="${c.average}"></span></div>
                </div>`).join("")
            : `<div class="empty"><i class="bi bi-diagram-3"></i><strong>No subjects yet</strong>Subject averages appear after your first result.</div>`;

        requestAnimationFrame(() => requestAnimationFrame(() => document.querySelectorAll("[data-w]").forEach(s => s.style.width = s.dataset.w + "%")));
    } catch (error) {
        $("stats").innerHTML = `<p class="muted">${esc(error.message)}</p>`;
    }
}

/* small hand-drawn SVG line chart: no chart library needed */
function renderTrend(points) {
    if (!points.length) {
        $("trend").innerHTML = `<div class="empty"><i class="bi bi-graph-up"></i><strong>Nothing to plot yet</strong>Take an examination to start your trend line.</div>`;
        return;
    }
    const W = 600, H = 170, P = { l: 34, r: 12, t: 12, b: 22 };
    const iw = W - P.l - P.r, ih = H - P.t - P.b;
    const x = (i) => P.l + (points.length === 1 ? iw / 2 : i * iw / (points.length - 1));
    const y = (v) => P.t + ih - (Math.max(0, Math.min(100, v)) / 100) * ih;
    const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.percentage).toFixed(1)}`).join(" ");
    const area = `${line} L${x(points.length - 1).toFixed(1)},${P.t + ih} L${x(0).toFixed(1)},${P.t + ih} Z`;
    const grid = [0, 25, 50, 75, 100].map(v => `<line class="grid-line" x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}"/><text x="${P.l - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join("");

    $("trend").innerHTML = `
        <svg class="trend" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Percentage over your last ${points.length} attempts">
            <defs><linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3563E9" stop-opacity=".35"/><stop offset="1" stop-color="#3563E9" stop-opacity="0"/></linearGradient></defs>
            ${grid}
            <path class="area" d="${area}"/>
            <path class="line" d="${line}"/>
            ${points.map((p, i) => `<circle class="dot" cx="${x(i)}" cy="${y(p.percentage)}" r="4"><title>${esc(p.title)}: ${App.pct(p.percentage)}</title></circle>`).join("")}
        </svg>`;
}

async function loadHistory() {
    try {
        const { attempts } = await App.api("/api/attempt/my");
        $("histCount").textContent = `${attempts.length} submitted attempt${attempts.length === 1 ? "" : "s"}`;
        $("history").innerHTML = attempts.length
            ? attempts.map(a => `
                <tr>
                    <td><strong>${esc(a.quizTitle)}</strong><div class="faint" style="font-size:.8rem">${esc(a.quizCategory || "")}</div></td>
                    <td class="t-right num">${App.marks(a.score)} / ${App.marks(a.totalMarks)}</td>
                    <td class="t-right num t-strong">${App.pct(a.percentage)}</td>
                    <td><span class="badge ${a.passed ? "badge--green" : "badge--red"}">${a.passed ? "Pass" : "Fail"}</span>${a.submittedAutomatically ? ' <span class="badge badge--amber" title="Submitted when time ran out">Auto</span>' : ""}</td>
                    <td class="t-right num">${App.duration(a.timeTaken)}</td>
                    <td>${esc(App.date(a.submittedAt))}</td>
                    <td class="t-right"><a class="btn btn--sm" href="result.html?attempt=${a._id}">Review</a></td>
                </tr>`).join("")
            : `<tr><td colspan="7"><div class="empty"><i class="bi bi-inbox"></i><strong>No attempts yet</strong>Your submitted examinations will be listed here.<br><a class="btn btn--primary" href="home.html">Find an examination</a></div></td></tr>`;
    } catch (error) {
        $("history").innerHTML = `<tr><td colspan="7" class="muted">${esc(error.message)}</td></tr>`;
    }
}

let me = null;

async function loadAccount() {
    try {
        const data = await App.api("/api/auth/me");
        setMe(data.user);
        $("nameInput").value = me.name;
        $("account").scrollIntoView && location.hash === "#account" && $("account").scrollIntoView({ block: "start" });
    } catch (e) { /* handled by api() */ }
}

/* one place that refreshes everything showing the account */
function setMe(user) {
    me = { ...(me || {}), ...user };
    App.Session.update(me);
    App.nav("profile");
    renderHero();
    renderAccountRows();
    renderConnections();
    renderPasswordPanel();
}

function renderAccountRows() {
    $("account2").innerHTML = `
        <div class="account__row"><span>Email</span><strong>${esc(me.email)}</strong></div>
        <div class="account__row"><span>Member since</span><strong>${esc(App.date(me.createdAt, false))}</strong></div>
        <div class="account__row"><span>Last login</span><strong>${esc(App.date(me.lastLogin))}</strong></div>`;
}

function renderHero() {
    App.paintAvatar($("heroAvatar"), me);
    $("heroName").textContent = me.name;
    $("heroEmail").textContent = me.email;
    const chips = [];
    if (me.googleLinked) chips.push('<span class="badge badge--blue"><i class="bi bi-google"></i> Google connected</span>');
    if (me.emailVerified) chips.push('<span class="badge badge--green"><i class="bi bi-patch-check"></i> Email verified</span>');
    if (me.hasPassword) chips.push('<span class="badge"><i class="bi bi-key"></i> Password set</span>');
    $("heroChips").innerHTML = chips.join("");

    const local = /^\/uploads\/avatars\//.test(me.avatar || "");
    $("photoUpload").innerHTML = me.avatar ? '<i class="bi bi-upload"></i> Change photo' : '<i class="bi bi-upload"></i> Upload photo';
    $("photoEdit").classList.toggle("hidden", !local);
    $("photoRemove").classList.toggle("hidden", !me.avatar);
    $("photoGoogle").classList.toggle("hidden", !me.googlePicture || me.avatar === me.googlePicture);
}

function renderPasswordPanel() {
    $("pwTitle").textContent = me.hasPassword ? "Change password" : "Set a password";
    $("pwCurrentField").classList.toggle("hidden", !me.hasPassword);
    $("pwBtn").innerHTML = `<i class="bi bi-shield-lock btn__icon"></i> ${me.hasPassword ? "Change password" : "Set password"}`;
}


/* =========================================================
   PROFILE PHOTO: pick, crop, zoom, rotate, upload
========================================================= */

const crop = {
    img: null,
    zoom: 1,
    rotation: 0,       /* 0, 90, 180, 270 */
    x: 0, y: 0,        /* image centre offset from canvas centre, in canvas px */
    drag: null
};
const canvas = $("cropCanvas");
const ctx = canvas.getContext("2d");

function pickPhoto() {
    $("photoFile").value = "";
    $("photoFile").click();
}

$("photoUpload").addEventListener("click", pickPhoto);
$("photoQuick").addEventListener("click", () => (me && /^\/uploads\//.test(me.avatar || "") ? openEditor(me.avatar) : pickPhoto()));
$("cropOther").addEventListener("click", pickPhoto);
$("photoEdit").addEventListener("click", () => openEditor(me.avatar));

$("photoFile").addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) loadFile(file);
});

function loadFile(file) {
    if (!/^image\/(png|jpe?g|webp|gif)$/i.test(file.type)) return App.toast("Choose a JPG, PNG, WebP or GIF image", "error");
    if (file.size > 15 * 1024 * 1024) return App.toast("That image is over 15 MB. Choose a smaller one.", "error");
    const url = URL.createObjectURL(file);
    openEditor(url, () => URL.revokeObjectURL(url));
}

function openEditor(src, done) {
    const img = new Image();
    img.onload = () => {
        crop.img = img;
        crop.zoom = 1;
        crop.rotation = 0;
        crop.x = 0;
        crop.y = 0;
        $("cropZoom").value = 1;
        draw();
        if (!$("photoModal").classList.contains("is-open")) App.openModal("photoModal");
        if (done) done();
    };
    img.onerror = () => { App.toast("That image couldn't be opened", "error"); if (done) done(); };
    img.src = src;
}

/* size of the image on the canvas at zoom 1: just big enough to cover the circle */
function baseScale() {
    const rotated = crop.rotation % 180 !== 0;
    const w = rotated ? crop.img.naturalHeight : crop.img.naturalWidth;
    const h = rotated ? crop.img.naturalWidth : crop.img.naturalHeight;
    return Math.max(canvas.width / w, canvas.height / h);
}

function clamp() {
    const s = baseScale() * crop.zoom;
    const rotated = crop.rotation % 180 !== 0;
    const w = (rotated ? crop.img.naturalHeight : crop.img.naturalWidth) * s;
    const h = (rotated ? crop.img.naturalWidth : crop.img.naturalHeight) * s;
    const maxX = Math.max(0, (w - canvas.width) / 2);
    const maxY = Math.max(0, (h - canvas.height) / 2);
    crop.x = Math.min(maxX, Math.max(-maxX, crop.x));
    crop.y = Math.min(maxY, Math.max(-maxY, crop.y));
}

function paint(target, size) {
    const c = target.getContext("2d");
    const k = size / canvas.width;
    const s = baseScale() * crop.zoom * k;
    c.save();
    c.fillStyle = "#ffffff";
    c.fillRect(0, 0, size, size);
    c.translate(size / 2 + crop.x * k, size / 2 + crop.y * k);
    c.rotate(crop.rotation * Math.PI / 180);
    c.drawImage(crop.img, -crop.img.naturalWidth * s / 2, -crop.img.naturalHeight * s / 2, crop.img.naturalWidth * s, crop.img.naturalHeight * s);
    c.restore();
}

function draw() {
    if (!crop.img) return;
    clamp();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    paint(canvas, canvas.width);
}

$("cropZoom").addEventListener("input", (e) => { crop.zoom = Number(e.target.value); draw(); });
$("cropRotate").addEventListener("click", () => { crop.rotation = (crop.rotation + 90) % 360; draw(); });

const cropper = $("cropper");
const toCanvas = (dx) => dx * canvas.width / cropper.clientWidth;

cropper.addEventListener("pointerdown", (e) => {
    if (!crop.img) return;
    cropper.setPointerCapture(e.pointerId);
    crop.drag = { px: e.clientX, py: e.clientY, x: crop.x, y: crop.y };
});
cropper.addEventListener("pointermove", (e) => {
    if (!crop.drag) return;
    crop.x = crop.drag.x + toCanvas(e.clientX - crop.drag.px);
    crop.y = crop.drag.y + toCanvas(e.clientY - crop.drag.py);
    draw();
});
["pointerup", "pointercancel"].forEach(t => cropper.addEventListener(t, () => { crop.drag = null; }));
cropper.addEventListener("wheel", (e) => {
    if (!crop.img) return;
    e.preventDefault();
    crop.zoom = Math.min(4, Math.max(1, crop.zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08)));
    $("cropZoom").value = crop.zoom;
    draw();
}, { passive: false });

/* keyboard: arrows move, +/- zoom */
canvas.tabIndex = 0;
canvas.addEventListener("keydown", (e) => {
    const step = 12;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[e.key]) { crop.x += moves[e.key][0]; crop.y += moves[e.key][1]; draw(); e.preventDefault(); }
    if (e.key === "+" || e.key === "=") { crop.zoom = Math.min(4, crop.zoom + 0.1); $("cropZoom").value = crop.zoom; draw(); }
    if (e.key === "-") { crop.zoom = Math.max(1, crop.zoom - 0.1); $("cropZoom").value = crop.zoom; draw(); }
});

/* drop a file straight onto the editor or the photo */
[cropper, $("heroAvatar")].forEach(el => {
    el.addEventListener("dragover", (e) => { e.preventDefault(); cropper.classList.add("is-drop"); });
    el.addEventListener("dragleave", () => cropper.classList.remove("is-drop"));
    el.addEventListener("drop", (e) => {
        e.preventDefault();
        cropper.classList.remove("is-drop");
        const file = e.dataTransfer.files && e.dataTransfer.files[0];
        if (file) loadFile(file);
    });
});

$("cropSave").addEventListener("click", async () => {
    if (!crop.img) return;
    const out = document.createElement("canvas");
    out.width = out.height = 400;
    draw();
    paint(out, 400);
    let image;
    try {
        image = out.toDataURL("image/jpeg", 0.88);
    } catch (e) {
        return App.toast("This photo can't be edited here. Upload it from your computer instead.", "error");
    }
    App.busy($("cropSave"), true, "Saving");
    try {
        const data = await App.api("/api/auth/avatar", { method: "PUT", body: { image } });
        setMe(data.user);
        App.closeModal("photoModal");
        App.toast("Profile photo updated", "success");
    } catch (error) {
        App.toast(error.message, "error");
    } finally {
        App.busy($("cropSave"), false);
    }
});

$("photoRemove").addEventListener("click", async () => {
    const ok = await App.confirm({ title: "Remove your profile photo?", message: "Your initials will show instead.", confirmText: "Remove", tone: "danger" });
    if (!ok) return;
    try {
        const data = await App.api("/api/auth/avatar", { method: "DELETE" });
        setMe(data.user);
        App.toast("Photo removed", "success");
    } catch (error) {
        App.toast(error.message, "error");
    }
});

$("photoGoogle").addEventListener("click", async () => {
    try {
        const data = await App.api("/api/auth/avatar/google", { method: "POST" });
        setMe(data.user);
        App.toast("Now using your Google photo", "success");
    } catch (error) {
        App.toast(error.message, "error");
    }
});


/* =========================================================
   CONNECTED ACCOUNTS: Google and email
========================================================= */

let emailCodeSent = false;

function renderConnections() {
    const google = me.googleLinked
        ? `<div class="connect-row__action">
               <span class="sdot sdot--on">Connected</span>
               <button class="btn btn--sm btn--ghost" type="button" id="googleUnlink">Disconnect</button>
           </div>`
        : `<div class="connect-row__action" style="min-width:240px"><div id="googleLinkSlot" style="width:100%"></div></div>`;

    const email = me.emailVerified
        ? `<div class="connect-row__action"><span class="sdot sdot--on">Verified</span></div>`
        : emailCodeSent
            ? `<form class="connect-row__action" id="emailVerifyForm">
                   <input class="input num" id="emailCode" inputmode="numeric" maxlength="6" placeholder="Code" autocomplete="one-time-code" aria-label="6-digit code">
                   <button class="btn btn--primary btn--sm" type="submit">Verify</button>
                   <button class="btn btn--ghost btn--sm" type="button" id="emailSend">Resend</button>
               </form>`
            : `<div class="connect-row__action"><span class="sdot sdot--warn">Not verified</span><button class="btn btn--sm" type="button" id="emailSend">Send code</button></div>`;

    $("connectList").innerHTML = `
        <div class="connect-row">
            <span class="connect-row__icon">${Social.GOOGLE_SVG}</span>
            <div class="connect-row__text"><strong>Google</strong><span>${me.googleLinked ? `Signed in as ${esc(me.googleEmail)}. You can log in with one click.` : "Connect Google to sign in with one click and use your Google photo."}</span></div>
            ${google}
        </div>
        <div class="connect-row">
            <span class="connect-row__icon"><i class="bi bi-envelope"></i></span>
            <div class="connect-row__text"><strong>Email</strong><span>${esc(me.email)}. ${me.emailVerified ? "You can sign in with a one-time email code." : "Verify it to sign in with a one-time code, no password needed."}</span></div>
            ${email}
        </div>
        <div class="connect-row">
            <span class="connect-row__icon"><i class="bi bi-key"></i></span>
            <div class="connect-row__text"><strong>Password</strong><span>${me.hasPassword ? "Sign in with your email and password." : "No password yet. Set one below to sign in without Google."}</span></div>
            <div class="connect-row__action">${me.hasPassword ? '<span class="sdot sdot--on">Set</span>' : '<a class="btn btn--sm" href="#pwForm">Set password</a>'}</div>
        </div>`;

    if (!me.googleLinked) Social.googleButton($("googleLinkSlot"), linkGoogle, { text: "continue_with", width: 240 });
    if (me.emailVerified) emailCodeSent = false;
}

async function linkGoogle(credential) {
    try {
        const data = await App.api("/api/auth/google/link", { method: "POST", body: { credential } });
        setMe(data.user);
        App.toast("Google account connected", "success");
    } catch (error) {
        App.toast(error.message, "error");
    }
}

$("connectList").addEventListener("click", async (e) => {
    if (e.target.closest("#googleUnlink")) {
        const ok = await App.confirm({ title: "Disconnect Google?", message: "You won't be able to sign in with Google until you connect it again.", confirmText: "Disconnect", tone: "danger" });
        if (!ok) return;
        try {
            const data = await App.api("/api/auth/google/link", { method: "DELETE" });
            setMe(data.user);
            App.toast("Google disconnected", "success");
        } catch (error) {
            App.toast(error.message, "error");
        }
    }
    if (e.target.closest("#emailSend")) {
        const btn = e.target.closest("#emailSend");
        App.busy(btn, true);
        try {
            const data = await App.api("/api/auth/email/verify-request", { method: "POST" });
            emailCodeSent = true;
            renderConnections();
            App.toast(data.message, data.delivery === "email" ? "success" : "info", 7000);
            const input = $("emailCode");
            if (input) input.focus();
        } catch (error) {
            App.busy(btn, false);
            App.toast(error.message, "error");
        }
    }
});

$("connectList").addEventListener("submit", async (e) => {
    if (e.target.id !== "emailVerifyForm") return;
    e.preventDefault();
    const code = $("emailCode").value.replace(/\D/g, "");
    if (code.length !== 6) return App.toast("Enter the 6-digit code", "error");
    try {
        const data = await App.api("/api/auth/email/verify", { method: "POST", body: { code } });
        setMe(data.user);
        App.toast("Email verified", "success");
    } catch (error) {
        App.toast(error.message, "error");
    }
});

$("nameForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("nameInput").value.trim();
    if (name.length < 2) return App.toast("Name is too short", "error");
    App.busy($("nameBtn"), true, "Saving");
    try {
        const data = await App.api("/api/auth/me", { method: "PUT", body: { name } });
        setMe(data.user);
        App.toast("Name saved", "success");
    } catch (error) {
        App.toast(error.message, "error");
    } finally {
        App.busy($("nameBtn"), false);
    }
});

$("pwForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const currentPassword = $("pwCurrent").value;
    const newPassword = $("pwNew").value;
    if ((me && me.hasPassword && !currentPassword) || !newPassword) return App.toast(me && me.hasPassword ? "Fill in both password fields" : "Enter a new password", "error");
    App.busy($("pwBtn"), true, "Changing");
    try {
        const data = await App.api("/api/auth/change-password", { method: "PUT", body: { currentPassword, newPassword } });
        $("pwForm").reset();
        if (data.user) setMe(data.user);
        App.toast(data.message || "Password changed", "success");
    } catch (error) {
        App.toast(error.message, "error");
    } finally {
        App.busy($("pwBtn"), false);
    }
});

loadStats();
loadHistory();
loadAccount();
