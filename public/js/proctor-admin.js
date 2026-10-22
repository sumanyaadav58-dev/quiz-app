/* =========================================================
   LIVE EXAM MONITORING: admin side (used by admin.html, route #live)

   - Socket.IO keeps the list of candidates sitting an exam up to date
     in real time (no page refresh).
   - "View Live" asks the server to connect this admin to one candidate.
     The candidate's browser sends a WebRTC offer, this browser answers,
     and the candidate's camera + microphone play here as a live stream.
   - Only admins get this far: the server rejects non-admin sockets for
     every monitoring event, and admin.html redirects non-admins.
========================================================= */

window.LiveMonitor = (function () {

    const $ = (id) => document.getElementById(id);
    const esc = App.esc;

    const state = {
        socket: null,
        connected: false,
        sessions: new Map(),        /* sessionId -> public session */
        recentEnded: [],            /* [{ ...session, endedAt, reason }] from this browser session */
        view: null,                 /* element when the #live route is showing */
        tick: null,
        monitor: null               /* { sessionId, pc, stream, pendingIce, audio, retryTimer } */
    };

    /* ---------------- status helpers ---------------- */

    function examStatus(s) {
        if (s.connection !== "connected") return { cls: "sdot--off", text: "Disconnected" };
        if (!s.camera || !s.mic) return { cls: "sdot--warn", text: "Warning" };
        return { cls: "sdot--on is-pulse", text: "Exam in progress" };
    }

    const dot = (on, onText = "Active", offText = "Off") =>
        `<span class="sdot ${on ? "sdot--on" : "sdot--off"}">${on ? onText : offText}</span>`;

    function timeLeft(s) {
        const left = Math.max(0, Math.floor((new Date(s.expiresAt).getTime() - Date.now()) / 1000));
        return App.clock(left);
    }

    /* ---------------- socket ---------------- */

    function connect() {
        if (state.socket || typeof io !== "function") {
            if (typeof io !== "function") console.warn("Socket.IO client not loaded: live monitoring is unavailable.");
            return;
        }
        const socket = io({ auth: { token: App.Session.token() }, reconnectionDelayMax: 5000 });
        state.socket = socket;

        socket.on("connect", () => { state.connected = true; paintSocket(); });
        socket.on("disconnect", () => {
            state.connected = false;
            paintSocket();
            if (state.monitor) showOverlay("bi-wifi-off", "Connection to the server was lost. Reconnecting...");
        });
        socket.on("connect_error", (err) => {
            state.connected = false;
            paintSocket(err && err.message);
        });

        socket.on("exam-sessions", (list) => {
            state.sessions = new Map((list || []).map(s => [s.sessionId, s]));
            refresh();
            /* reconnected while watching: ask for the stream again */
            if (state.monitor) restartMonitor();
        });

        socket.on("exam-user-update", (s) => {
            const before = state.sessions.get(s.sessionId);
            state.sessions.set(s.sessionId, s);
            refresh(s.sessionId);
            if (state.monitor && state.monitor.sessionId === s.sessionId) {
                paintMonitorStatus();
                /* candidate came back online while the viewer is open */
                if (before && before.connection !== "connected" && s.connection === "connected") restartMonitor();
            }
            if (before && before.connection === "connected" && s.connection !== "connected") {
                App.toast(`${s.userName} disconnected from ${s.quizTitle}`, "warn");
            } else if (before && (before.camera && !s.camera)) {
                App.toast(`${s.userName}: camera turned off`, "warn");
            } else if (before && (before.mic && !s.mic)) {
                App.toast(`${s.userName}: microphone turned off`, "warn");
            } else if (!before) {
                App.toast(`${s.userName} started ${s.quizTitle}`, "info");
            }
        });

        socket.on("exam-ended", ({ sessionId, reason }) => {
            const s = state.sessions.get(sessionId);
            state.sessions.delete(sessionId);
            if (s) {
                state.recentEnded.unshift({ ...s, endedAt: new Date().toISOString(), reason });
                state.recentEnded = state.recentEnded.slice(0, 10);
            }
            refresh();
            if (state.monitor && state.monitor.sessionId === sessionId) {
                teardownPeer();
                const why = reason === "time-up" ? "Time ran out and the exam was submitted." : reason === "submitted" ? "The candidate submitted the exam." : "The candidate left the exam.";
                showOverlay("bi-check2-circle", why + " Camera and microphone are now off.");
                paintMonitorStatus(true);
            }
        });

        socket.on("candidate-offline", ({ sessionId, reason }) => {
            if (!state.monitor || state.monitor.sessionId !== sessionId) return;
            teardownPeer();
            if (reason !== "ended") showOverlay("bi-wifi-off", "The candidate's connection dropped (closed the browser, lost the network, or reloaded). The stream will resume automatically if they reconnect.");
        });

        socket.on("webrtc-offer", onOffer);
        socket.on("ice-candidate", onIce);
    }

    function paintSocket(error) {
        const el = $("liveSocket");
        if (!el) return;
        if (state.connected) {
            el.className = "sdot sdot--on live-socket";
            el.textContent = "Real-time updates on";
        } else {
            el.className = "sdot sdot--warn live-socket";
            el.textContent = error === "AUTH_INVALID" ? "Not authorised. Log in again." : "Connecting...";
        }
    }

    /* ---------------- counts outside the live page ---------------- */

    function paintCounts() {
        const n = state.sessions.size;
        const nav = $("navLive");
        if (nav) nav.textContent = n ? n : "";
        const warn = [...state.sessions.values()].filter(s => examStatus(s).text !== "Exam in progress").length;
        const navDot = $("navLiveDot");
        if (navDot) navDot.classList.toggle("hidden", !warn);
    }

    /* ---------------- #live page ---------------- */

    function render(view, isStale) {
        state.view = view;
        view.innerHTML = `
        <div class="aview">
            <div class="live-head">
                <div class="live-head__stats" id="liveStats"></div>
                <span class="sdot sdot--warn live-socket" id="liveSocket">Connecting...</span>
            </div>

            <div class="panel" style="padding:6px 8px;margin-bottom:20px">
                <div class="table-wrap" id="liveTable"></div>
            </div>

            <div class="panel panel--pad">
                <div class="panel__head"><div><h3>Recently ended</h3><p>Sessions that finished recently. Only status history is kept, never video or audio.</p></div></div>
                <div class="table-wrap" id="liveRecent"><div class="skeleton" style="height:80px"></div></div>
            </div>
        </div>`;
        paintSocket();
        drawTable();
        loadRecent(isStale);

        clearInterval(state.tick);
        state.tick = setInterval(() => {
            if (!document.body.contains(view.querySelector("#liveTable"))) {
                clearInterval(state.tick);
                state.view = null;
                return;
            }
            view.querySelectorAll("[data-left]").forEach(el => {
                const s = state.sessions.get(el.dataset.left);
                if (s) el.textContent = timeLeft(s);
            });
        }, 1000);

        /* ask again in case this socket connected before the page rendered */
        if (state.socket && state.connected) state.socket.emit("monitor-list", null, (list) => {
            state.sessions = new Map((list || []).map(s => [s.sessionId, s]));
            refresh();
        });
    }

    function isShowing() {
        return state.view && state.view.querySelector("#liveTable");
    }

    function refresh(flashId) {
        paintCounts();
        if (isShowing()) drawTable(flashId);
    }

    function drawTable(flashId) {
        const host = $("liveTable");
        if (!host) return;
        const list = [...state.sessions.values()].sort((a, b) => new Date(a.startedAt) - new Date(b.startedAt));

        const all = list.length;
        const ok = list.filter(s => examStatus(s).text === "Exam in progress").length;
        const warn = list.filter(s => examStatus(s).text === "Warning").length;
        const off = list.filter(s => s.connection !== "connected").length;
        $("liveStats").innerHTML = `
            <span class="live-pill"><i class="bi bi-people"></i> <b>${all}</b> sitting now</span>
            <span class="live-pill"><span class="sdot sdot--on"></span><b>${ok}</b> all good</span>
            <span class="live-pill"><span class="sdot sdot--warn"></span><b>${warn}</b> camera or mic off</span>
            <span class="live-pill"><span class="sdot sdot--off"></span><b>${off}</b> disconnected</span>`;

        if (!list.length) {
            host.innerHTML = `<div class="empty"><i class="bi bi-camera-video"></i><strong>No one is sitting an exam right now</strong>Candidates appear here the moment they start a proctored exam and allow their camera and microphone.</div>`;
            return;
        }

        host.innerHTML = `
            <table class="table live-table">
                <thead><tr><th>Candidate</th><th>Examination</th><th>Camera</th><th>Microphone</th><th>Status</th><th>Connection</th><th class="t-right">Action</th></tr></thead>
                <tbody>
                ${list.map(s => {
                    const st = examStatus(s);
                    return `
                    <tr data-sid="${esc(s.sessionId)}" class="${flashId === s.sessionId ? "is-flash" : ""}">
                        <td><div class="who">${App.avatar({ name: s.userName, avatar: s.avatar })}<div><strong>${esc(s.userName)}</strong><span class="live-id" title="Candidate ID">ID ${esc(s.userId)}</span></div></div></td>
                        <td><strong>${esc(s.quizTitle)}</strong><div class="faint" style="font-size:.78rem">Started ${esc(App.date(s.startedAt))} | <span class="num" data-left="${esc(s.sessionId)}">${timeLeft(s)}</span> left</div></td>
                        <td>${dot(s.camera)}</td>
                        <td>${dot(s.mic)}</td>
                        <td><span class="sdot ${st.cls}">${st.text}</span></td>
                        <td><div class="live-conn">${dot(s.connection === "connected", "Connected", "Disconnected")}${s.viewers ? `<span class="badge badge--red" title="Admins watching"><i class="bi bi-eye"></i> ${s.viewers}</span>` : ""}</div></td>
                        <td class="t-right"><button class="btn btn--primary btn--sm" type="button" data-view-live="${esc(s.sessionId)}" ${s.connection === "connected" ? "" : 'title="The candidate is offline right now"'}><i class="bi bi-camera-video"></i> View Live</button></td>
                    </tr>`;
                }).join("")}
                </tbody>
            </table>`;
    }

    async function loadRecent(isStale) {
        try {
            const { recent } = await App.api("/api/admin/proctor/sessions?limit=15");
            if ((isStale && isStale()) || !$("liveRecent")) return;
            $("liveRecent").innerHTML = recent.length ? `
                <table class="table">
                    <thead><tr><th>Candidate</th><th>Examination</th><th>Started</th><th>Ended</th><th>How it ended</th></tr></thead>
                    <tbody>${recent.map(r => `
                        <tr>
                            <td><strong>${esc(r.userName)}</strong><div class="live-id">ID ${esc(r.userId)}</div></td>
                            <td>${esc(r.quizTitle)}</td>
                            <td>${esc(App.date(r.startedAt))}</td>
                            <td>${esc(App.date(r.endedAt))}</td>
                            <td><span class="badge ${r.endReason === "submitted" ? "badge--green" : r.endReason === "time-up" ? "badge--amber" : ""}">${esc({ submitted: "Submitted", "time-up": "Time up", left: "Left", removed: "Removed" }[r.endReason] || r.endReason || "Ended")}</span></td>
                        </tr>`).join("")}</tbody>
                </table>` : `<div class="empty" style="padding:24px"><i class="bi bi-clock-history"></i><strong>Nothing yet</strong>Finished proctored sessions are listed here.</div>`;
        } catch (e) {
            if ($("liveRecent")) $("liveRecent").innerHTML = `<p class="muted" style="padding:12px">${esc(e.message)}</p>`;
        }
    }

    document.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-view-live]");
        if (btn) openMonitor(btn.dataset.viewLive);
        if (e.target.closest("#monitorClose") || e.target.closest("#monitorCloseX")) closeMonitor();
        if (e.target.closest("#monitorPlay")) playRemote(true);
        if (e.target.closest("#monitorMute")) toggleMute();
    });

    /* ---------------- viewer modal ---------------- */

    function openMonitor(sessionId) {
        const s = state.sessions.get(sessionId);
        if (!s) return App.toast("This candidate is no longer sitting the exam.", "warn");
        if (state.monitor) closeMonitor(true);

        state.monitor = { sessionId, pc: null, stream: null, pendingIce: [], audio: null, muted: false };

        $("monitorName").textContent = s.userName;
        App.paintAvatar($("monitorAvatar"), { name: s.userName, avatar: s.avatar });
        $("monitorExam").textContent = s.quizTitle;
        $("monitorId").textContent = "ID " + s.userId;
        $("monitorVideo").srcObject = null;
        $("monitorBadge").classList.add("hidden");
        $("monitorPlay").classList.add("hidden");
        $("monitorVolume").value = 1;
        setMuteIcon(false);
        paintMonitorStatus();
        App.openModal("monitorModal");
        requestStream();
    }

    function requestStream() {
        const m = state.monitor;
        if (!m) return;
        const s = state.sessions.get(m.sessionId);
        if (!state.connected) return showOverlay("bi-wifi-off", "Not connected to the server yet. Retrying...");
        if (s && s.connection !== "connected") return showOverlay("bi-wifi-off", "The candidate is offline right now. The stream starts automatically when they reconnect.");

        showOverlay(null, "Connecting to the candidate's camera...");
        state.socket.emit("monitor-start", { sessionId: m.sessionId }, (res) => {
            if (!state.monitor || state.monitor.sessionId !== m.sessionId) return;
            if (!res || !res.ok) return showOverlay("bi-exclamation-circle", (res && res.message) || "Couldn't start live monitoring.");
            m.iceServers = res.iceServers;
            /* no video after 15 s usually means a firewall is blocking WebRTC */
            clearTimeout(m.slowTimer);
            m.slowTimer = setTimeout(() => {
                if (state.monitor === m && !m.stream) showOverlay("bi-hourglass-split", "Still connecting. If this doesn't change, a firewall may be blocking WebRTC between you and the candidate. Set TURN_URL in .env (see README, Troubleshooting).");
            }, 15000);
        });
    }

    function restartMonitor() {
        const m = state.monitor;
        if (!m) return;
        teardownPeer();
        clearTimeout(m.retryTimer);
        m.retryTimer = setTimeout(requestStream, 600);
    }

    async function onOffer({ sessionId, sdp }) {
        const m = state.monitor;
        if (!m || m.sessionId !== sessionId || !sdp) return;
        teardownPeer();

        const pc = new RTCPeerConnection({ iceServers: m.iceServers || [{ urls: "stun:stun.l.google.com:19302" }] });
        m.pc = pc;
        m.pendingIce = [];

        pc.ontrack = (e) => {
            const stream = e.streams[0] || new MediaStream([e.track]);
            if (m.stream !== stream) {
                m.stream = stream;
                $("monitorVideo").srcObject = stream;
            }
            if (e.track.kind === "audio") startRemoteMeter(stream);
            playRemote(false);
        };
        pc.onicecandidate = (e) => {
            state.socket.emit("ice-candidate", { sessionId, candidate: e.candidate ? e.candidate.toJSON() : null });
        };
        pc.onconnectionstatechange = () => {
            if (state.monitor !== m || m.pc !== pc) return;
            paintMonitorStatus();
            if (pc.connectionState === "connected") {
                hideOverlay();
                $("monitorBadge").classList.remove("hidden");
            } else if (pc.connectionState === "failed") {
                showOverlay("bi-exclamation-triangle", "The live connection failed. Retrying... If it keeps failing, a firewall is probably blocking WebRTC. Set TURN_URL in .env.");
                restartMonitor();
            } else if (pc.connectionState === "disconnected") {
                showOverlay(null, "Connection interrupted. Waiting for it to recover...");
            }
        };

        try {
            await pc.setRemoteDescription(sdp);
            for (const c of m.pendingIce.splice(0)) await pc.addIceCandidate(c).catch(() => {});
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            state.socket.emit("webrtc-answer", { sessionId, sdp: pc.localDescription.toJSON ? pc.localDescription.toJSON() : pc.localDescription });
        } catch (error) {
            console.error("WebRTC answer failed:", error);
            showOverlay("bi-exclamation-triangle", "Couldn't open the live stream. Close this window and try View Live again.");
        }
    }

    async function onIce({ sessionId, candidate }) {
        const m = state.monitor;
        if (!m || m.sessionId !== sessionId || !candidate) return;
        if (!m.pc || !m.pc.remoteDescription) m.pendingIce.push(candidate);
        else await m.pc.addIceCandidate(candidate).catch(() => {});
    }

    /* Browsers may block sound until you interact; the View Live click
       usually counts, otherwise we show a "Play sound" button. */
    function playRemote(fromClick) {
        const video = $("monitorVideo");
        const m = state.monitor;
        video.muted = Boolean(m && m.muted);
        video.volume = Number($("monitorVolume").value);
        video.play().then(() => {
            $("monitorPlay").classList.add("hidden");
            if (m && m.audio) m.audio.ctx.resume().catch(() => {});
        }).catch(() => {
            /* play the picture silently and offer a button for the sound */
            video.muted = true;
            video.play().catch(() => {});
            $("monitorPlay").classList.remove("hidden");
            if (fromClick) App.toast("Your browser blocked audio. Click the page once, then Play sound.", "warn");
        });
    }

    function toggleMute() {
        const m = state.monitor;
        if (!m) return;
        m.muted = !m.muted;
        $("monitorVideo").muted = m.muted;
        setMuteIcon(m.muted);
    }

    function setMuteIcon(muted) {
        const b = $("monitorMute");
        b.innerHTML = `<i class="bi ${muted ? "bi-volume-mute" : "bi-volume-up"}"></i>`;
        b.setAttribute("aria-label", muted ? "Unmute candidate audio" : "Mute candidate audio");
        b.title = muted ? "Unmute" : "Mute";
    }

    document.addEventListener("input", (e) => {
        if (e.target.id === "monitorVolume") {
            $("monitorVideo").volume = Number(e.target.value);
        }
    });

    /* level meter for the incoming audio (shows audio is arriving even when muted) */
    function startRemoteMeter(stream) {
        const m = state.monitor;
        if (!m || m.audio) return;
        try {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (!Ctx || !stream.getAudioTracks().length) return;
            const ctx = new Ctx();
            const src = ctx.createMediaStreamSource(stream);
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 256;
            src.connect(analyser);
            const data = new Uint8Array(analyser.frequencyBinCount);
            m.audio = { ctx, src, raf: 0 };
            const bar = $("monitorLevel");
            const loop = () => {
                if (!state.monitor || state.monitor.audio !== m.audio) return;
                analyser.getByteTimeDomainData(data);
                let peak = 0;
                for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i] - 128));
                bar.style.width = Math.min(100, peak / 64 * 100) + "%";
                m.audio.raf = requestAnimationFrame(loop);
            };
            ctx.resume().catch(() => {});
            loop();
        } catch (e) { /* cosmetic only */ }
    }

    function paintMonitorStatus(ended) {
        const m = state.monitor;
        if (!m) return;
        const s = state.sessions.get(m.sessionId);
        const pcState = m.pc ? m.pc.connectionState : "new";
        const camOn = Boolean(s && s.camera) && !ended;
        const micOn = Boolean(s && s.mic) && !ended;
        $("monitorCam").innerHTML = `<i class="bi bi-camera-video"></i> Camera: ${dot(camOn)}`;
        $("monitorMic").innerHTML = `<i class="bi bi-mic"></i> Microphone: ${dot(micOn)}`;

        let conn;
        if (ended || !s) conn = `<span class="sdot sdot--idle">Exam ended</span>`;
        else if (s.connection !== "connected") conn = `<span class="sdot sdot--off">Candidate offline</span>`;
        else if (pcState === "connected") conn = `<span class="sdot sdot--on is-pulse">Connected</span>`;
        else if (pcState === "failed") conn = `<span class="sdot sdot--off">Failed</span>`;
        else conn = `<span class="sdot sdot--warn">Connecting</span>`;
        $("monitorConn").innerHTML = `<i class="bi bi-broadcast"></i> Connection: ${conn}`;
        $("monitorConnTop").innerHTML = conn;
    }

    function showOverlay(icon, text) {
        const o = $("monitorOverlay");
        o.classList.remove("hidden");
        o.innerHTML = `<div>${icon ? `<i class="bi ${icon}"></i>` : `<div class="spinner"></div>`}${esc(text)}</div>`;
        $("monitorBadge").classList.add("hidden");
        paintMonitorStatus();
    }

    function hideOverlay() {
        $("monitorOverlay").classList.add("hidden");
    }

    function teardownPeer() {
        const m = state.monitor;
        if (!m) return;
        clearTimeout(m.slowTimer);
        if (m.pc) { try { m.pc.close(); } catch (e) { /* ignore */ } }
        m.pc = null;
        m.stream = null;
        m.pendingIce = [];
        if (m.audio) {
            cancelAnimationFrame(m.audio.raf);
            m.audio.ctx.close().catch(() => {});
            m.audio = null;
        }
        const video = $("monitorVideo");
        if (video) video.srcObject = null;
        const bar = $("monitorLevel");
        if (bar) bar.style.width = "0";
    }

    function closeMonitor(keepModal) {
        const m = state.monitor;
        if (!m) return;
        clearTimeout(m.retryTimer);
        teardownPeer();
        if (state.socket && state.connected) state.socket.emit("monitor-stop", { sessionId: m.sessionId });
        state.monitor = null;
        if (!keepModal) App.closeModal("monitorModal");
    }

    /* Escape / backdrop closes the modal through core.js: stop the stream too */
    new MutationObserver(() => {
        const modal = $("monitorModal");
        if (modal && !modal.classList.contains("is-open") && state.monitor) closeMonitor(true);
    }).observe(document.getElementById("monitorModal"), { attributes: true, attributeFilter: ["class"] });

    window.addEventListener("beforeunload", () => closeMonitor(true));

    return { connect, render, sessions: () => [...state.sessions.values()] };
})();
