/**
 * aiGuards.js
 *
 * Shared Anthropic client + LLM hardening helpers used by every AI-facing
 * route (/ai/chat, /invoices/ai-draft). Centralizing these keeps the
 * prompt-injection defenses identical across surfaces so they can't drift.
 *
 * - LLM01 (Prompt Injection): containsInjectionAttempt()
 * - One Anthropic client, one API-key check.
 */

import Anthropic from "@anthropic-ai/sdk";

// Validate API key exists at module load — fail fast.
if (!process.env.ANTHROPIC_API_KEY) {
  throw new Error("FATAL: ANTHROPIC_API_KEY env var is missing");
}

export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// ── LLM01: Prompt injection detection ────────────────────────
// Detects common prompt injection patterns. Not exhaustive — defense-in-depth.
export const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /disregard\s+(your\s+)?system\s+prompt/i,
  /forget\s+(everything|all)\s+(you|above)/i,
  /you\s+are\s+now\s+(a\s+)?different/i,
  /new\s+instructions?:/i,
  /\[SYSTEM\]/i,
  /<<<.*?>>>/, // Common injection delimiters
  /<\|.*?\|>/, // Token-style injections
  /act\s+as\s+(if\s+you\s+(are|were))/i,
];

export const containsInjectionAttempt = (text) =>
  INJECTION_PATTERNS.some((pattern) => pattern.test(text));
