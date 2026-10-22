/* =========================================================
   CORE: shared helpers for every page
   Session, API calls, guards, toasts, dialogs, theme, nav, formatting.
========================================================= */

(function () {

    /* ---------------- theme (applied as early as possible) ---------------- */

    const THEME_KEY = "theme";

    function getTheme() {
        try { return localStorage.getItem(THEME_KEY) || "dark"; } catch (e) { return "dark"; }
    }

    function setTheme(theme) {
        document.documentElement.setAttribute("data-theme", theme);
        try { localStorage.setItem(THEME_KEY, theme); } catch (e) { /* ignore */ }
        document.querySelectorAll("[data-theme-icon]").forEach(el => {
            el.className = theme === "dark" ? "bi bi-sun" : "bi bi-moon-stars";
        });
    }

    document.documentElement.setAttribute("data-theme", getTheme());

    /* ---------------- session ---------------- */

    const Session = {
        token() { return localStorage.getItem("token"); },
        user() {
            const token = this.token();
            if (!token) return null;
            return {
                name: localStorage.getItem("name") || "Candidate",
                email: localStorage.getItem("email") || "",
                role: localStorage.getItem("role") || "user",
                avatar: localStorage.getItem("avatar") || ""
            };
        },
        set(token, user) {
            /* same keys as the original app, so nothing else breaks */
            localStorage.setItem("token", token);
            localStorage.setItem("name", user.name);
            localStorage.setItem("email", user.email);
            localStorage.setItem("role", user.role);
            this.setAvatar(user.avatar);
        },
        /* keep the stored copy in sync after profile changes */
        update(user) {
            if (!user) return;
            if (user.name) localStorage.setItem("name", user.name);
            if (user.email) localStorage.setItem("email", user.email);
            if ("avatar" in user) this.setAvatar(user.avatar);
        },
        setAvatar(url) {
            if (url) localStorage.setItem("avatar", url);
            else localStorage.removeItem("avatar");
        },
        clear() {
            ["token", "name", "email", "role", "avatar"].forEach(k => localStorage.removeItem(k));
        },
        /* token payload is only used to know when it expires; the server validates it */
        expired() {
            const token = this.token();
            if (!token) return true;
            try {
                const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
                return payload.exp && payload.exp * 1000 < Date.now();
            } catch (e) {
                return true;
            }
        }
    };

    /* ---------------- API ---------------- */

    class ApiError extends Error {
        constructor(message, status, data) {
            super(message);
            this.status = status;
            this.data = data || {};
        }
    }

    async function api(path, options = {}) {

        const headers = { Accept: "application/json" };
        if (options.body !== undefined) headers["Content-Type"] = "application/json";
        const token = Session.token();
        if (token) headers.Authorization = "Bearer " + token;

        let response;
        try {
            response = await fetch(path, {
                method: options.method || "GET",
                headers,
                body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
                keepalive: Boolean(options.keepalive)
            });
        } catch (error) {
            throw new ApiError("Can't reach the server. Check your connection and that the server is running.", 0);
        }

        let data = {};
        try { data = await response.json(); } catch (e) { data = {}; }

        if (!response.ok) {
            const message = data.message || "Something went wrong. Please try again.";

            /* session gone: send to login (unless this call handles it itself) */
            if ((response.status === 401 || data.code === "ACCOUNT_DISABLED") && !options.allowUnauthorized) {
                Session.clear();
                const reason = data.code === "ACCOUNT_DISABLED" ? "disabled" : "expired";
                const next = encodeURIComponent(location.pathname + location.search);
                location.replace("login.html?reason=" + reason + "&next=" + next);
            }

            throw new ApiError(message, response.status, data);
        }

        return data;
    }

    /* ---------------- guards ---------------- */

    function home(role) {
        return role === "admin" ? "admin.html" : "home.html";
    }

    /* Call at the top of a protected page. Returns the user or redirects. */
    function guard(role) {
        const user = Session.user();

        if (!user || Session.expired()) {
            Session.clear();
            const next = encodeURIComponent(location.pathname + location.search);
            location.replace("login.html?reason=" + (user ? "expired" : "login") + "&next=" + next);
            throw new Error("redirecting");
        }

        if (role && user.role !== role) {
            location.replace(home(user.role));
            throw new Error("redirecting");
        }

        return user;
    }

    function logout() {
        Session.clear();
        location.replace("login.html?reason=logout");
    }

    /* ---------------- escaping & formatting ---------------- */

    function esc(value) {
        return String(value === null || value === undefined ? "" : value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function initials(name) {
        return String(name || "?").trim().split(/\s+/).slice(0, 2).map(p => p[0] || "").join("").toUpperCase() || "?";
    }

    /* ---------------- profile photo ---------------- */

    /* Only our own uploads and https photo URLs (e.g. Google) are shown */
    function safeAvatarUrl(url) {
        if (typeof url !== "string" || !url) return "";
        if (/^\/uploads\/avatars\/[A-Za-z0-9._-]+$/.test(url)) return url;
        if (/^https:\/\/[^\s"'<>]+$/.test(url)) return url;
        return "";
    }

    /* inner HTML for an .avatar element: the photo, or initials as a fallback */
    function avatarInner(user) {
        const url = safeAvatarUrl(user && user.avatar);
        const init = esc(initials(user && (user.name || user.userName)));
        return url
            ? `<img class="avatar__img" src="${esc(url)}" alt="" referrerpolicy="no-referrer" data-initials="${init}">`
            : init;
    }

    function avatar(user, extraClass = "") {
        const has = safeAvatarUrl(user && user.avatar);
        return `<span class="avatar ${has ? "avatar--img" : ""} ${extraClass}">${avatarInner(user)}</span>`;
    }

    /* fill an existing <span class="avatar"> */
    function paintAvatar(el, user) {
        if (!el) return;
        el.classList.toggle("avatar--img", Boolean(safeAvatarUrl(user && user.avatar)));
        el.innerHTML = avatarInner(user);
    }

    /* broken photo link: fall back to initials */
    document.addEventListener("error", (e) => {
        const img = e.target;
        if (img && img.classList && img.classList.contains("avatar__img")) {
            const host = img.parentElement;
            if (host) { host.classList.remove("avatar--img"); host.textContent = img.dataset.initials || "?"; }
        }
    }, true);

    function duration(seconds) {
        seconds = Math.max(0, Math.round(seconds || 0));
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        if (h) return `${h}h ${m}m`;
        if (m) return s ? `${m}m ${s}s` : `${m}m`;
        return `${s}s`;
    }

    function clock(seconds) {
        seconds = Math.max(0, Math.floor(seconds));
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        const pad = n => String(n).padStart(2, "0");
        return h ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
    }

    function date(value, withTime = true) {
        if (!value) return "";
        const d = new Date(value);
        const opts = { day: "numeric", month: "short", year: "numeric" };
        if (withTime) Object.assign(opts, { hour: "numeric", minute: "2-digit" });
        return d.toLocaleString(undefined, opts);
    }

    function relative(value) {
        if (!value) return "Never";
        const diff = (Date.now() - new Date(value).getTime()) / 1000;
        if (diff < 60) return "Just now";
        if (diff < 3600) return Math.floor(diff / 60) + " min ago";
        if (diff < 86400) return Math.floor(diff / 3600) + " h ago";
        if (diff < 86400 * 7) return Math.floor(diff / 86400) + " d ago";
        return date(value, false);
    }

    function pct(value) {
        const n = Number(value) || 0;
        return (Math.round(n * 10) / 10) + "%";
    }

    function marks(value) {
        const n = Math.round((Number(value) || 0) * 100) / 100;
        return String(n);
    }

    function qs(name) {
        return new URLSearchParams(location.search).get(name);
    }

    /* ---------------- toasts ---------------- */

    function toast(message, type = "info", ms = 3800) {
        let host = document.querySelector(".toasts");
        if (!host) {
            host = document.createElement("div");
            host.className = "toasts";
            host.setAttribute("role", "status");
            host.setAttribute("aria-live", "polite");
            document.body.appendChild(host);
        }
        const icons = { success: "bi-check-circle-fill", error: "bi-exclamation-octagon-fill", warn: "bi-exclamation-triangle-fill", info: "bi-info-circle-fill" };
        const el = document.createElement("div");
        el.className = "toast toast--" + type;
        el.innerHTML = `<i class="bi ${icons[type] || icons.info}"></i><div>${esc(message)}</div>`;
        host.appendChild(el);
        setTimeout(() => {
            el.classList.add("is-leaving");
            setTimeout(() => el.remove(), 260);
        }, ms);
    }

    /* ---------------- modal helpers ---------------- */

    let lastFocus = null;

    function openModal(id) {
        const modal = typeof id === "string" ? document.getElementById(id) : id;
        if (!modal) return;
        lastFocus = document.activeElement;
        modal.classList.add("is-open");
        modal.setAttribute("aria-hidden", "false");
        const focusable = modal.querySelector("[autofocus], input, textarea, select, button:not(.modal-close)");
        /* don't steal focus if the user has already clicked into the dialog */
        setTimeout(() => { if (focusable && !modal.contains(document.activeElement)) focusable.focus(); }, 60);
    }

    function closeModal(id) {
        const modal = typeof id === "string" ? document.getElementById(id) : id;
        if (!modal) return;
        modal.classList.remove("is-open");
        modal.setAttribute("aria-hidden", "true");
        if (lastFocus && lastFocus.focus) lastFocus.focus();
    }

    /* close on backdrop click and Escape */
    document.addEventListener("click", (e) => {
        if (e.target.classList && e.target.classList.contains("modal") && !e.target.dataset.static) closeModal(e.target);
        const closer = e.target.closest && e.target.closest("[data-close-modal]");
        if (closer) closeModal(closer.closest(".modal"));
    });

    document.addEventListener("keydown", (e) => {
        if (e.key !== "Escape") return;
        const open = [...document.querySelectorAll(".modal.is-open")].pop();
        if (open && !open.dataset.static) closeModal(open);
    });

    /* Promise-based confirm dialog */
    function confirmDialog({ title, message, confirmText = "Confirm", cancelText = "Cancel", tone = "primary", html = "" }) {
        return new Promise(resolve => {
            const wrap = document.createElement("div");
            wrap.className = "modal";
            wrap.setAttribute("role", "dialog");
            wrap.setAttribute("aria-modal", "true");
            wrap.innerHTML = `
                <div class="modal__box" style="width:min(460px,100%)">
                    <div class="modal__head"><div><h3>${esc(title)}</h3>${message ? `<p>${esc(message)}</p>` : ""}</div></div>
                    ${html ? `<div class="modal__body">${html}</div>` : `<div style="height:18px"></div>`}
                    <div class="modal__foot">
                        <button class="btn" data-act="cancel" type="button">${esc(cancelText)}</button>
                        <button class="btn btn--${tone}" data-act="ok" type="button">${esc(confirmText)}</button>
                    </div>
                </div>`;
            document.body.appendChild(wrap);
            requestAnimationFrame(() => openModal(wrap));

            const done = (value) => {
                closeModal(wrap);
                document.removeEventListener("keydown", onKey, true);
                setTimeout(() => wrap.remove(), 250);
                resolve(value);
            };
            const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); done(false); } };
            document.addEventListener("keydown", onKey, true);

            wrap.addEventListener("click", (e) => {
                if (e.target === wrap) return done(false);
                const act = e.target.closest("[data-act]");
                if (act) done(act.dataset.act === "ok");
            });
            setTimeout(() => wrap.querySelector('[data-act="ok"]').focus(), 80);
        });
    }

    /* ---------------- button loading state ---------------- */

    function busy(button, on, label) {
        if (!button) return;
        if (on) {
            button.dataset.label = button.innerHTML;
            button.classList.add("is-loading");
            button.setAttribute("aria-busy", "true");
            button.innerHTML = `<span class="spinner"></span>${label ? " " + esc(label) : ""}`;
        } else {
            button.classList.remove("is-loading");
            button.removeAttribute("aria-busy");
            if (button.dataset.label) button.innerHTML = button.dataset.label;
        }
    }

    /* ---------------- background scene ---------------- */

    function scene(photoUrl) {
        if (document.querySelector(".scene")) return;
        const el = document.createElement("div");
        el.className = "scene";
        el.setAttribute("aria-hidden", "true");
        const bubbles = [
            [8, 22, 26, 0], [86, 18, 18, 1], [74, 72, 30, 0], [14, 80, 16, 1], [52, 10, 12, 0]
        ].map(([x, y, s, f], i) =>
            `<span class="scene__bubble${f ? " is-filled" : ""}" style="left:${x}%;top:${y}%;width:${s}px;height:${s}px;animation-delay:-${i * 3.3}s"></span>`
        ).join("");
        el.innerHTML = `
            ${photoUrl ? `<div class="scene__photo" style="background-image:url('${photoUrl}')"></div>` : ""}
            <div class="scene__sheet"></div>
            <div class="scene__glow scene__glow--a"></div>
            <div class="scene__glow scene__glow--b"></div>
            <div class="scene__overlay"></div>
            ${bubbles}`;
        document.body.prepend(el);
    }

    /* ---------------- top navigation for candidate pages ---------------- */

    function nav(active) {
        const user = Session.user();
        if (!user) return;
        const host = document.getElementById("topnav");
        if (!host) return;

        const isAdmin = user.role === "admin";
        const links = isAdmin
            ? [["admin.html", "bi-speedometer2", "Admin portal", "admin"], ["leaderboard.html", "bi-trophy", "Leaderboard", "leaderboard"]]
            : [["home.html", "bi-house", "Home", "home"], ["leaderboard.html", "bi-trophy", "Leaderboard", "leaderboard"], ["profile.html", "bi-graph-up", "My performance", "profile"]];

        host.className = "topnav";
        host.innerHTML = `
            <a class="brand" href="${home(user.role)}" aria-label="Quiz App home">
                <span class="brand__mark"></span><span class="brand__text">Quiz App</span>
            </a>
            <nav class="topnav__links" aria-label="Main">
                ${links.map(([href, icon, label, key]) => `
                    <a class="topnav__link ${key === active ? "is-active" : ""}" href="${href}" ${key === active ? 'aria-current="page"' : ""}>
                        <i class="bi ${icon}"></i><span>${label}</span>
                    </a>`).join("")}
            </nav>
            <div class="topnav__right">
                <button class="btn btn--ghost btn--icon" type="button" data-toggle-theme aria-label="Switch colour theme"><i data-theme-icon></i></button>
                <a class="topnav__user" href="${isAdmin ? "admin.html" : "profile.html#account"}" title="${isAdmin ? "Administrator" : "Your profile and photo"}">
                    ${avatar(user)}
                    <div><strong>${esc(user.name)}</strong><span>${isAdmin ? "Administrator" : "Candidate"}</span></div>
                </a>
                <button class="btn btn--ghost btn--icon" type="button" data-logout aria-label="Log out" title="Log out"><i class="bi bi-box-arrow-right"></i></button>
            </div>`;
        setTheme(getTheme());
    }

    document.addEventListener("click", async (e) => {
        if (e.target.closest("[data-toggle-theme]")) {
            setTheme(getTheme() === "dark" ? "light" : "dark");
        }
        if (e.target.closest("[data-logout]")) {
            const ok = await confirmDialog({ title: "Log out?", message: "You'll need to sign in again to take an examination.", confirmText: "Log out" });
            if (ok) logout();
        }
    });

    document.addEventListener("DOMContentLoaded", () => setTheme(getTheme()));

    /* ---------------- expose ---------------- */

    window.App = {
        Session, api, ApiError, guard, logout, home,
        esc, initials, avatar, paintAvatar, safeAvatarUrl, duration, clock, date, relative, pct, marks, qs,
        toast, openModal, closeModal, confirm: confirmDialog, busy,
        scene, nav, setTheme, getTheme
    };

})();
