import dayjs from "dayjs";

// Pure helpers for the Assistant screen. Kept out of the .jsx files so they
// run under vitest's node environment (see utils.test.js).

/** POST /api/ai/chat rejects messages over 1000 characters. */
export const MAX_MESSAGE_CHARS = 1000;
/** The composer shows "n/1000" once the draft passes this length. */
export const COUNTER_THRESHOLD = 900;
/** POST /api/support rejects messages over 5000 characters. */
export const MAX_REPORT_CHARS = 5000;
/**
 * POST /api/support accepts bug | billing | question | feedback
 * (backend/src/routes/support.js). A wrong or unhelpful answer is feedback
 * about the assistant, not a software defect, so it files as "feedback".
 */
export const SUPPORT_CATEGORY = "feedback";
/** Same react-query key as the web app's history panel. */
export const CONVERSATIONS_QUERY_KEY = ["ai-conversations"];
/** aichat.suggested.q1..q6 — shared with the web. */
export const SUGGESTED_KEYS = ["q1", "q2", "q3", "q4", "q5", "q6"];
/** Per-device convenience: "Read answers aloud" on/off. */
export const SPEAK_PREF_KEY = "abaco-mobile-speak";

export const clampMessage = (text) =>
  String(text ?? "").slice(0, MAX_MESSAGE_CHARS);

/** Dictation result appended to whatever is already typed (one space). */
export function appendTranscript(current, transcript) {
  const spoken = String(transcript ?? "").trim();
  const base = String(current ?? "");
  if (!spoken) return base;
  const trimmed = base.replace(/\s+$/, "");
  return clampMessage(trimmed ? `${trimmed} ${spoken}` : spoken);
}

/**
 * The receipt detail's "Ask about this merchant" navigates here with router
 * state. Accepted shapes (first match wins):
 *   { prefill: "full question text" }          used verbatim (already t()'d)
 *   { prefill: { text } }                      used verbatim
 *   { prefill: { merchant } } or { merchant }  → mobile.assistant.merchantPrompt
 * Returns the initial composer value ("" when there is nothing to prefill).
 */
export function prefillFromState(state, t) {
  if (!state) return "";
  const { prefill, merchant } = state;
  const byMerchant = (name) => {
    const clean = String(name ?? "").trim();
    return clean
      ? clampMessage(t("mobile.assistant.merchantPrompt", { merchant: clean }))
      : "";
  };
  if (typeof prefill === "string" && prefill.trim()) {
    return clampMessage(prefill.trim());
  }
  if (prefill && typeof prefill === "object") {
    if (typeof prefill.text === "string" && prefill.text.trim()) {
      return clampMessage(prefill.text.trim());
    }
    if (typeof prefill.merchant === "string")
      return byMerchant(prefill.merchant);
  }
  if (typeof merchant === "string") return byMerchant(merchant);
  return "";
}

/** True when router state carries something prefillFromState would use. */
export const hasPrefill = (state) =>
  !!state && (state.prefill != null || typeof state.merchant === "string");

/** GET /api/ai/conversations rows are dated "MMM D" in the dayjs locale. */
export const formatHistoryDate = (iso) =>
  iso ? dayjs(iso).format("MMM D") : "";

/**
 * Body of the "Report this answer" support request: the answer, the user's
 * optional note, then a machine-readable trail. The backend persists only
 * context.page / context.mode, so the identifiers travel in the text too.
 * The answer is what gets truncated when the total would exceed the limit.
 */
export function buildReportMessage(
  { answer, note, conversationId, messageIndex },
  max = MAX_REPORT_CHARS,
) {
  const trail =
    `\n\n[conversationId=${conversationId ?? "-"}; ` +
    `messageIndex=${messageIndex ?? "-"}; platform=mobile]`;
  const extra = String(note ?? "").trim();
  const noteBlock = extra ? `\n\n---\n${extra}` : "";
  const budget = Math.max(0, max - trail.length - noteBlock.length);
  const body = String(answer ?? "")
    .trim()
    .slice(0, budget);
  return `${body}${noteBlock}${trail}`.slice(0, max);
}

export function readSpeakPref() {
  try {
    return localStorage.getItem(SPEAK_PREF_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeSpeakPref(on) {
  try {
    localStorage.setItem(SPEAK_PREF_KEY, on ? "1" : "0");
  } catch {
    /* per-device convenience only — nothing depends on it persisting */
  }
}
