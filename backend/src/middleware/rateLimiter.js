/**
 * rateLimiter.js
 * OWASP A04 (Insecure Design) — Rate Limiting
 *
 * Install: npm install express-rate-limit
 */

import rateLimit, { ipKeyGenerator } from "express-rate-limit";

// ── Auth endpoints — brute-force protection ───────────────────
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts per window
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Only count failures
  message: {
    error: "Too many login attempts. Please try again in 15 minutes.",
  },
  keyGenerator: (req) => ipKeyGenerator(req), // IPv6-safe
});

// ── AI chat — API cost protection ────────────────────────────
export const aiChatLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20, // 20 messages/min per user
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "You're sending messages too quickly. Please slow down." },
  // Prefer user ID when authenticated, fall back to IPv6-safe IP
  keyGenerator: (req) => req.user?.userId ?? ipKeyGenerator(req),
});

// ── File uploads — resource abuse protection ─────────────────
export const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 50, // 50 uploads/hour per user
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Upload limit reached. Please try again in an hour." },
  keyGenerator: (req) => req.user?.userId ?? ipKeyGenerator(req),
});

// ── General API — broad abuse protection ─────────────────────
export const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please slow down." },
});
