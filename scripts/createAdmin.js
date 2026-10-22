/*
 * Create (or promote) an administrator.
 *   npm run create-admin -- "Admin Name" admin@example.com "StrongPass123"
 * Registration through the website always creates normal users, so this is
 * how admin accounts are made.
 */
require("dotenv").config();

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const { isEmail, passwordProblem } = require("../utils/validate");

async function main() {
    const [name, email, password] = process.argv.slice(2);

    if (!name || !email || !password) {
        console.log('Usage: npm run create-admin -- "Full Name" email@example.com "Password123"');
        process.exit(1);
    }
    if (!isEmail(email)) { console.log("That email address is not valid."); process.exit(1); }
    const problem = passwordProblem(password);
    if (problem) { console.log(problem); process.exit(1); }

    await mongoose.connect(process.env.MONGO_URI);

    const hash = await bcrypt.hash(password, 10);
    const existing = await User.findOne({ email: email.toLowerCase() });

    if (existing) {
        existing.role = "admin";
        existing.password = hash;
        existing.isActive = true;
        existing.name = name;
        await existing.save();
        console.log("Existing account promoted to admin and password updated:", existing.email);
    } else {
        await User.create({ name, email: email.toLowerCase(), password: hash, role: "admin" });
        console.log("Admin account created:", email.toLowerCase());
    }

    await mongoose.disconnect();
}

main().catch(error => { console.error("Error:", error.message); process.exit(1); });
