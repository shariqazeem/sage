import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * BUILDER UPDATES BY EMAIL, the parts with no database and no network (28 Nov 2026).
 *
 * Most builders sign in with an email or Google and never connect Telegram. Email is the same updates on a
 * second channel, and it is OFF until the founder sets it up: with either `RESEND_API_KEY` or
 * `SAGE_EMAIL_FROM` missing, nothing is offered and nothing is sent.
 *
 * Only a builder who turned it on is ever emailed, at the address their own sign-in carries (never one a
 * browser typed). A tester is never emailed. No address is ever logged, and a page shows it only masked.
 */
type Env = Record<string, string | undefined>;

export type EmailState = "on" | "off" | "unavailable";

/** Both settings present, and the sender looks like one. */
export function emailConfigured(env: Env = process.env): boolean {
  return !!env.RESEND_API_KEY?.trim() && /@/.test(env.SAGE_EMAIL_FROM?.trim() ?? "");
}

const EMAIL = /^[^\s@<>"',;]{1,64}@[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?\.[a-z]{2,24}$/i;

/** One plain address, lower-cased, or null. */
export function cleanEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const e = raw.trim().toLowerCase();
  return e.length <= 254 && EMAIL.test(e) ? e : null;
}

/** An address as a page may show it: `sh…@gmail.com`. One letter for a very short name. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return "…";
  const name = email.slice(0, at);
  return `${name.slice(0, name.length > 2 ? 2 : 1)}…${email.slice(at)}`;
}

/* ───────────────────────────────────────────── the one-click stop link ───── */

function secret(env: Env): string | null {
  const s = env.SAGE_SESSION_SECRET?.trim();
  return s && s.length >= 16 ? s : null;
}
const mac = (key: string, founderKey: string): string =>
  // "email-stop|" keeps these apart from every other code signed with the same secret
  createHmac("sha256", key).update(`email-stop|${founderKey}`).digest("hex").slice(0, 40);

/**
 * The token in an email's stop link: the builder it is for, signed. It does not expire (an old email must
 * still be able to stop the emails) and it can do exactly one thing: mute email for that builder.
 * Null when there is no secret to sign with; then no email is sent at all.
 */
export function stopToken(founderKey: string, env: Env = process.env): string | null {
  const key = secret(env);
  const who = founderKey.trim().toLowerCase();
  if (!key || !who) return null;
  return `${Buffer.from(who, "utf8").toString("base64url")}.${mac(key, who)}`;
}

/** The builder a stop token is for, or null when it was not signed here. */
export function readStopToken(token: unknown, env: Env = process.env): string | null {
  const key = secret(env);
  if (!key || typeof token !== "string") return null;
  const m = /^([A-Za-z0-9_-]{1,200})\.([0-9a-f]{40})$/.exec(token.trim());
  if (!m) return null;
  const who = Buffer.from(m[1], "base64url").toString("utf8");
  if (!who || who !== who.trim().toLowerCase()) return null;
  const want = Buffer.from(mac(key, who), "hex");
  const got = Buffer.from(m[2], "hex");
  return want.length === got.length && timingSafeEqual(want, got) ? who : null;
}

/* ─────────────────────────────────────────────────────── the message ───── */

export const EMAIL_KIND_PREFIX = "email:";
export const emailKind = (kind: string): string => `${EMAIL_KIND_PREFIX}${kind}`;

export interface EmailMessage {
  subject: string;
  text: string;
}

/**
 * A notice as an email: the same words Telegram gets, the first sentence as the subject, and one footer
 * line with the way to stop.
 */
export function emailFor(noticeText: string, stopUrl: string): EmailMessage {
  const first = noticeText.split("\n")[0] ?? "";
  const sentence = /^(.*?[.?])(\s|$)/.exec(first)?.[1] ?? first;
  return {
    subject: sentence.replace(/[.\s]+$/, "").slice(0, 140) || "An update on your test",
    text: `${noticeText}\n\nYou get these because you turned on email updates for your tests on Sage. Stop them: ${stopUrl}`,
  };
}

/** The notices still to send by email: each kind once per test on this channel, whatever Telegram was sent. */
export function dueByEmail<T extends { kind: string }>(due: readonly T[], sent: ReadonlySet<string>): T[] {
  return due.filter((n) => !sent.has(emailKind(n.kind)));
}
