import { describe, it, expect } from "vitest";
import {
  appendTranscript,
  buildReportMessage,
  formatHistoryDate,
  hasPrefill,
  prefillFromState,
  MAX_MESSAGE_CHARS,
  MAX_REPORT_CHARS,
} from "./utils.js";

const t = (key, opts) =>
  opts && Object.keys(opts).length ? `${key}:${JSON.stringify(opts)}` : key;

describe("appendTranscript", () => {
  it("returns the transcript when the draft is empty", () => {
    expect(appendTranscript("", " hello there ")).toBe("hello there");
    expect(appendTranscript(undefined, "hi")).toBe("hi");
  });
  it("joins with a single space and drops trailing whitespace", () => {
    expect(appendTranscript("How much  ", "did I spend")).toBe(
      "How much did I spend",
    );
  });
  it("keeps the draft when nothing was heard", () => {
    expect(appendTranscript("draft", "   ")).toBe("draft");
  });
  it("never exceeds the chat limit", () => {
    const out = appendTranscript("a".repeat(995), "b".repeat(50));
    expect(out.length).toBe(MAX_MESSAGE_CHARS);
  });
});

describe("prefillFromState", () => {
  it("is empty without a prefill", () => {
    expect(prefillFromState(null, t)).toBe("");
    expect(prefillFromState({}, t)).toBe("");
    expect(prefillFromState({ prefill: "" }, t)).toBe("");
    expect(hasPrefill(null)).toBe(false);
    expect(hasPrefill({ receipt: {} })).toBe(false);
  });
  it("uses a string prefill verbatim (the sender already translated it)", () => {
    expect(
      prefillFromState(
        { prefill: " How much at Walgreens? ", merchant: "Walgreens" },
        t,
      ),
    ).toBe("How much at Walgreens?");
    expect(hasPrefill({ prefill: "x" })).toBe(true);
  });
  it("builds the merchant prompt from { merchant } beside an empty prefill", () => {
    expect(prefillFromState({ prefill: "", merchant: " Econo " }, t)).toBe(
      'mobile.assistant.merchantPrompt:{"merchant":"Econo"}',
    );
    expect(hasPrefill({ merchant: "Econo" })).toBe(true);
  });
  it("builds the merchant prompt from { prefill: { merchant } }", () => {
    expect(prefillFromState({ prefill: { merchant: "Econo" } }, t)).toBe(
      'mobile.assistant.merchantPrompt:{"merchant":"Econo"}',
    );
  });
  it("uses { prefill: { text } } verbatim", () => {
    expect(prefillFromState({ prefill: { text: "Am I profitable?" } }, t)).toBe(
      "Am I profitable?",
    );
  });
  it("clamps to the chat limit", () => {
    expect(prefillFromState({ prefill: "q".repeat(1200) }, t).length).toBe(
      MAX_MESSAGE_CHARS,
    );
  });
});

describe("buildReportMessage", () => {
  it("carries the answer, the note and the trail", () => {
    const msg = buildReportMessage({
      answer: "You spent $120.",
      note: "That is wrong",
      conversationId: 42,
      messageIndex: 3,
    });
    expect(msg.startsWith("You spent $120.")).toBe(true);
    expect(msg).toContain("\n\n---\nThat is wrong");
    expect(
      msg.endsWith("[conversationId=42; messageIndex=3; platform=mobile]"),
    ).toBe(true);
  });
  it("omits the note block when the note is blank", () => {
    const msg = buildReportMessage({
      answer: "A",
      note: "  ",
      messageIndex: 0,
    });
    expect(msg).not.toContain("---");
    expect(msg).toContain("conversationId=-;");
  });
  it("truncates the answer, never the trail, to stay within 5000", () => {
    const msg = buildReportMessage({
      answer: "x".repeat(6000),
      note: "n",
      conversationId: 1,
      messageIndex: 2,
    });
    expect(msg.length).toBeLessThanOrEqual(MAX_REPORT_CHARS);
    expect(msg.endsWith("platform=mobile]")).toBe(true);
    expect(msg).toContain("\n\n---\nn");
  });
});

describe("formatHistoryDate", () => {
  it("formats as MMM D and tolerates null", () => {
    expect(formatHistoryDate("2026-03-05T14:00:00.000Z")).toMatch(
      /^[A-Za-z]{3} 5$/,
    );
    expect(formatHistoryDate(null)).toBe("");
  });
});
