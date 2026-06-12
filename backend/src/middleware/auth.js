/**
 * authMiddleware.js (SECURITY-HARDENED)
 *
 * Fixes applied:
 * - OWASP A02: Algorithm explicitly pinned to HS256 — prevents "alg: none" attack
 * - OWASP A02: JWT_SECRET validated before use
 * - OWASP A01: req.user only exposes what routes need (userId, businessId, role)
 */

import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error("FATAL: JWT_SECRET env var is missing or too short");
}

export const requireAuth = (req, res, next) => {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Authentication required" });
  }

  const token = header.split(" ")[1];

  // Sanity check token length before verify to avoid regex DoS on malformed tokens
  if (!token || token.length < 10 || token.length > 2048) {
    return res.status(401).json({ error: "Invalid token" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET, {
      algorithms: ["HS256"], // OWASP A02: Pin algorithm — prevents "alg: none" attack
    });

    // Expose only what routes need — never dump the full decoded payload
    req.user = {
      userId: decoded.userId,
      businessId: decoded.businessId,
      role: decoded.role,
    };

    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res
        .status(401)
        .json({ error: "Session expired. Please log in again." });
    }
    return res.status(401).json({ error: "Invalid token" });
  }
};

// ── Role-based access control helper ─────────────────────────
// Usage: router.delete("/:id", requireAuth, requireRole("owner", "admin"), handler)
export const requireRole =
  (...allowedRoles) =>
  (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res
        .status(403)
        .json({ error: "You do not have permission to perform this action" });
    }
    next();
  };
