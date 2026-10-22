/*
 * Sends sign-in codes by email.
 *
 * With SMTP settings in .env (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS,
 * MAIL_FROM) the code is emailed for real, through Gmail, Outlook, Brevo,
 * Mailtrap or any SMTP provider.
 *
 * Without them (normal for local development) the code is printed in the
 * server terminal instead, so the feature still works on localhost.
 */

let transporter = null;

function smtpConfigured() {
    return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function getTransporter() {
    if (!smtpConfigured()) return null;
    if (!transporter) {
        const nodemailer = require("nodemailer");
        const port = Number(process.env.SMTP_PORT) || 587;
        transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port,
            secure: port === 465,
            auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        });
    }
    return transporter;
}

async function sendCode(to, name, code, purpose = "sign in") {
    const t = getTransporter();
    const subject = `Your Quiz App code: ${code}`;
    const text = `Hi ${name || "there"},\n\nYour code to ${purpose} is ${code}. It expires in 10 minutes.\n\nIf you didn't ask for this, you can ignore this email.\n\nQuiz App`;

    if (!t) {
        console.log("=================================");
        console.log(`EMAIL CODE (no SMTP configured, so it's printed here)`);
        console.log(`To: ${to}   Code: ${code}   Purpose: ${purpose}`);
        console.log("=================================");
        return { delivered: "console" };
    }

    await t.sendMail({
        from: process.env.MAIL_FROM || process.env.SMTP_USER,
        to,
        subject,
        text,
        html: `<div style="font-family:Arial,sans-serif;font-size:15px;color:#0F1B33">
                <p>Hi ${String(name || "there").replace(/[<>&]/g, "")},</p>
                <p>Your code to ${purpose} is</p>
                <p style="font-size:30px;font-weight:700;letter-spacing:6px;margin:10px 0">${code}</p>
                <p>It expires in 10 minutes. If you didn't ask for this, ignore this email.</p>
                <p style="color:#6A7B98">Quiz App</p></div>`
    });
    return { delivered: "email" };
}

module.exports = { sendCode, smtpConfigured };
