/**
 * services/email.js
 *
 * Item 10 — email delivery (nodemailer). Provider-agnostic: configure SMTP via
 * env (works with SES/SendGrid/Postmark/Gmail). When SMTP isn't configured it
 * falls back to a `jsonTransport` that COMPOSES and captures the message
 * offline (no network, no real delivery) so the send flow is fully testable in
 * dev. Set SMTP_HOST/PORT/USER/PASS (+ optional SMTP_SECURE, EMAIL_FROM) for
 * real delivery.
 *
 * sendInvoiceEmail never throws past the caller — it returns a status object so
 * a mail failure can't roll back the ledger posting that precedes it.
 */

import nodemailer from "nodemailer";
import { NOREPLY_EMAIL } from "../config/brand.js";

// Build a transport: real SMTP when configured, else an offline capture.
function getTransport() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE } = process.env;
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
  return { transport: nodemailer.createTransport({ jsonTransport: true }), fallback: true };
}

const TEMPLATES = {
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

/**
 * Email an invoice PDF to the client. Returns a status object — never throws.
 * @returns {Promise<{delivered:boolean, fallback:boolean, messageId?:string, error?:string}>}
 */
export async function sendInvoiceEmail({ to, invoice, business, pdfBuffer, lang = "en" }) {
  if (!to) {
    return { delivered: false, fallback: false, error: "Client has no billing email" };
  }

  const tpl = TEMPLATES[lang === "es" ? "es" : "en"];
  const bizName = business?.name || "your vendor";
  const money = new Intl.NumberFormat(lang === "es" ? "es-PR" : "en-US", {
    style: "currency",
    currency: business?.currency || "USD",
  }).format(Number(invoice.total) || 0);

  const from = process.env.EMAIL_FROM || `${bizName} <${NOREPLY_EMAIL}>`;

  try {
    const { transport, fallback } = getTransport();
    const info = await transport.sendMail({
      from,
      to,
      subject: tpl.subject(invoice.invoice_number, bizName),
      text: tpl.body(invoice.client_name, invoice.invoice_number, money, invoice.due_date),
      attachments: [
        {
          filename: `${invoice.invoice_number}.pdf`,
          content: pdfBuffer,
          contentType: "application/pdf",
        },
      ],
    });

    if (fallback) {
      console.log(
        `[email:dev-capture] invoice ${invoice.invoice_number} → ${to} (no SMTP configured; not actually sent)`,
      );
    }
    return { delivered: true, fallback, messageId: info.messageId };
  } catch (err) {
    console.error("Invoice email error:", err.message);
    return { delivered: false, fallback: false, error: err.message };
  }
}

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

/**
 * Email a team invite link. Same contract as sendInvoiceEmail: returns a
 * status object, never throws — the invite row is created regardless, and
 * the caller always gets the link to share manually.
 */
export async function sendInviteEmail({ to, businessName, inviteLink, lang = "en" }) {
  if (!to) return { delivered: false, fallback: false, error: "No recipient" };
  const tpl = INVITE_TEMPLATES[lang === "es" ? "es" : "en"];
  const from = process.env.EMAIL_FROM || `Abaco <${NOREPLY_EMAIL}>`;

  try {
    const { transport, fallback } = getTransport();
    const info = await transport.sendMail({
      from,
      to,
      subject: tpl.subject(businessName),
      text: tpl.body(businessName, inviteLink),
    });
    if (fallback) {
      console.log(
        `[email:dev-capture] team invite → ${to} (no SMTP configured; not actually sent)`,
      );
    }
    return { delivered: true, fallback, messageId: info.messageId };
  } catch (err) {
    console.error("Invite email error:", err.message);
    return { delivered: false, fallback: false, error: err.message };
  }
}
