import { Resend } from "resend";
import { render } from "@react-email/render";
import config from "../config/env.js";
import logger from "../observability/logger.js";
import { ActionEmail, type ActionEmailProps } from "../emails/ActionEmail.js";

/**
 * Transactional email via Resend. If RESEND_API_KEY is not configured, emails
 * are logged (delivery skipped) so local/dev and unconfigured environments do
 * not crash — but production should set RESEND_API_KEY + EMAIL_FROM and turn on
 * EMAIL_VERIFICATION.
 */
const resend = config.RESEND_API_KEY ? new Resend(config.RESEND_API_KEY) : null;

export function isEmailConfigured(): boolean {
  return resend !== null && Boolean(config.EMAIL_FROM);
}

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

/**
 * Send an email. Returns whether it was actually delivered.
 * @throws if Resend is configured but the send fails.
 */
export async function sendEmail(input: SendEmailInput): Promise<{ delivered: boolean }> {
  if (!resend || !config.EMAIL_FROM) {
    logger.warn(
      { to: input.to, subject: input.subject },
      "email delivery not configured (RESEND_API_KEY/EMAIL_FROM missing) — skipping send"
    );
    return { delivered: false };
  }

  const { error } = await resend.emails.send({
    from: config.EMAIL_FROM,
    to: input.to,
    subject: input.subject,
    html: input.html,
    ...(input.text ? { text: input.text } : {}),
  });

  if (error) {
    logger.error({ err: error, to: input.to }, "email send failed");
    throw new Error(`Email send failed: ${error.message}`);
  }
  return { delivered: true };
}

/** Render a React Email ActionEmail template to an HTML string. */
export async function renderActionEmail(props: ActionEmailProps): Promise<string> {
  return render(ActionEmail(props));
}

/** Render + send a single call-to-action email in one step. */
export async function sendActionEmail(
  to: string,
  subject: string,
  props: ActionEmailProps
): Promise<{ delivered: boolean }> {
  const html = await renderActionEmail(props);
  return sendEmail({ to, subject, html, text: `${props.body}\n\n${props.cta}: ${props.url}` });
}
