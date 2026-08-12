/**
 * AUTHENTICATED EXPLORATION — the pure core of "Sage logs in with the founder's TEST account".
 *
 * Why this exists: on a product whose value sits behind a login (token-watcher, ClawUp), Sage can
 * see only the landing page and the wall. It then designs missions about a console it never saw —
 * and those can never be PAID, because an observation payout compares the tester's account against
 * what Sage itself observed. Ground truth behind the wall is what makes that work payable.
 *
 * Everything here is PURE (no browser, no network) so the risky parts are fully testable offline:
 *   · which fields on a page are the email/password/submit controls,
 *   · whether a login actually succeeded,
 *   · and the REDACTION that must run on everything harvested while authenticated.
 *
 * THE REDACTION IS NOT OPTIONAL. A logged-in session sees things a logged-out one never does — API
 * keys, tokens, invoices, the founder's own email. Mission ANCHORS are quoted verbatim on the public
 * plan page and to every tester, and anchors come from the observation corpus. So without this pass,
 * logging in would publish a founder's secrets. Redaction runs before authenticated text becomes
 * corpus, and it is deliberately aggressive: a false redaction costs one anchor, a missed one is a
 * leaked credential.
 */

/** A field Sage can see on the page, as the field test already describes elements. */
export interface LoginCandidateField {
  id: string;
  tag: string;
  type?: string | null;
  name?: string | null;
  placeholder?: string | null;
  label?: string | null;
  autocomplete?: string | null;
  typable?: boolean;
}

export interface LoginFormPlan {
  emailFieldId: string;
  passwordFieldId: string;
  /** the control that submits — may be absent, in which case Enter is pressed in the password field. */
  submitId: string | null;
}

const has = (s: string | null | undefined, re: RegExp) => !!s && re.test(s);
const EMAIL_HINT = /\b(e-?mail|username|user[-_ ]?name|login|account)\b/i;
const PASSWORD_HINT = /\b(pass(word|wd|phrase)?)\b/i;
const SUBMIT_HINT = /\b(log[\s-]?in|sign[\s-]?in|continue|submit|enter|access)\b/i;
/** Controls that look like submit but start a DIFFERENT flow — never press these. */
const NOT_SUBMIT = /\b(sign[\s-]?up|register|create[\s-]?account|forgot|reset|google|github|twitter|x\.com|apple|wallet|metamask|sso|magic|otp)\b/i;

/**
 * Pick the email + password + submit controls from what the page shows. Deliberately conservative:
 * a password INPUT TYPE is the only accepted proof of the password field (never a guess by label),
 * and the email field must be a typable text-ish input that either sits before the password field or
 * carries an explicit email/username hint. Returns null when the page is not a password login — the
 * caller must then leave the wall alone rather than typing a credential into an unknown form.
 */
export function planLoginForm(fields: readonly LoginCandidateField[]): LoginFormPlan | null {
  const typable = fields.filter((f) => f.typable !== false && /^(input|textarea)$/i.test(f.tag));
  const password = typable.find(
    (f) =>
      (f.type ?? "").toLowerCase() === "password" ||
      has(f.autocomplete, /current-password/i),
  );
  if (!password) return null; // no password input → not a password login (OAuth/wallet/OTP)

  const pwIndex = fields.findIndex((f) => f.id === password.id);
  const emailish = typable.filter((f) => {
    if (f.id === password.id) return false;
    const t = (f.type ?? "text").toLowerCase();
    if (["checkbox", "radio", "file", "submit", "button", "hidden"].includes(t)) return false;
    if (t === "email" || has(f.autocomplete, /username|email/i)) return true;
    return (
      has(f.name, EMAIL_HINT) ||
      has(f.placeholder, EMAIL_HINT) ||
      has(f.label, EMAIL_HINT) ||
      // an unlabelled text box immediately above the password is the classic pairing
      fields.findIndex((x) => x.id === f.id) < pwIndex
    );
  });
  // prefer an explicit email/username field; else the last text box before the password.
  const email =
    emailish.find((f) => (f.type ?? "").toLowerCase() === "email" || has(f.autocomplete, /username|email/i)) ??
    emailish.filter((f) => fields.findIndex((x) => x.id === f.id) < pwIndex).pop() ??
    emailish[0];
  if (!email) return null;

  const submit =
    fields.find(
      (f) =>
        !NOT_SUBMIT.test(`${f.label ?? ""} ${f.name ?? ""} ${f.placeholder ?? ""}`) &&
        (["submit"].includes((f.type ?? "").toLowerCase()) ||
          (/^(button)$/i.test(f.tag) && has(f.label, SUBMIT_HINT))),
    ) ?? null;

  return { emailFieldId: email.id, passwordFieldId: password.id, submitId: submit?.id ?? null };
}

/** Did the login land? Pure judgement over the before/after signals the browser reports. */
export function loginSucceeded(after: {
  url: string;
  beforeUrl: string;
  visibleText: string;
  stillHasPasswordField: boolean;
}): boolean {
  const text = after.visibleText.toLowerCase();
  // an explicit failure message is decisive, even if the url changed
  if (/\b(incorrect|invalid|wrong)\b[^.]{0,24}\b(password|email|credentials|login)\b|\blogin failed\b|\bunable to sign in\b/.test(text))
    return false;
  if (after.stillHasPasswordField && after.url === after.beforeUrl) return false;
  // left the login url, or the password field is gone → we are somewhere else
  return after.url !== after.beforeUrl || !after.stillHasPasswordField;
}

/* ─────────────────────────── REDACTION (safety-critical) ─────────────────────────── */

/** Replacement marker — visible in the corpus so a human can see something was removed. */
export const REDACTED = "[redacted]";

/**
 * Patterns for values that must NEVER survive into the corpus (and therefore never into a public
 * mission anchor). Ordered specific → general. Deliberately aggressive: losing an anchor is cheap,
 * leaking a founder's API key is not.
 */
const SECRET_PATTERNS: RegExp[] = [
  // provider-shaped API keys (OpenAI/Anthropic/Google/Stripe/GitHub/Slack/AWS + generic ak_/pk_/rk_)
  /\b(sk|pk|rk|ak|api|key)[-_](?:live|test|prod|proj)?[-_]?[A-Za-z0-9]{12,}\b/gi,
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{16,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{20,}\b/g,
  // bearer tokens + JWTs
  /\bBearer\s+[A-Za-z0-9._-]{16,}\b/gi,
  /\beyJ[A-Za-z0-9._-]{20,}\b/g,
  // long opaque hex/base64 blobs (session tokens, secrets) — 32+ chars of continuous entropy
  /\b[A-Fa-f0-9]{32,}\b/g,
  /\b[A-Za-z0-9+/]{40,}={0,2}\b/g,
  // private keys / seed material
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  // email addresses (a logged-in dashboard shows the founder's own, and testers' too)
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
];

/**
 * Scrub every secret-shaped value out of text harvested from an AUTHENTICATED session, plus the
 * credential values themselves (in case a form echoes them back). Pure and idempotent.
 *
 * Applied to state text, element labels and doc excerpts BEFORE they can become corpus — which is
 * the only thing standing between "Sage logged in" and "a founder's API key is quoted verbatim on a
 * public mission card".
 */
export function redactSecrets(text: string, credentials?: { email?: string; password?: string }): string {
  let out = text ?? "";
  // the credential values first — an exact match is the one leak we know for certain is possible
  for (const v of [credentials?.password, credentials?.email]) {
    if (v && v.length >= 3) out = out.split(v).join(REDACTED);
  }
  for (const re of SECRET_PATTERNS) out = out.replace(re, REDACTED);
  return out;
}

/** True when the text still carries something secret-shaped — the assertion a caller can gate on. */
export function containsSecret(text: string): boolean {
  return redactSecrets(text) !== text;
}
