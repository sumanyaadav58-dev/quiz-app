const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true,
            maxlength: 60
        },

        email: {
            type: String,
            required: true,
            unique: true,
            lowercase: true,
            trim: true
        },

        /* Not required for accounts created with Google sign-in */
        password: {
            type: String,
            default: null
        },

        role: {
            type: String,
            enum: ["user", "admin"],
            default: "user"
        },

        /* NEW: admin can disable an account */
        isActive: {
            type: Boolean,
            default: true
        },

        /* NEW: shown in admin user management */
        lastLogin: {
            type: Date,
            default: null
        },

        /* NEW: profile photo. A local path (/uploads/avatars/...) or a Google photo URL */
        avatar: {
            type: String,
            default: ""
        },

        /* NEW: connected sign-in methods */
        /* left undefined (not null) when not linked, see the partial index below */
        googleId: {
            type: String
        },

        googleEmail: {
            type: String,
            default: ""
        },

        /* photo from the linked Google account, offered as a profile photo */
        googlePicture: {
            type: String,
            default: ""
        },

        emailVerified: {
            type: Boolean,
            default: false
        },

        /* One-time email sign-in code (stored hashed, never in plain text) */
        emailCode: {
            hash: { type: String, default: null },
            expiresAt: { type: Date, default: null },
            tries: { type: Number, default: 0 }
        }
    },
    {
        timestamps: true
    }
);

/* one Google account can only be linked to one user */
userSchema.index(
    { googleId: 1 },
    { unique: true, partialFilterExpression: { googleId: { $type: "string" } } }
);

module.exports = mongoose.model("User", userSchema);
