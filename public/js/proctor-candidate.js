/* =========================================================
   LIVE PROCTORING: candidate side (used by quiz.html)

   1. requestMedia()  asks the browser for camera + microphone.
                      Nothing starts without the candidate's permission.
   2. start(attempt)  shows the preview, connects to Socket.IO and
                      reports camera / mic status in real time.
   3. When an admin clicks "View Live", the server sends monitor-request.
      This browser creates one RTCPeerConnection for that admin, adds the
      camera and microphone tracks, and sends a WebRTC offer. The admin
      answers, ICE candidates are exchanged, and the live stream flows
      directly between the two browsers. Each admin gets their own
      connection, so streams never mix.
   4. stop(reason)    on submit: stops camera + mic, closes every
                      connection and tells the admin panel the exam ended.
========================================================= */

window.Proctor = (function () {

    const DEFAULT_ICE = [{ urls: "stun:stun.l.google.com:19302" }];

    const state = {
        stream: null,
        socket: null,
        sessionId: null,
        iceServers: DEFAULT_ICE,
        peers: new Map(),          /* adminSocketId -> { pc, pendingIce: [] } */
        perms: { camera: "unknown", mic: "unknown" },
        last: { camera: null, mic: null },
        statusTimer: null,
        audio: null,               /* { ctx, analyser, data, raf } */
        stopped: false,
        joined: false,
        viewers: 0
    };

    const $ = (id) => document.getElementById(id);

    /* ---------------- 1. permission ---------------- */

    class MediaError extends Error {
        constructor(code, message, detail) {
            super(message);
            this.code = code;
            this.detail = detail || "";
        }
    }

    function secureContextOk() {
        return window.isSecureContext && navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === "function";
    }

    async function permissionState(name) {
        try {
            const res = await navigator.permissions.query({ name });
            return res.state; /* granted | denied | prompt */
        } catch (e) {
            return "unknown";   /* Firefox / Safari don't support querying camera or microphone */
        }
    }

    async function requestMedia() {
        if (!secureContextOk()) {
            throw new MediaError(
                "INSECURE",
                "Your browser blocks the camera on this connection.",
                "Camera and microphone only work on https:// sites or on http://localhost. Open the exam with the secure address your institution gave you."
            );
        }

        try {
            state.stream = await navigator.mediaDevices.getUserMedia({
                video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15, max: 24 }, facingMode: "user" },
                audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
            });
        } catch (error) {
            const [cam, mic] = await Promise.all([permissionState("camera"), permissionState("microphone")]);
            state.perms.camera = cam === "denied" ? "denied" : state.perms.camera;
            state.perms.mic = mic === "denied" ? "denied" : state.perms.mic;

            const name = error && error.name;
            if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") {
                let which = "camera and microphone";
                if (cam === "denied" && mic !== "denied") which = "camera";
                if (mic === "denied" && cam !== "denied") which = "microphone";
                throw new MediaError("DENIED", `Access to your ${which} was blocked.`, which);
            }
            if (name === "NotFoundError" || name === "DevicesNotFoundError") {
                throw new MediaError("NOT_FOUND", "We couldn't find a camera or microphone.", "Connect a webcam and a microphone (or a headset), then try again.");
            }
            if (name === "NotReadableError" || name === "TrackStartError") {
                throw new MediaError("IN_USE", "Your camera or microphone is being used by another app.", "Close Zoom, Teams, Meet or any other app using the camera, then try again.");
            }
            throw new MediaError("UNKNOWN", "The camera or microphone couldn't start.", (error && error.message) || "");
        }

        const v = state.stream.getVideoTracks()[0];
        const a = state.stream.getAudioTracks()[0];
        if (!v || !a) {
            stopTracks();
            throw new MediaError("NOT_FOUND", !v ? "No camera was found." : "No microphone was found.", "Both a camera and a microphone are required for this examination.");
        }

        state.perms.camera = "granted";
        state.perms.mic = "granted";
        return state.stream;
    }

    /* help text shown under the error, by browser */
    function deniedHelpHtml(which) {
        const ua = navigator.userAgent;
        const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) && !/Chrome\//.test(ua) ? "Safari" : "Chrome";
        const steps = {
            Chrome: ["Click the camera icon (or the tune icon) at the left of the address bar.", `Set Camera and Microphone to <b>Allow</b>.`, "Click <b>Try again</b> below. Reload the page if it still fails."],
            Edge: ["Click the lock icon at the left of the address bar.", "Open <b>Permissions for this site</b> and set Camera and Microphone to <b>Allow</b>.", "Click <b>Try again</b> below."],
            Firefox: ["Click the crossed-out camera icon in the address bar.", "Remove the <b>Blocked</b> entries for camera and microphone.", "Click <b>Try again</b> and choose <b>Allow</b>."],
            Safari: ["Open <b>Safari &gt; Settings for this website</b>.", "Set Camera and Microphone to <b>Allow</b>.", "Click <b>Try again</b> below."]
        }[browser];
        return `<div class="perm-help"><strong>To allow your ${which} in ${browser}:</strong><ol>${steps.map(s => `<li>${s}</li>`).join("")}</ol></div>`;
    }

    /* ---------------- 2. live session ---------------- */

    function videoTrack() { return state.stream && state.stream.getVideoTracks()[0]; }
    function audioTrack() { return state.stream && state.stream.getAudioTracks()[0]; }

    function isLive(track) {
        return Boolean(track && track.readyState === "live" && track.enabled && !track.muted);
    }

    function currentStatus() {
        return { camera: isLive(videoTrack()), mic: isLive(audioTrack()) };
    }

    function start(attemptId) {
        state.sessionId = String(attemptId);
        state.stopped = false;
        showPreview();
        watchTracks();
        startLevelMeter();
        connect();
        state.statusTimer = setInterval(reportStatus, 2000);
    }

    function showPreview() {
        const box = $("pcam");
        if (!box) return;
        box.classList.remove("hidden");
        /* phones: start as a small video-only tile so it covers less of the question */
        if (window.matchMedia("(max-width: 600px)").matches) {
            box.classList.add("is-min");
            $("pcamToggle").innerHTML = '<i class="bi bi-arrows-angle-expand"></i>';
            $("pcamToggle").setAttribute("aria-label", "Show camera details");
        }
        const video = $("pcamVideo");
        video.srcObject = state.stream;
        video.muted = true;  /* never play your own microphone back */
        video.play().catch(() => {});
        paint();
    }

    function watchTracks() {
        [videoTrack(), audioTrack()].forEach(track => {
            if (!track || track._proctorWatched) return;
            track._proctorWatched = true;
            track.addEventListener("ended", () => { reportStatus(); paint(); });
            track.addEventListener("mute", () => { reportStatus(); paint(); });
            track.addEventListener("unmute", () => { reportStatus(); paint(); });
        });
    }

    function reportStatus(force) {
        if (state.stopped) return;
        const s = currentStatus();
        const changed = s.camera !== state.last.camera || s.mic !== state.last.mic;
        if (changed && state.last.camera !== null) {
            if (!s.camera && state.last.camera) App.toast("Your camera stopped. The proctor can see this. Use 'Turn camera back on'.", "error", 7000);
            if (!s.mic && state.last.mic) App.toast("Your microphone stopped. The proctor can see this.", "error", 7000);
        }
        state.last = s;
        if ((changed || force) && state.socket && state.socket.connected && state.joined) {
            state.socket.emit("media-status", s);
        }
        paint();
    }

    function paint() {
        const s = currentStatus();
        const connected = state.socket && state.socket.connected && state.joined;
        const set = (id, on, onText, offText) => {
            const el = $(id);
            if (!el) return;
            el.className = "sdot " + (on ? "sdot--on" : "sdot--off");
            el.textContent = on ? onText : offText;
        };
        set("pcamCam", s.camera, "Active", "Off");
        set("pcamMic", s.mic, "Active", "Off");
        const conn = $("pcamConn");
        if (conn) {
            conn.className = "sdot " + (connected ? "sdot--on" : "sdot--warn");
            conn.textContent = connected ? "Connected" : "Reconnecting";
        }
        const off = $("pcamOff");
        if (off) off.classList.toggle("hidden", s.camera);
        const retry = $("pcamRetry");
        if (retry) retry.classList.toggle("hidden", s.camera && s.mic);
        const live = $("pcamLive");
        if (live) live.classList.toggle("hidden", !state.viewers);
    }

    /* green bar that moves with your voice, so you can see the mic works */
    function startLevelMeter() {
        try {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (!Ctx || !audioTrack()) return;
            const ctx = new Ctx();
            const src = ctx.createMediaStreamSource(new MediaStream([audioTrack()]));
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 256;
            src.connect(analyser);
            const data = new Uint8Array(analyser.frequencyBinCount);
            state.audio = { ctx, analyser, data, src };
            const bar = $("pcamLevel");
            const loop = () => {
                if (!state.audio) return;
                analyser.getByteTimeDomainData(data);
                let peak = 0;
                for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i] - 128));
                if (bar) bar.style.width = Math.min(100, peak / 64 * 100) + "%";
                state.audio.raf = requestAnimationFrame(loop);
            };
            ctx.resume().catch(() => {});
            loop();
        } catch (e) { /* meter is cosmetic only */ }
    }

    function stopLevelMeter() {
        if (!state.audio) return;
        cancelAnimationFrame(state.audio.raf);
        try { state.audio.src.disconnect(); } catch (e) { /* ignore */ }
        state.audio.ctx.close().catch(() => {});
        state.audio = null;
    }

    /* ---------------- Socket.IO ---------------- */

    function connect() {
        if (typeof io !== "function") {
            App.toast("Live monitoring couldn't load. Your exam continues; tell the invigilator.", "error", 8000);
            return;
        }
        const socket = io({ auth: { token: App.Session.token() }, reconnection: true, reconnectionDelay: 1000, reconnectionDelayMax: 5000 });
        state.socket = socket;

        socket.on("connect", join);
        socket.on("disconnect", () => {
            state.joined = false;
            closeAllPeers();
            paint();
        });
        socket.on("connect_error", (err) => {
            state.joined = false;
            paint();
            if (err && (err.message === "AUTH_INVALID" || err.message === "ACCOUNT_DISABLED")) socket.disconnect();
        });

        socket.on("monitor-request", ({ viewerId }) => offerTo(viewerId));
        socket.on("webrtc-answer", onAnswer);
        socket.on("ice-candidate", onRemoteIce);
        socket.on("monitor-stop", ({ viewerId }) => closePeer(viewerId));
        socket.on("viewers", ({ count }) => { state.viewers = count || 0; paint(); });
        socket.on("session-replaced", () => {
            App.toast("This examination was opened in another tab or window. Live monitoring moved there.", "warn", 8000);
            state.joined = false;
            closeAllPeers();
            socket.disconnect();
            paint();
        });
    }

    function join() {
        const s = currentStatus();
        state.socket.emit("join-exam", {
            attemptId: state.sessionId,
            camera: s.camera,
            mic: s.mic,
            cameraPermission: state.perms.camera,
            micPermission: state.perms.mic
        }, (res) => {
            if (!res || !res.ok) {
                state.joined = false;
                paint();
                return;
            }
            state.joined = true;
            if (Array.isArray(res.iceServers) && res.iceServers.length) state.iceServers = res.iceServers;
            state.last = s;
            paint();
        });
    }

    /* ---------------- WebRTC (one connection per watching admin) ---------------- */

    async function offerTo(viewerId) {
        if (!viewerId || !state.stream || state.stopped) return;
        closePeer(viewerId);

        const pc = new RTCPeerConnection({ iceServers: state.iceServers });
        const entry = { pc, pendingIce: [] };
        state.peers.set(viewerId, entry);

        state.stream.getTracks().forEach(track => pc.addTrack(track, state.stream));

        pc.onicecandidate = (e) => {
            state.socket.emit("ice-candidate", { to: viewerId, candidate: e.candidate ? e.candidate.toJSON() : null });
        };
        pc.onconnectionstatechange = () => {
            if (pc.connectionState === "failed" || pc.connectionState === "closed") closePeer(viewerId);
        };

        try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            state.socket.emit("webrtc-offer", { to: viewerId, sdp: pc.localDescription.toJSON ? pc.localDescription.toJSON() : pc.localDescription });
        } catch (error) {
            console.error("Could not create the live stream offer:", error);
            closePeer(viewerId);
        }
    }

    async function onAnswer({ from, sdp }) {
        const entry = state.peers.get(from);
        if (!entry || !sdp) return;
        try {
            await entry.pc.setRemoteDescription(sdp);
            for (const c of entry.pendingIce.splice(0)) await entry.pc.addIceCandidate(c).catch(() => {});
        } catch (error) {
            console.error("Could not apply the admin's answer:", error);
        }
    }

    async function onRemoteIce({ from, candidate }) {
        const entry = state.peers.get(from);
        if (!entry || !candidate) return;
        if (!entry.pc.remoteDescription) entry.pendingIce.push(candidate);
        else await entry.pc.addIceCandidate(candidate).catch(() => {});
    }

    function closePeer(viewerId) {
        const entry = state.peers.get(viewerId);
        if (!entry) return;
        state.peers.delete(viewerId);
        try { entry.pc.close(); } catch (e) { /* ignore */ }
    }

    function closeAllPeers() {
        [...state.peers.keys()].forEach(closePeer);
    }

    /* ---------------- camera / mic came back ---------------- */

    async function restartMedia() {
        const old = state.stream;
        try {
            await requestMedia();
        } catch (error) {
            App.toast(error.message + " " + (error.code === "DENIED" ? "Allow it in the address bar, then try again." : error.detail), "error", 8000);
            state.stream = old;
            return false;
        }
        /* swap the new tracks into every live connection without renegotiating */
        for (const { pc } of state.peers.values()) {
            for (const sender of pc.getSenders()) {
                const kind = sender.track ? sender.track.kind : null;
                const replacement = kind === "video" ? videoTrack() : kind === "audio" ? audioTrack() : null;
                if (replacement) await sender.replaceTrack(replacement).catch(() => {});
            }
        }
        if (old) old.getTracks().forEach(t => t.stop());
        $("pcamVideo").srcObject = state.stream;
        watchTracks();
        stopLevelMeter();
        startLevelMeter();
        reportStatus(true);
        App.toast("Camera and microphone are back on.", "success");
        return true;
    }

    /* ---------------- 4. stop ---------------- */

    function stopTracks() {
        if (state.stream) state.stream.getTracks().forEach(t => t.stop());
    }

    function stop(reason = "submitted") {
        if (state.stopped) return;
        state.stopped = true;
        clearInterval(state.statusTimer);
        closeAllPeers();
        stopLevelMeter();
        stopTracks();
        const video = $("pcamVideo");
        if (video) video.srcObject = null;
        const box = $("pcam");
        if (box) box.classList.add("hidden");
        if (state.socket) {
            if (state.socket.connected) state.socket.emit("leave-exam", { reason });
            const s = state.socket;
            setTimeout(() => s.disconnect(), 300);
        }
    }

    /* ---------------- preview widget controls ---------------- */

    document.addEventListener("click", (e) => {
        if (e.target.closest("#pcamToggle")) {
            const box = $("pcam");
            const min = box.classList.toggle("is-min");
            const btn = $("pcamToggle");
            btn.setAttribute("aria-label", min ? "Show camera details" : "Hide camera details");
            btn.innerHTML = `<i class="bi ${min ? "bi-arrows-angle-expand" : "bi-arrows-angle-contract"}"></i>`;
        }
        if (e.target.closest("#pcamRetry")) {
            const btn = $("pcamRetry");
            App.busy(btn, true);
            restartMedia().finally(() => App.busy(btn, false));
        }
    });

    return {
        requestMedia,
        start,
        stop,
        deniedHelpHtml,
        isSupported: secureContextOk,
        status: currentStatus
    };
})();
