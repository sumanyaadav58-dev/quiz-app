/* =========================================================
   LOGIN / REGISTER
   Function names from the original (loginUser, registerUser,
   showLogin, showRegister, togglePassword) are kept.
========================================================= */

const API = "/api/auth";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const $ = (id) => document.getElementById(id);

App.scene("https://images.unsplash.com/photo-1434030216411-0b793f4b4173?auto=format&fit=crop&w=1600&q=60");

/* Already logged in? Go straight in. */
(function redirectIfLoggedIn() {
    const user = App.Session.user();
    if (user && !App.Session.expired()) {
        location.replace(App.home(user.role));
    } else if (user) {
        App.Session.clear();
    }
})();


/* ---------------- messages ---------------- */

function showAlert(message, type = "error") {
    const box = $("authAlert");
    const icon = { error: "bi-exclamation-circle", success: "bi-check-circle", info: "bi-info-circle", warn: "bi-exclamation-triangle" }[type];
    box.className = "alert alert--" + type;
    box.innerHTML = `<i class="bi ${icon}"></i><div>${App.esc(message)}</div>`;
    if (type === "error") {
        box.classList.remove("shake");
        void box.offsetWidth;
        box.classList.add("shake");
    }
}

function hideAlert() {
    $("authAlert").className = "alert hidden";
}

function setFieldError(id, message) {
    const field = document.querySelector(`[data-field="${id}"]`);
    if (!field) return;
    field.classList.toggle("has-error", Boolean(message));
    field.querySelector(".field__error").textContent = message || "";
    $(id).setAttribute("aria-invalid", message ? "true" : "false");
}

function clearErrors(form) {
    form.querySelectorAll(".field").forEach(f => setFieldError(f.dataset.field, ""));
}


/* ---------------- tabs ---------------- */

function switchTab(which) {
    const login = which === "login";
    $("loginBox").classList.toggle("hidden", !login);
    $("registerBox").classList.toggle("hidden", login);
    $("codeBox").classList.add("hidden");
    $("loginTab").classList.toggle("is-active", login);
    $("registerTab").classList.toggle("is-active", !login);
    $("loginTab").setAttribute("aria-selected", String(login));
    $("registerTab").setAttribute("aria-selected", String(!login));
    hideAlert();
    document.title = (login ? "Log in" : "Create account") + " | Quiz App";
    setTimeout(() => $(login ? "loginEmail" : "regName").focus(), 30);
}

function showLogin() { switchTab("login"); }
function showRegister() { switchTab("register"); }

/* sign in with a one-time email code */
function showCode(email) {
    $("loginBox").classList.add("hidden");
    $("registerBox").classList.add("hidden");
    $("codeBox").classList.remove("hidden");
    $("loginTab").classList.add("is-active");
    $("registerTab").classList.remove("is-active");
    hideAlert();
    resetCodeForm();
    if (email) $("codeEmail").value = email;
    document.title = "Email code | Quiz App";
    setTimeout(() => $("codeEmail").focus(), 30);
}

/* shared by every sign-in method: store the session and go to the right page */
function afterLogin(data, fallback) {
    App.Session.set(data.token, data.user);

    /* only follow ?next= if it's a same-site page path */
    const next = App.qs("next") || "";
    const safe = /^\/[A-Za-z0-9_\-./?=&%]*$/.test(next) && !next.startsWith("//") && !next.includes("login");
    let target = fallback || App.home(data.user.role);
    if (safe) {
        const wantsAdmin = next.includes("admin");
        if ((data.user.role === "admin") === wantsAdmin || data.user.role === "admin") target = next;
    }
    location.replace(target);
}


/* ---------------- password visibility ---------------- */

function togglePassword(id = "loginPassword") {
    const input = $(id);
    const button = document.querySelector(`[data-reveal="${id}"]`);
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    if (button) {
        button.innerHTML = `<i class="bi ${show ? "bi-eye-slash" : "bi-eye"}"></i>`;
        button.setAttribute("aria-label", show ? "Hide password" : "Show password");
    }
}

document.querySelectorAll("[data-reveal]").forEach(btn => {
    btn.addEventListener("click", () => togglePassword(btn.dataset.reveal));
});

/* caps lock hint */
(function capsHint() {
    const input = $("loginPassword");
    const hint = document.querySelector('[data-caps="loginPassword"]');
    const check = (e) => hint && e.getModifierState && hint.classList.toggle("hidden", !e.getModifierState("CapsLock"));
    input.addEventListener("keyup", check);
    input.addEventListener("keydown", check);
})();


/* ---------------- password rules (register) ---------------- */

function passwordChecks(pw) {
    return { len: pw.length >= 8, letter: /[A-Za-z]/.test(pw), num: /[0-9]/.test(pw) };
}

$("regPassword").addEventListener("input", (e) => {
    const checks = passwordChecks(e.target.value);
    document.querySelectorAll("#pwRules li").forEach(li => li.classList.toggle("is-met", checks[li.dataset.rule]));
});

/* clear a field error as soon as the user edits it */
document.querySelectorAll(".auth-form .input").forEach(input => {
    input.addEventListener("input", () => setFieldError(input.id, ""));
});


/* ---------------- LOGIN ---------------- */

let loginBusy = false;

async function loginUser(event) {
    if (event) event.preventDefault();
    if (loginBusy) return;

    const form = $("loginBox");
    clearErrors(form);
    hideAlert();

    const email = $("loginEmail").value.trim();
    const password = $("loginPassword").value;

    let bad = false;
    if (!email) { setFieldError("loginEmail", "Enter your email address"); bad = true; }
    else if (!EMAIL_RE.test(email)) { setFieldError("loginEmail", "That doesn't look like a valid email address"); bad = true; }
    if (!password) { setFieldError("loginPassword", "Enter your password"); bad = true; }
    if (bad) {
        form.querySelector(".has-error .input").focus();
        return;
    }

    const button = $("loginButton");
    loginBusy = true;
    App.busy(button, true, "Logging in");

    try {
        const data = await App.api(API + "/login", { method: "POST", body: { email, password }, allowUnauthorized: true });

        afterLogin(data);

    } catch (error) {
        loginBusy = false;
        App.busy(button, false);

        if (error.status === 401) {
            showAlert("Incorrect email or password. Check both and try again.");
            $("loginPassword").select();
        } else if (error.data && error.data.code === "NO_PASSWORD") {
            showAlert(error.message, "info");
        } else {
            showAlert(error.message);
        }
    }
}


/* ---------------- REGISTER ---------------- */

let registerBusy = false;

async function registerUser(event) {
    if (event) event.preventDefault();
    if (registerBusy) return;

    const form = $("registerBox");
    clearErrors(form);
    hideAlert();

    const name = $("regName").value.trim();
    const email = $("regEmail").value.trim();
    const password = $("regPassword").value;
    const confirm = $("regConfirm").value;
    const checks = passwordChecks(password);

    let bad = false;
    if (!name) { setFieldError("regName", "Enter your full name"); bad = true; }
    else if (name.length < 2) { setFieldError("regName", "Name is too short"); bad = true; }

    if (!email) { setFieldError("regEmail", "Enter your email address"); bad = true; }
    else if (!EMAIL_RE.test(email)) { setFieldError("regEmail", "That doesn't look like a valid email address"); bad = true; }

    if (!password) { setFieldError("regPassword", "Create a password"); bad = true; }
    else if (!checks.len || !checks.letter || !checks.num) { setFieldError("regPassword", "Password needs 8+ characters with a letter and a number"); bad = true; }

    if (!bad && password !== confirm) { setFieldError("regConfirm", "Passwords don't match"); bad = true; }

    if (bad) {
        form.querySelector(".has-error .input").focus();
        return;
    }

    const button = $("registerButton");
    registerBusy = true;
    App.busy(button, true, "Creating account");

    try {
        await App.api(API + "/register", { method: "POST", body: { name, email, password }, allowUnauthorized: true });

        /* sign straight in so the candidate doesn't have to type it all again */
        App.busy(button, true, "Signing you in");
        const data = await App.api(API + "/login", { method: "POST", body: { email, password }, allowUnauthorized: true });
        App.Session.set(data.token, data.user);
        location.replace("home.html?welcome=1");

    } catch (error) {
        registerBusy = false;
        App.busy(button, false);

        const fieldErrors = (error.data && error.data.errors) || {};
        const map = { name: "regName", email: "regEmail", password: "regPassword" };
        Object.entries(fieldErrors).forEach(([k, v]) => map[k] && setFieldError(map[k], v));

        if (error.status === 409) {
            showAlert("An account with this email already exists. Log in instead.", "warn");
            $("loginEmail").value = email;
        } else if (!Object.keys(fieldErrors).length) {
            showAlert(error.message);
        }
    }
}


/* ---------------- GOOGLE ---------------- */

async function googleSignIn(credential) {
    hideAlert();
    showAlert("Signing you in with Google...", "info");
    try {
        const data = await App.api(API + "/google", { method: "POST", body: { credential }, allowUnauthorized: true });
        afterLogin(data, data.message === "Account created with Google" ? "home.html?welcome=1" : null);
    } catch (error) {
        showAlert(error.message);
    }
}

Social.googleButton($("googleLogin"), googleSignIn, { text: "continue_with" });
Social.googleButton($("googleRegister"), googleSignIn, { text: "signup_with" });


/* ---------------- EMAIL CODE ---------------- */

let codeSentTo = "";
let codeBusy = false;

function resetCodeForm() {
    codeSentTo = "";
    $("codeStep2").classList.add("hidden");
    $("codeValue").value = "";
    $("codeEmail").readOnly = false;
    $("codeIntro").textContent = "No password needed. We'll send a 6-digit code to your email.";
    $("codeButton").innerHTML = '<i class="bi bi-send btn__icon"></i> Send code';
    clearErrors($("codeBox"));
}

async function sendCode() {
    const email = $("codeEmail").value.trim();
    if (!EMAIL_RE.test(email)) { setFieldError("codeEmail", "Enter a valid email address"); $("codeEmail").focus(); return false; }
    const data = await App.api(API + "/email-code/request", { method: "POST", body: { email }, allowUnauthorized: true });
    codeSentTo = email;
    $("codeEmail").readOnly = true;
    $("codeStep2").classList.remove("hidden");
    $("codeIntro").textContent = `Enter the code sent to ${email}. It expires in 10 minutes.`;
    $("codeButton").innerHTML = '<i class="bi bi-box-arrow-in-right btn__icon"></i> Sign in';
    showAlert(data.message, data.delivery === "email" ? "success" : "info");
    setTimeout(() => $("codeValue").focus(), 30);
    return true;
}

$("codeBox").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (codeBusy) return;
    clearErrors($("codeBox"));
    const button = $("codeButton");
    codeBusy = true;

    try {
        if (!codeSentTo) {
            App.busy(button, true, "Sending");
            await sendCode();
        } else {
            const code = $("codeValue").value.replace(/\D/g, "");
            if (code.length !== 6) { setFieldError("codeValue", "Enter the 6 digits from the email"); return; }
            App.busy(button, true, "Checking");
            const data = await App.api(API + "/email-code/verify", { method: "POST", body: { email: codeSentTo, code }, allowUnauthorized: true });
            afterLogin(data);
            return;
        }
    } catch (error) {
        if (error.data && error.data.code === "NO_ACCOUNT") setFieldError("codeEmail", error.message);
        else if (codeSentTo) setFieldError("codeValue", error.message);
        else showAlert(error.message);
    } finally {
        codeBusy = false;
        App.busy(button, false);
    }
});

$("codeResend").addEventListener("click", async () => {
    try {
        $("codeEmail").readOnly = false;
        await sendCode();
    } catch (error) {
        showAlert(error.message);
    }
});

$("codeValue").addEventListener("input", (e) => {
    e.target.value = e.target.value.replace(/\D/g, "").slice(0, 6);
    setFieldError("codeValue", "");
});

$("codeLoginBtn").addEventListener("click", () => showCode($("loginEmail").value.trim()));


/* ---------------- wiring ---------------- */

/* Real forms: pressing Enter in any field submits. */
$("loginBox").addEventListener("submit", loginUser);
$("registerBox").addEventListener("submit", registerUser);

/* Messages passed in the URL (logout, expired session, etc.) */
(function showReason() {
    const reason = App.qs("reason");
    const messages = {
        logout: ["You've been logged out.", "success"],
        expired: ["Your session expired. Log in again to continue.", "info"],
        login: ["Log in to continue.", "info"],
        disabled: ["This account has been disabled. Contact the administrator.", "error"]
    };
    if (messages[reason]) showAlert(...messages[reason]);
    if (location.hash === "#register") showRegister();
    else $("loginEmail").focus();
})();

/* Mini answer sheet on the left: fills in once, row by row */
(function sheetDemo() {
    const host = $("sheetDemo");
    if (!host) return;
    const picks = [1, 3, 0, 2, 1];
    host.innerHTML = picks.map((_, r) => `
        <div class="sheet-row">
            <span class="sheet-row__n">${String(r + 1).padStart(2, "0")}</span>
            ${"ABCD".split("").map(l => `<span class="bubble"><span>${l}</span></span>`).join("")}
        </div>`).join("");

    const rows = host.querySelectorAll(".sheet-row");
    const fill = (r) => rows[r].querySelectorAll(".bubble")[picks[r]].classList.add("is-filled");

    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
        rows.forEach((_, r) => fill(r));
        return;
    }
    rows.forEach((_, r) => setTimeout(() => fill(r), 600 + r * 420));
})();
