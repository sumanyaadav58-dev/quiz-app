const router = require("express").Router();
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const User = require("../models/User");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const auth = require("../middleware/authMiddleware");
const rateLimit = require("../middleware/rateLimit");
const { isEmail, passwordProblem, str } = require("../utils/validate");
const mailer = require("../utils/mailer");

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 25 });
const codeLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 8, message: "Too many code requests. Wait a few minutes and try again." });

const AVATAR_DIR = path.join(__dirname, "..", "uploads", "avatars");
const CODE_TTL_MS = 10 * 60 * 1000;
const CODE_MAX_TRIES = 5;

function publicUser(user) {
    return {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        avatar: user.avatar || "",
        hasPassword: Boolean(user.password),
        googleLinked: Boolean(user.googleId),
        googleEmail: user.googleEmail || "",
        googlePicture: user.googlePicture || "",
        emailVerified: Boolean(user.emailVerified)
    };
}

function issueToken(user) {
    return jwt.sign(
        { id: user._id, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: "8h" }
    );
}

async function loginResponse(res, user, message = "Login successful") {
    user.lastLogin = new Date();
    await user.save();
    res.json({ success: true, message, token: issueToken(user), user: publicUser(user) });
}


/* ================= PUBLIC CONFIG (which sign-in options are switched on) ================= */

router.get("/config", (req, res) => {
    res.json({
        success: true,
        googleClientId: process.env.GOOGLE_CLIENT_ID || "",
        emailCode: true,
        emailDelivery: mailer.smtpConfigured() ? "email" : "console"
    });
});


/* ================= REGISTER ================= */

router.post("/register", authLimiter, async (req, res) => {

    try {

        const name = str(req.body.name, 60);
        const email = str(req.body.email, 120).toLowerCase();
        const password = typeof req.body.password === "string" ? req.body.password : "";

        const errors = {};

        if (!name) errors.name = "Enter your full name";
        else if (name.length < 2) errors.name = "Name is too short";

        if (!email) errors.email = "Enter your email address";
        else if (!isEmail(email)) errors.email = "Enter a valid email address";

        const pwProblem = passwordProblem(password);
        if (!password) errors.password = "Create a password";
        else if (pwProblem) errors.password = pwProblem;

        if (Object.keys(errors).length) {
            return res.status(400).json({
                success: false,
                message: Object.values(errors)[0],
                errors
            });
        }

        /* CHECK EXISTING USER */

        const existingUser = await User.findOne({ email });

        if (existingUser) {
            return res.status(409).json({
                success: false,
                message: "An account with this email already exists. Try logging in.",
                errors: { email: "This email is already registered" }
            });
        }

        const hash = await bcrypt.hash(password, 10);

        /*
         * SECURITY: the role is always "user".
         * Admins are created with `npm run create-admin` instead.
         */
        await User.create({
            name,
            email,
            password: hash,
            role: "user"
        });

        res.status(201).json({
            success: true,
            message: "Account created. You can log in now."
        });

    } catch (error) {

        console.error("REGISTER ERROR:", error);

        if (error && error.code === 11000) {
            return res.status(409).json({
                success: false,
                message: "An account with this email already exists. Try logging in."
            });
        }

        res.status(500).json({
            success: false,
            message: "We couldn't create your account right now. Please try again."
        });
    }
});


/* ================= LOGIN ================= */

router.post("/login", authLimiter, async (req, res) => {

    try {

        const email = str(req.body.email, 120).toLowerCase();
        const password = typeof req.body.password === "string" ? req.body.password : "";
        const role = req.body.role; /* optional: kept for backward compatibility */

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: "Enter your email and password"
            });
        }

        if (!isEmail(email)) {
            return res.status(400).json({
                success: false,
                message: "Enter a valid email address"
            });
        }

        const user = await User.findOne({ email });

        if (user && !user.password) {
            return res.status(400).json({
                success: false,
                code: "NO_PASSWORD",
                message: "This account doesn't have a password yet. Continue with Google or sign in with an email code, then set a password in My performance."
            });
        }

        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(401).json({
                success: false,
                message: "Incorrect email or password"
            });
        }

        if (user.isActive === false) {
            return res.status(403).json({
                success: false,
                message: "This account has been disabled. Contact the administrator."
            });
        }

        if (role && ["user", "admin"].includes(role) && user.role !== role) {
            return res.status(403).json({
                success: false,
                message: "This account is not registered as " + (role === "admin" ? "Administrator" : "User")
            });
        }

        await loginResponse(res, user);

    } catch (error) {

        console.error("LOGIN ERROR:", error);

        res.status(500).json({
            success: false,
            message: "We couldn't log you in right now. Please try again."
        });
    }
});


/* ================= GOOGLE SIGN-IN ================= */

let googleClient = null;

async function verifyGoogle(credential) {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
        const err = new Error("Google sign-in isn't set up on this server yet. Add GOOGLE_CLIENT_ID to .env.");
        err.status = 503;
        throw err;
    }
    if (typeof credential !== "string" || credential.length < 20 || credential.length > 5000) {
        const err = new Error("Google didn't return a valid sign-in. Please try again.");
        err.status = 400;
        throw err;
    }
    if (!googleClient) {
        const { OAuth2Client } = require("google-auth-library");
        googleClient = new OAuth2Client(clientId);
    }
    try {
        const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: clientId });
        const p = ticket.getPayload();
        if (!p || !p.sub || !p.email) throw new Error("missing fields");
        return {
            googleId: String(p.sub),
            email: String(p.email).toLowerCase(),
            emailVerified: p.email_verified === true || p.email_verified === "true",
            name: str(p.name || p.given_name || p.email.split("@")[0], 60),
            picture: typeof p.picture === "string" && p.picture.startsWith("https://") ? p.picture : ""
        };
    } catch (error) {
        const err = new Error("We couldn't verify your Google sign-in. Please try again.");
        err.status = 401;
        throw err;
    }
}

/* Sign in (or create an account) with Google */
router.post("/google", authLimiter, async (req, res) => {
    try {
        const g = await verifyGoogle(req.body.credential);

        let user = await User.findOne({ googleId: g.googleId });
        let created = false;

        if (!user) {
            const byEmail = await User.findOne({ email: g.email });
            if (byEmail) {
                if (!g.emailVerified) {
                    return res.status(403).json({ success: false, message: "Your Google email isn't verified, so it can't be linked to the existing account. Log in with your password instead." });
                }
                /* same verified email: connect Google to the existing account */
                user = byEmail;
                user.googleId = g.googleId;
                user.googleEmail = g.email;
                user.googlePicture = g.picture;
                user.emailVerified = true;
                if (!user.avatar && g.picture) user.avatar = g.picture;
            } else {
                user = new User({
                    name: g.name.length >= 2 ? g.name : "Candidate",
                    email: g.email,
                    password: null,
                    role: "user",
                    googleId: g.googleId,
                    googleEmail: g.email,
                    googlePicture: g.picture,
                    avatar: g.picture,
                    emailVerified: g.emailVerified
                });
                created = true;
            }
        } else if (g.picture && user.googlePicture !== g.picture) {
            if (user.avatar === user.googlePicture) user.avatar = g.picture;
            user.googlePicture = g.picture;
        }

        if (user.isActive === false) {
            return res.status(403).json({ success: false, message: "This account has been disabled. Contact the administrator." });
        }

        await loginResponse(res, user, created ? "Account created with Google" : "Signed in with Google");
        if (created) console.log("New account via Google:", user.email);

    } catch (error) {
        if (error.status) return res.status(error.status).json({ success: false, message: error.message });
        if (error.code === 11000) return res.status(409).json({ success: false, message: "This Google account is already connected to another user." });
        console.error("GOOGLE LOGIN ERROR:", error);
        res.status(500).json({ success: false, message: "Google sign-in failed. Please try again." });
    }
});

/* Connect Google to the logged-in account */
router.post("/google/link", auth, async (req, res) => {
    try {
        const g = await verifyGoogle(req.body.credential);
        const other = await User.findOne({ googleId: g.googleId, _id: { $ne: req.user.id } }).select("_id").lean();
        if (other) return res.status(409).json({ success: false, message: "That Google account is already connected to a different user." });

        const user = await User.findById(req.user.id);
        user.googleId = g.googleId;
        user.googleEmail = g.email;
        user.googlePicture = g.picture;
        if (g.emailVerified && g.email === user.email) user.emailVerified = true;
        if (!user.avatar && g.picture) user.avatar = g.picture;
        await user.save();

        res.json({ success: true, message: "Google account connected", user: publicUser(user) });
    } catch (error) {
        if (error.status) return res.status(error.status).json({ success: false, message: error.message });
        console.error("GOOGLE LINK ERROR:", error);
        res.status(500).json({ success: false, message: "Couldn't connect Google. Please try again." });
    }
});

/* Disconnect Google */
router.delete("/google/link", auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user.googleId) return res.json({ success: true, user: publicUser(user) });
        if (!user.password && !user.emailVerified) {
            return res.status(400).json({ success: false, message: "Set a password first, otherwise you'd have no way to sign in." });
        }
        if (user.avatar && user.avatar === user.googlePicture) user.avatar = "";
        user.googleId = undefined;
        user.googleEmail = "";
        user.googlePicture = "";
        await user.save();
        res.json({ success: true, message: "Google account disconnected", user: publicUser(user) });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Couldn't disconnect Google" });
    }
});


/* ================= EMAIL CODE SIGN-IN ================= */

function hashCode(email, code) {
    return crypto.createHmac("sha256", process.env.JWT_SECRET).update(email + ":" + code).digest("hex");
}

async function createAndSendCode(user, purpose) {
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
    user.emailCode = { hash: hashCode(user.email, code), expiresAt: new Date(Date.now() + CODE_TTL_MS), tries: 0 };
    await user.save();
    return mailer.sendCode(user.email, user.name, code, purpose);
}

function checkCode(user, code) {
    const c = user.emailCode || {};
    if (!c.hash || !c.expiresAt || c.expiresAt < new Date()) return "This code has expired. Request a new one.";
    if (c.tries >= CODE_MAX_TRIES) return "Too many wrong codes. Request a new one.";
    const ok = crypto.timingSafeEqual(Buffer.from(c.hash), Buffer.from(hashCode(user.email, String(code || "").trim())));
    if (!ok) return "That code isn't right. Check the email and try again.";
    return null;
}

router.post("/email-code/request", codeLimiter, async (req, res) => {
    try {
        const email = str(req.body.email, 120).toLowerCase();
        if (!isEmail(email)) return res.status(400).json({ success: false, message: "Enter a valid email address" });

        const user = await User.findOne({ email });
        if (!user) {
            return res.status(404).json({ success: false, code: "NO_ACCOUNT", message: "There's no account with this email. Create an account or continue with Google." });
        }
        if (user.isActive === false) {
            return res.status(403).json({ success: false, message: "This account has been disabled. Contact the administrator." });
        }

        const sent = await createAndSendCode(user, "sign in");
        res.json({
            success: true,
            delivery: sent.delivered,
            message: sent.delivered === "email"
                ? "We've emailed you a 6-digit code."
                : "No email server is set up, so the 6-digit code was printed in the server terminal."
        });
    } catch (error) {
        console.error("EMAIL CODE ERROR:", error);
        res.status(500).json({ success: false, message: "We couldn't send the code. Check the email settings in .env and try again." });
    }
});

router.post("/email-code/verify", authLimiter, async (req, res) => {
    try {
        const email = str(req.body.email, 120).toLowerCase();
        const user = await User.findOne({ email });
        if (!user) return res.status(400).json({ success: false, message: "That code isn't right." });

        const problem = checkCode(user, req.body.code);
        if (problem) {
            user.emailCode.tries = (user.emailCode.tries || 0) + 1;
            await user.save();
            return res.status(400).json({ success: false, message: problem });
        }
        if (user.isActive === false) {
            return res.status(403).json({ success: false, message: "This account has been disabled. Contact the administrator." });
        }

        user.emailCode = { hash: null, expiresAt: null, tries: 0 };
        user.emailVerified = true;
        await loginResponse(res, user, "Signed in with email code");
    } catch (error) {
        console.error("EMAIL VERIFY ERROR:", error);
        res.status(500).json({ success: false, message: "We couldn't check the code. Please try again." });
    }
});

/* Verify the email of the logged-in account (Connected accounts on the profile page) */
router.post("/email/verify-request", auth, codeLimiter, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        const sent = await createAndSendCode(user, "verify your email");
        res.json({
            success: true,
            delivery: sent.delivered,
            message: sent.delivered === "email" ? `Code sent to ${user.email}` : "No email server is set up, so the code was printed in the server terminal."
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "We couldn't send the code. Check the email settings in .env." });
    }
});

router.post("/email/verify", auth, authLimiter, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        const problem = checkCode(user, req.body.code);
        if (problem) {
            user.emailCode.tries = (user.emailCode.tries || 0) + 1;
            await user.save();
            return res.status(400).json({ success: false, message: problem });
        }
        user.emailCode = { hash: null, expiresAt: null, tries: 0 };
        user.emailVerified = true;
        await user.save();
        res.json({ success: true, message: "Email verified", user: publicUser(user) });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Couldn't verify your email" });
    }
});


/* ================= CURRENT USER ================= */

router.get("/me", auth, async (req, res) => {
    const user = await User.findById(req.user.id).lean();
    res.json({
        success: true,
        user: { ...publicUser(user), createdAt: user.createdAt, lastLogin: user.lastLogin }
    });
});


/* ================= UPDATE NAME ================= */

router.put("/me", auth, async (req, res) => {
    try {
        const name = str(req.body.name, 60);
        if (name.length < 2) {
            return res.status(400).json({ success: false, message: "Name is too short" });
        }
        const user = await User.findByIdAndUpdate(req.user.id, { name }, { new: true });
        res.json({ success: true, message: "Profile updated", user: publicUser(user) });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Unable to update profile" });
    }
});


/* ================= PROFILE PHOTO ================= */

const IMAGE_TYPES = {
    "image/jpeg": { ext: "jpg", magic: (b) => b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF },
    "image/png": { ext: "png", magic: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47 },
    "image/webp": { ext: "webp", magic: (b) => b.slice(0, 4).toString() === "RIFF" && b.slice(8, 12).toString() === "WEBP" }
};

function removeLocalAvatar(avatar) {
    if (!avatar || !avatar.startsWith("/uploads/avatars/")) return;
    const file = path.join(AVATAR_DIR, path.basename(avatar));
    fs.promises.unlink(file).catch(() => {});
}

/* body: { image: "data:image/jpeg;base64,..." }  (the browser crops and resizes it first) */
router.put("/avatar", auth, async (req, res) => {
    try {
        const image = typeof req.body.image === "string" ? req.body.image : "";
        const match = image.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
        if (!match) return res.status(400).json({ success: false, message: "Choose a JPG, PNG or WebP image" });

        const type = IMAGE_TYPES[match[1]];
        const buffer = Buffer.from(match[2], "base64");
        if (buffer.length < 100 || !type.magic(buffer)) return res.status(400).json({ success: false, message: "That file isn't a valid image" });
        if (buffer.length > 2 * 1024 * 1024) return res.status(413).json({ success: false, message: "The photo is too large (2 MB max)" });

        await fs.promises.mkdir(AVATAR_DIR, { recursive: true });
        const fileName = `${req.user.id}-${crypto.randomBytes(6).toString("hex")}.${type.ext}`;
        await fs.promises.writeFile(path.join(AVATAR_DIR, fileName), buffer);

        const user = await User.findById(req.user.id);
        removeLocalAvatar(user.avatar);
        user.avatar = "/uploads/avatars/" + fileName;
        await user.save();

        res.json({ success: true, message: "Profile photo updated", user: publicUser(user) });
    } catch (error) {
        console.error("AVATAR ERROR:", error);
        res.status(500).json({ success: false, message: "Couldn't save your photo. Please try again." });
    }
});

/* Use the photo from the connected Google account */
router.post("/avatar/google", auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user.googlePicture) return res.status(400).json({ success: false, message: "Connect a Google account with a photo first" });
        removeLocalAvatar(user.avatar);
        user.avatar = user.googlePicture;
        await user.save();
        res.json({ success: true, message: "Using your Google photo", user: publicUser(user) });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Couldn't update your photo" });
    }
});

router.delete("/avatar", auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        removeLocalAvatar(user.avatar);
        user.avatar = "";
        await user.save();
        res.json({ success: true, message: "Profile photo removed", user: publicUser(user) });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Couldn't remove your photo" });
    }
});


/* ================= CHANGE / SET PASSWORD ================= */

router.put("/change-password", auth, authLimiter, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        const user = await User.findById(req.user.id);

        /* accounts created with Google or an email code can set a first password without a current one */
        if (user.password) {
            if (!currentPassword || !(await bcrypt.compare(String(currentPassword), user.password))) {
                return res.status(400).json({ success: false, message: "Current password is incorrect" });
            }
        }

        const problem = passwordProblem(newPassword);
        if (problem) return res.status(400).json({ success: false, message: problem });

        const first = !user.password;
        user.password = await bcrypt.hash(newPassword, 10);
        await user.save();

        res.json({ success: true, message: first ? "Password set" : "Password changed", user: publicUser(user) });
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Unable to change password" });
    }
});


module.exports = router;
