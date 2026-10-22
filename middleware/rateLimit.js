/*
 * Tiny in-memory rate limiter (no extra dependency).
 * Used on login/register to slow down password guessing.
 */
module.exports = function rateLimit({ windowMs = 15 * 60 * 1000, max = 20, message } = {}) {

    const hits = new Map();

    setInterval(() => {
        const now = Date.now();
        for (const [key, entry] of hits) {
            if (entry.reset < now) hits.delete(key);
        }
    }, windowMs).unref();

    return (req, res, next) => {

        const key = req.ip + ":" + req.baseUrl + req.path;
        const now = Date.now();
        let entry = hits.get(key);

        if (!entry || entry.reset < now) {
            entry = { count: 0, reset: now + windowMs };
            hits.set(key, entry);
        }

        entry.count++;

        if (entry.count > max) {
            const wait = Math.ceil((entry.reset - now) / 60000);
            return res.status(429).json({
                success: false,
                message: message || `Too many attempts. Try again in ${wait} minute${wait === 1 ? "" : "s"}.`
            });
        }

        next();
    };
};
