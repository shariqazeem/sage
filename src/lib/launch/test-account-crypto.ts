import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Encryption for a founder's TEST-ACCOUNT credentials at rest.
 *
 * These are the only user secrets Sage stores, and they exist for exactly one purpose: signing in to
 * the founder's own product during a field test. They are AES-256-GCM sealed with a key derived from
 * the server secret, so a database copy alone never yields a usable credential, and the auth tag
 * makes tampering detectable rather than silently decryptable.
 *
 * Never logged, never returned by any API, never placed in a prompt, and never written into the
 * observation corpus (the redaction pass in authenticated-exploration.ts is the second line of that
 * defence). If no server secret is configured, sealing REFUSES — storing a plaintext password
 * because a config value was missing is exactly the failure this module exists to prevent.
 */

function key(): Buffer | null {
  const raw = (process.env.SAGE_SESSION_SECRET ?? "").trim();
  if (raw.length < 16) return null; // no usable secret → refuse to seal (see above)
  return createHash("sha256").update(`test-account:${raw}`).digest();
}

export interface TestAccount {
  email: string;
  password: string;
}

/** Seal credentials for storage. Returns null when no server secret is configured. */
export function sealTestAccount(acct: TestAccount): string | null {
  const k = key();
  if (!k) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  const body = Buffer.concat([
    cipher.update(JSON.stringify({ e: acct.email, p: acct.password }), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${body.toString("base64url")}`;
}

/** Open sealed credentials. Returns null for anything malformed, tampered, or unopenable. */
export function openTestAccount(sealed: string | null | undefined): TestAccount | null {
  const k = key();
  if (!k || !sealed) return null;
  const parts = sealed.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", k, Buffer.from(parts[1], "base64url"));
    decipher.setAuthTag(Buffer.from(parts[2], "base64url"));
    const out = Buffer.concat([decipher.update(Buffer.from(parts[3], "base64url")), decipher.final()]);
    const parsed = JSON.parse(out.toString("utf8")) as { e?: unknown; p?: unknown };
    if (typeof parsed.e !== "string" || typeof parsed.p !== "string") return null;
    if (!parsed.e || !parsed.p) return null;
    return { email: parsed.e, password: parsed.p };
  } catch {
    return null; // tampered, wrong key, or not ours
  }
}

/** Validate what a founder submitted. Bounded, and never echoed back in an error message. */
export function validateTestAccount(input: unknown): { ok: true; value: TestAccount | null } | { ok: false; error: string } {
  if (input == null) return { ok: true, value: null };
  if (typeof input !== "object") return { ok: false, error: "Test account must be an object." };
  const o = input as { email?: unknown; password?: unknown };
  const email = typeof o.email === "string" ? o.email.trim() : "";
  const password = typeof o.password === "string" ? o.password : "";
  if (!email && !password) return { ok: true, value: null };
  if (!email || !password) return { ok: false, error: "A test account needs both an email and a password." };
  if (email.length > 200 || password.length > 200) return { ok: false, error: "Test account values are too long." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "Test account email looks invalid." };
  return { ok: true, value: { email, password } };
}
