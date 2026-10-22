const mongoose = require("mongoose");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function isEmail(value) {
    return typeof value === "string" && EMAIL_RE.test(value.trim());
}

/* At least 8 chars, one letter and one number */
function passwordProblem(value) {
    if (typeof value !== "string" || value.length < 8) return "Password must be at least 8 characters";
    if (!/[A-Za-z]/.test(value)) return "Password must contain at least one letter";
    if (!/[0-9]/.test(value)) return "Password must contain at least one number";
    if (value.length > 128) return "Password is too long";
    return null;
}

function isId(value) {
    return mongoose.Types.ObjectId.isValid(value) && String(new mongoose.Types.ObjectId(value)) === String(value);
}

function str(value, max = 2000) {
    if (value === undefined || value === null) return "";
    return String(value).trim().slice(0, max);
}

function escapeRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = { isEmail, passwordProblem, isId, str, escapeRegex };
