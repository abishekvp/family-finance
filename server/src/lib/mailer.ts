import nodemailer, { type Transporter } from "nodemailer";
import { AppError } from "../middleware/errorHandler";

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (transporter) return transporter;
  const host = process.env.SMTP_HOST?.trim();
  if (!host) return null;
  const port = Number(process.env.SMTP_PORT) || 587;
  transporter = nodemailer.createTransport({
    host,
    port,
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" : port === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  return transporter;
}

export async function sendMail({ to, subject, text, html }: { to: string; subject: string; text: string; html?: string }) {
  const t = getTransporter();
  if (!t) {
    if (process.env.NODE_ENV !== "production") {
      // Local dev without SMTP: surface the message in the server log instead.
      console.log(`[mail] (SMTP not configured) To: ${to}\nSubject: ${subject}\n${text}\n`);
      return;
    }
    throw new AppError(503, "Email delivery is not configured on this server");
  }
  await t.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to, subject, text, html });
}

export async function sendCodeEmail(to: string, heading: string, code: string, detail: string) {
  const footer = "It expires in 10 minutes. If you did not request this, you can ignore this email.";
  const text = `${heading}\n\nYour code is ${code}\n\n${detail}\n\n${footer}\n\n- Family Finance`;
  const html = `<div style="font-family:system-ui,sans-serif;max-width:440px;margin:auto;padding:24px;color:#1b1830">
  <h2 style="margin:0 0 12px">${heading}</h2>
  <p style="margin:0 0 16px;color:#555">${detail}</p>
  <p style="font-size:32px;font-weight:800;letter-spacing:8px;margin:0 0 16px">${code}</p>
  <p style="color:#888;font-size:13px">${footer}</p>
</div>`;
  await sendMail({ to, subject: `${code} is your Family Finance code`, text, html });
}
