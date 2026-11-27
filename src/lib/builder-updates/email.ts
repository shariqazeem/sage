import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { builderEmails, type BuilderEmailRow } from "@/lib/db/schema";
import { founderStorageKey } from "@/lib/auth/founder";
import { siteUrl } from "@/lib/site";
import { cleanEmail, emailConfigured, maskEmail, stopToken, type EmailMessage, type EmailState } from "./email-core";

/**
 * BUILDER UPDATES BY EMAIL: the rows and the one outgoing call (28 Nov 2026). See `email-core.ts` for the rules.
 */
export function builderEmailOf(founder: string): BuilderEmailRow | null {
  return db.select().from(builderEmails).where(eq(builderEmails.founderKey, founderStorageKey(founder))).get() ?? null;
}

/** Turn email on for a builder, at the address their own sign-in carries. */
export function setBuilderEmail(founder: string, email: string, now = Math.floor(Date.now() / 1000)): BuilderEmailRow | null {
  const clean = cleanEmail(email);
  if (!clean) return null;
  const founderKey = founderStorageKey(founder);
  db.insert(builderEmails)
    .values({ founderKey, email: clean, mutedAt: null, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: builderEmails.founderKey, set: { email: clean, mutedAt: null, updatedAt: now } })
    .run();
  return builderEmailOf(founderKey);
}

/** Stopping keeps the row. Returns whether there was one. */
export function muteBuilderEmail(founder: string, now = Math.floor(Date.now() / 1000)): boolean {
  const row = builderEmailOf(founder);
  if (!row) return false;
  db.update(builderEmails).set({ mutedAt: now, updatedAt: now }).where(eq(builderEmails.founderKey, row.founderKey)).run();
  return true;
}

/** What a builder's page shows: whether email is on for them, and the address only ever masked. */
export function builderEmailState(founder: string): { email: EmailState; emailTo: string | null } {
  if (!emailConfigured()) return { email: "unavailable", emailTo: null };
  const row = builderEmailOf(founder);
  return row && !row.mutedAt ? { email: "on", emailTo: maskEmail(row.email) } : { email: "off", emailTo: null };
}

/** The address in an email's stop link, or null when it cannot be signed. */
export function stopUrlFor(founderKey: string): string | null {
  const token = stopToken(founderKey);
  return token ? `${siteUrl()}/api/updates/email/stop?t=${token}` : null;
}

export type SendEmail = (to: string, message: EmailMessage) => Promise<boolean>;

/**
 * Resend's HTTP API, one plain POST. False when email is not set up, when Resend refuses, or on any error.
 * Never throws, and never logs the address or the key: only the status.
 */
export const sendEmail: SendEmail = async (to, message) => {
  const key = process.env.RESEND_API_KEY?.trim();
  const from = process.env.SAGE_EMAIL_FROM?.trim();
  if (!key || !from || !emailConfigured()) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({ from, to: [to], subject: message.subject, text: message.text }),
    });
    if (!res.ok) console.warn("[builder-email] not sent: HTTP", res.status);
    return res.ok;
  } catch (e) {
    console.warn("[builder-email] not sent:", e instanceof Error && e.name === "AbortError" ? "timed out" : "network error");
    return false;
  } finally {
    clearTimeout(timer);
  }
};
