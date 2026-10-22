/* =========================================================
   SOCIAL SIGN-IN helpers (login page + profile page)
   Google: Google Identity Services button. The browser gets a signed
   ID token from Google and the server verifies it with google-auth-library.
   Needs GOOGLE_CLIENT_ID in .env. Without it, the button explains how
   to switch it on instead of failing silently.
========================================================= */

window.Social = (function () {

    let configPromise = null;
    let gisPromise = null;
    let handler = null;     /* what to do with the next Google credential */
    let initialised = false;

    function config() {
        if (!configPromise) {
            configPromise = App.api("/api/auth/config", { allowUnauthorized: true })
                .catch(() => ({ googleClientId: "", emailCode: true, emailDelivery: "console" }));
        }
        return configPromise;
    }

    function loadGis() {
        if (window.google && window.google.accounts && window.google.accounts.id) return Promise.resolve();
        if (!gisPromise) {
            gisPromise = new Promise((resolve, reject) => {
                const s = document.createElement("script");
                s.src = "https://accounts.google.com/gsi/client";
                s.async = true;
                s.defer = true;
                s.onload = () => resolve();
                s.onerror = () => { gisPromise = null; reject(new Error("Couldn't load Google sign-in. Check your internet connection.")); };
                document.head.appendChild(s);
            });
        }
        return gisPromise;
    }

    const GOOGLE_SVG = `<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>`;

    /* Renders a Google button into `host`. onCredential(credential) is called after the user picks an account. */
    async function googleButton(host, onCredential, { text = "continue_with", width } = {}) {
        if (!host) return;
        const cfg = await config();

        if (!cfg.googleClientId) {
            /* not configured: show a look-alike button that explains how to enable it */
            const label = { signin_with: "Sign in with Google", signup_with: "Sign up with Google", continue_with: "Continue with Google" }[text] || "Continue with Google";
            host.innerHTML = `<button type="button" class="btn btn--block social-btn" data-google-off>${GOOGLE_SVG}<span>${label}</span></button>`;
            host.querySelector("[data-google-off]").addEventListener("click", () => {
                App.confirm({
                    title: "Google sign-in isn't switched on yet",
                    message: "",
                    html: `<p class="muted" style="font-size:.92rem">The server needs a Google OAuth Client ID. It takes about 5 minutes:</p>
                           <ol style="margin:10px 0 0 18px;font-size:.9rem;line-height:1.6">
                             <li>Open <b>console.cloud.google.com</b> &gt; APIs &amp; Services &gt; Credentials.</li>
                             <li>Create an <b>OAuth client ID</b> of type <b>Web application</b>.</li>
                             <li>Add <b>http://localhost:3000</b> under Authorised JavaScript origins.</li>
                             <li>Put the Client ID in <b>.env</b> as <code>GOOGLE_CLIENT_ID=...</code> and restart the server.</li>
                           </ol>
                           <p class="faint" style="font-size:.84rem;margin-top:10px">Until then, use your email and password, or a one-time email code.</p>`,
                    confirmText: "Got it",
                    cancelText: "Close"
                });
            });
            return;
        }

        try {
            await loadGis();
        } catch (error) {
            host.innerHTML = `<button type="button" class="btn btn--block social-btn" disabled>${GOOGLE_SVG}<span>Google unavailable offline</span></button>`;
            return;
        }

        if (!initialised) {
            window.google.accounts.id.initialize({
                client_id: cfg.googleClientId,
                callback: (resp) => { if (handler && resp && resp.credential) handler(resp.credential); },
                ux_mode: "popup",
                auto_select: false,
                cancel_on_tap_outside: true
            });
            initialised = true;
        }

        host.innerHTML = "";
        const theme = document.documentElement.getAttribute("data-theme") === "light" ? "outline" : "filled_black";
        window.google.accounts.id.renderButton(host, {
            type: "standard",
            theme,
            size: "large",
            text,
            shape: "pill",
            logo_alignment: "left",
            width: width || Math.min(400, Math.max(220, host.clientWidth || 320))
        });
        /* one Google action per page (sign in on the login page, connect on the profile page) */
        handler = onCredential;
    }

    return { config, googleButton, GOOGLE_SVG };
})();
