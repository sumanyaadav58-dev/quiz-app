const jwt = require("jsonwebtoken");
const User = require("../models/User");

/*
 * Verifies the JWT and then re-checks the user in the database, so that
 * disabling an account or changing a role takes effect immediately
 * instead of waiting for the token to expire.
 */
module.exports = async (req, res, next) => {

    try {

        const authHeader = req.headers.authorization;

        if (!authHeader) {
            return res.status(401).json({
                success: false,
                message: "Please log in to continue"
            });
        }

        const token = authHeader.startsWith("Bearer ")
            ? authHeader.split(" ")[1]
            : authHeader;

        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        const user = await User.findById(decoded.id)
            .select("name email role isActive")
            .lean();

        if (!user) {
            return res.status(401).json({
                success: false,
                message: "Your account no longer exists. Please register again."
            });
        }

        if (user.isActive === false) {
            return res.status(403).json({
                success: false,
                code: "ACCOUNT_DISABLED",
                message: "Your account has been disabled. Contact the administrator."
            });
        }

        req.user = {
            id: String(user._id),
            role: user.role,
            name: user.name,
            email: user.email
        };

        next();

    } catch (error) {

        return res.status(401).json({
            success: false,
            message: "Your session has expired. Please log in again."
        });
    }
};
