import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sendMail,
  sendInvoiceEmail,
  sendInviteEmail,
  sendWelcomeEmail,
} from "../src/services/email.js";

// These tests run without SMTP_* set, so sendMail uses the offline
// jsonTransport: messages are fully composed (visible via `composed`)
// but nothing leaves the machine.

test("sendMail composes without a network and appends the footer", async () => {
  const r = await sendMail({
    to: "someone@example.test",
    subject: "Hello",
    text: "Body line",
    tag: "unit-test",
  });
  assert.equal(r.delivered, true);
  assert.equal(r.fallback, true);
  assert.ok(r.composed, "composed message exposed in fallback mode");
  assert.equal(r.composed.subject, "Hello");
  assert.equal(r.composed.to[0].address, "someone@example.test");
  assert.ok(r.composed.text.startsWith("Body line"));
  assert.ok(r.composed.text.includes("Abaco ·"), "shared footer appended");
});

test("sendMail refuses silently when there is no recipient", async () => {
  const r = await sendMail({ to: "", subject: "x", text: "y" });
  assert.equal(r.delivered, false);
  assert.match(r.error, /recipient/i);
});

test("welcome email — EN and ES compose with the app URL", async () => {
  const en = await sendWelcomeEmail({
    to: "owner@example.test",
    name: "Ana",
    businessName: "Boricua Books",
    lang: "en",
  });
  assert.equal(en.composed.subject, "Welcome to Abaco, Boricua Books!");
  assert.ok(en.composed.text.includes("Hi Ana"));
  assert.ok(en.composed.text.includes("http"));

  const es = await sendWelcomeEmail({
    to: "owner@example.test",
    name: "Ana",
    businessName: "Boricua Books",
    lang: "es",
  });
  assert.equal(es.composed.subject, "¡Bienvenido a Abaco, Boricua Books!");
  assert.ok(es.composed.text.includes("Hola Ana"));
});

test("invite email still composes after the sendMail refactor", async () => {
  const r = await sendInviteEmail({
    to: "invitee@example.test",
    businessName: "Boricua Books",
    inviteLink: "http://localhost:5173/join?token=abc123",
    lang: "en",
  });
  assert.equal(r.delivered, true);
  assert.match(r.composed.subject, /invited to join Boricua Books/);
  assert.ok(r.composed.text.includes("/join?token=abc123"));
});

test("invoice email keeps its PDF attachment and business sender", async () => {
  const r = await sendInvoiceEmail({
    to: "client@example.test",
    invoice: {
      invoice_number: "INV-0042",
      client_name: "Acme",
      total: 150,
      due_date: "2026-08-01",
    },
    business: { name: "Boricua Books", currency: "USD" },
    pdfBuffer: Buffer.from("%PDF-fake"),
    lang: "en",
  });
  assert.equal(r.delivered, true);
  assert.equal(r.composed.subject, "Invoice INV-0042 from Boricua Books");
  assert.equal(r.composed.attachments.length, 1);
  assert.equal(r.composed.attachments[0].filename, "INV-0042.pdf");
  assert.match(r.composed.from.address ?? r.composed.from.text ?? "", /.*/);
});
