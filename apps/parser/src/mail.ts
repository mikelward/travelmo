import nodemailer from "nodemailer";

// Outgoing mail over SMTP, for reminders. Without SMTP_HOST the mailer is
// off and Settings' switch has no effect, which the README says. The
// address and subject hold user data (a trip title), so they are collapsed
// to one line before they become headers.

export type Mail = { to: string; subject: string; text: string };
export type Mailer = (mail: Mail) => Promise<void>;

export type SmtpConfig = { host: string; port: number; secure: boolean; user?: string; pass?: string; from: string };

type Env = Record<string, string | undefined>;

// No control characters and no line breaks: nothing an untrusted value can
// use to add a header.
export const oneLine = (value: string): string =>
  value
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// The SMTP settings from the environment, or nothing when there is no host.
// Port 465 means TLS from the start; 587 and 25 start plain and upgrade.
export function smtpConfig(env: Env): SmtpConfig | undefined {
  const host = env.SMTP_HOST?.trim();
  if (!host) return undefined;
  const port = env.SMTP_PORT ? Number(env.SMTP_PORT) : 465;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error(`SMTP_PORT is not a port: ${env.SMTP_PORT}`);
  const from = env.SMTP_FROM?.trim();
  if (!from) throw new Error("SMTP_FROM is required with SMTP_HOST");
  const secure = env.SMTP_TLS ? env.SMTP_TLS === "true" : port === 465;
  return {
    host,
    port,
    secure,
    ...(env.SMTP_USERNAME ? { user: env.SMTP_USERNAME } : {}),
    ...(env.SMTP_PASSWORD ? { pass: env.SMTP_PASSWORD } : {}),
    from,
  };
}

export type Transport = { sendMail(mail: { from: string; to: string; subject: string; text: string }): Promise<unknown> };

export function smtpTransport(config: SmtpConfig): Transport {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    ...(config.user && config.pass ? { auth: { user: config.user, pass: config.pass } } : {}),
  });
}

export function smtpMailer(config: SmtpConfig, transport: Transport = smtpTransport(config)): Mailer {
  return async (mail) => {
    await transport.sendMail({ from: config.from, to: oneLine(mail.to), subject: oneLine(mail.subject), text: mail.text });
  };
}
