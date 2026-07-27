/**
 * services/email.js — all outbound mail (Roadmap v3 · Phase 1).
 *
 * One generic sender, `sendMail()`, wraps nodemailer: real SMTP when the
 * SMTP_* env vars are set (works with SES/SendGrid/Postmark/Gmail), else an
 * offline `jsonTransport` that composes-but-doesn't-send, so every email
 * flow is fully testable in dev. Feature senders (invoice, invite, welcome,
 * …) are thin template wrappers over it — new email types should follow
 * that pattern instead of touching nodemailer directly.
 *
 * Contract: senders NEVER throw past the caller — they return a status
 * object ({delivered, fallback, messageId?, error?}) so a mail failure can
 * never roll back the business action that preceded it.
 *
 * Env: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS (+ optional SMTP_SECURE,
 * EMAIL_FROM, APP_URL). For real deliverability also set up SPF/DKIM at the
 * provider for the EMAIL_FROM domain.
 */

import nodemailer from "nodemailer";
import { NOREPLY_EMAIL } from "../config/brand.js";

// Build a transport: real SMTP when configured, else an offline capture.
function getTransport() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE } =
    process.env;
  if (SMTP_HOST && SMTP_PORT && SMTP_USER && SMTP_PASS) {
    return {
      transport: nodemailer.createTransport({
        host: SMTP_HOST,
        port: Number(SMTP_PORT),
        secure: SMTP_SECURE === "true",
        auth: { user: SMTP_USER, pass: SMTP_PASS },
      }),
      fallback: false,
    };
  }
  // Dev fallback — captures the composed message instead of sending it.
  return {
    transport: nodemailer.createTransport({ jsonTransport: true }),
    fallback: true,
  };
}

// Shared sign-off appended to every plain-text body.
const FOOTER = {
  en: (appUrl) => `\n\n—\nAbaco · ${appUrl}`,
  es: (appUrl) => `\n\n—\nAbaco · ${appUrl}`,
};

const appUrl = () => process.env.APP_URL || "http://localhost:5173";

/**
 * Generic sender — every email in the app goes through here.
 *
 * @param {object} p
 * @param {string} p.to
 * @param {string} p.subject
 * @param {string} p.text        plain-text body (footer appended)
 * @param {string} [p.from]      defaults to EMAIL_FROM or the brand no-reply
 * @param {Array}  [p.attachments] nodemailer attachments
 * @param {string} [p.lang]      footer language ("en" | "es")
 * @param {string} [p.tag]       short label for the dev-capture log
 * @returns {Promise<{delivered:boolean, fallback:boolean, messageId?:string,
 *                    composed?:object, error?:string}>}
 */
export async function sendMail({
  to,
  subject,
  text,
  from,
  attachments,
  lang = "en",
  tag = "mail",
}) {
  if (!to) return { delivered: false, fallback: false, error: "No recipient" };

  const sender = from || process.env.EMAIL_FROM || `Abaco <${NOREPLY_EMAIL}>`;
  const footer = (FOOTER[lang === "es" ? "es" : "en"] || FOOTER.en)(appUrl());

  try {
    const { transport, fallback } = getTransport();
    const info = await transport.sendMail({
      from: sender,
      to,
      subject,
      text: `${text}${footer}`,
      ...(attachments ? { attachments } : {}),
    });

    if (fallback) {
      console.log(
        `[email:dev-capture] ${tag} → ${to} (no SMTP configured; not actually sent)`,
      );
      // jsonTransport puts the full composed message in info.message —
      // surface it so tests can assert on composition without a network.
      let composed;
      try {
        composed = JSON.parse(info.message);
      } catch {
        composed = undefined;
      }
      return { delivered: true, fallback, messageId: info.messageId, composed };
    }
    return { delivered: true, fallback, messageId: info.messageId };
  } catch (err) {
    console.error(`Email error (${tag}):`, err.message);
    return { delivered: false, fallback: false, error: err.message };
  }
}

// ── Invoice delivery ─────────────────────────────────────────
const INVOICE_TEMPLATES = {
  en: {
    subject: (n, biz) => `Invoice ${n} from ${biz}`,
    body: (name, n, total, due) =>
      `Hi ${name || "there"},\n\nPlease find attached invoice ${n} for ${total}, due ${due}.\n\nThank you for your business.`,
  },
  es: {
    subject: (n, biz) => `Factura ${n} de ${biz}`,
    body: (name, n, total, due) =>
      `Hola ${name || ""},\n\nAdjunto encontrarás la factura ${n} por ${total}, con vencimiento el ${due}.\n\nGracias por tu preferencia.`,
  },
};

/** Email an invoice PDF to the client. */
export async function sendInvoiceEmail({
  to,
  invoice,
  business,
  pdfBuffer,
  lang = "en",
}) {
  if (!to) {
    return {
      delivered: false,
      fallback: false,
      error: "Client has no billing email",
    };
  }
  const tpl = INVOICE_TEMPLATES[lang === "es" ? "es" : "en"];
  const bizName = business?.name || "your vendor";
  const money = new Intl.NumberFormat(lang === "es" ? "es-PR" : "en-US", {
    style: "currency",
    currency: business?.currency || "USD",
  }).format(Number(invoice.total) || 0);

  return sendMail({
    to,
    // Invoices go out under the business's name, not the app's.
    from: process.env.EMAIL_FROM || `${bizName} <${NOREPLY_EMAIL}>`,
    subject: tpl.subject(invoice.invoice_number, bizName),
    text: tpl.body(
      invoice.client_name,
      invoice.invoice_number,
      money,
      invoice.due_date,
    ),
    attachments: [
      {
        filename: `${invoice.invoice_number}.pdf`,
        content: pdfBuffer,
        contentType: "application/pdf",
      },
    ],
    lang,
    tag: `invoice ${invoice.invoice_number}`,
  });
}

// ── Team invites ─────────────────────────────────────────────
const INVITE_TEMPLATES = {
  en: {
    subject: (biz) => `You've been invited to join ${biz} on Abaco`,
    body: (biz, link) =>
      `You've been invited to join ${biz}'s books on Abaco.\n\nAccept the invitation and set your password here:\n${link}\n\nThis link expires in 7 days.`,
  },
  es: {
    subject: (biz) => `Te invitaron a unirte a ${biz} en Abaco`,
    body: (biz, link) =>
      `Te invitaron a unirte a los libros de ${biz} en Abaco.\n\nAcepta la invitación y crea tu contraseña aquí:\n${link}\n\nEste enlace expira en 7 días.`,
  },
};

/** Email a team invite link. */
export async function sendInviteEmail({
  to,
  businessName,
  inviteLink,
  lang = "en",
}) {
  const tpl = INVITE_TEMPLATES[lang === "es" ? "es" : "en"];
  return sendMail({
    to,
    subject: tpl.subject(businessName),
    text: tpl.body(businessName, inviteLink),
    lang,
    tag: "team invite",
  });
}

// ── Welcome on signup ────────────────────────────────────────
const WELCOME_TEMPLATES = {
  en: {
    subject: (biz) => `Welcome to Abaco, ${biz}!`,
    body: (name, biz, url) =>
      `Hi ${name || "there"},\n\n${biz} is set up and ready. Your chart of accounts is seeded, so you can start recording transactions right away.\n\nA good first step: add a bank or cash account, then record your first transaction — the dashboard checklist will walk you through it.\n\n${url}`,
  },
  es: {
    subject: (biz) => `¡Bienvenido a Abaco, ${biz}!`,
    body: (name, biz, url) =>
      `Hola ${name || ""},\n\n${biz} ya está configurado. Tu catálogo de cuentas está listo, así que puedes empezar a registrar transacciones de inmediato.\n\nUn buen primer paso: añade una cuenta bancaria o de efectivo y registra tu primera transacción — la lista de primeros pasos del panel te guiará.\n\n${url}`,
  },
};

/** Welcome email after registration. Fire-and-forget from the route. */
export async function sendWelcomeEmail({ to, name, businessName, lang = "en" }) {
  const tpl = WELCOME_TEMPLATES[lang === "es" ? "es" : "en"];
  return sendMail({
    to,
    subject: tpl.subject(businessName),
    text: tpl.body(name, businessName, appUrl()),
    lang,
    tag: "welcome",
  });
}
