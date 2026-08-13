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

/**
 * THE FINAL SWEEP — redact EVERY string in a field-test summary produced while credentials were in
 * play. One choke point, applied at the boundary, instead of trusting each harvest site to remember.
 *
 * Measured live (token-watcher VQuT4qQSnEvl, real test account): per-capture redaction covered the
 * exploration states, and the credential still reached the stored result through THREE other paths —
 * the url-evidence page crawl (which reuses the signed-in session), those pages' CTA lists, and the
 * VISION descriptions of authenticated screenshots, where the model simply read the account email off
 * the screen. Every one of those is corpus, and corpus becomes public mission anchors.
 *
 * So the rule is structural: if credentials were supplied for this run, nothing leaves the field test
 * unswept. Deep, total, and idempotent — a new harvest path added tomorrow is covered the day it
 * ships, because it cannot route around the boundary.
 */
export function redactFieldTestDeep<T>(node: T, credentials?: { email?: string; password?: string }): T {
  if (typeof node === "string") return redactSecrets(node, credentials) as unknown as T;
  if (Array.isArray(node)) return node.map((v) => redactFieldTestDeep(v, credentials)) as unknown as T;
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      out[k] = redactFieldTestDeep(v, credentials);
    }
    return out as unknown as T;
  }
  return node;
}


/* ─────────────────────── EMAIL-CODE (OTP) LOGIN — the passwordless wall ─────────────────────── */

/**
 * THE SHAPE MOST PRODUCTS ACTUALLY SHIP NOW. ClawUp, and every Privy/Dynamic-style product, offers
 * "sign in with email" that sends a VERIFICATION CODE instead of taking a password. `planLoginForm`
 * correctly refuses those (no password input), which left the single most common modern login
 * unreachable — including the sponsor's own product, the anchor campaign.
 *
 * The flow has one more beat than a password form: type the email, press the control that SENDS the
 * code, wait for it to arrive in a mailbox Sage can read, type it, submit. Everything here is the
 * pure part — which controls to use, and how to read a code out of an email — so the fiddly bits are
 * provable offline.
 */
export interface OtpFormPlan {
  emailFieldId: string;
  /** the control that requests the code ("Send Code"). Absent on forms that mail it automatically. */
  sendCodeId: string | null;
  /** the field the code goes in. May only appear AFTER the code is requested — see `codeFieldHint`. */
  codeFieldId: string | null;
  submitId: string | null;
}

const SEND_CODE_HINT = /\b(send|get|request|email)\b[^.]{0,16}\b(code|otp|link|pin)\b|\bsend\s*code\b|\bcontinue\s+with\s+email\b/i;
const CODE_FIELD_HINT = /\b(verification|confirm\w*|security|one[-\s]?time|otp|pin|code)\b/i;

/**
 * Plan an EMAIL-CODE login. Returns null when the page is not one — in particular it refuses any form
 * that has a password input (that is `planLoginForm`'s job) so the two can never both fire, and it
 * refuses when there is no email field to start from.
 *
 * `codeFieldId` is allowed to be null: many products only reveal the code box after the code is sent,
 * so the caller re-plans once the request has gone out.
 */
export function planOtpForm(fields: readonly LoginCandidateField[]): OtpFormPlan | null {
  const typable = fields.filter((f) => f.typable !== false && /^(input|textarea)$/i.test(f.tag));
  if (typable.some((f) => (f.type ?? "").toLowerCase() === "password")) return null; // password form
  const email =
    typable.find((f) => (f.type ?? "").toLowerCase() === "email") ??
    typable.find(
      (f) =>
        has(f.autocomplete, /email|username/i) ||
        has(f.name, EMAIL_HINT) ||
        has(f.placeholder, EMAIL_HINT) ||
        has(f.label, EMAIL_HINT),
    );
  if (!email) return null;

  const codeField =
    typable.find(
      (f) =>
        f.id !== email.id &&
        (has(f.name, CODE_FIELD_HINT) || has(f.placeholder, CODE_FIELD_HINT) || has(f.label, CODE_FIELD_HINT) ||
          has(f.autocomplete, /one-time-code/i)),
    ) ?? null;

  const text = (f: LoginCandidateField) => `${f.label ?? ""} ${f.name ?? ""} ${f.placeholder ?? ""}`;
  const sendCode = fields.find((f) => f.typable === false && SEND_CODE_HINT.test(text(f))) ?? null;
  // the submit is a sign-in control that is NOT the send-code button and not a social/signup route
  const submit =
    fields.find(
      (f) =>
        f.typable === false &&
        f.id !== sendCode?.id &&
        !NOT_SUBMIT.test(text(f)) &&
        !SEND_CODE_HINT.test(text(f)) &&
        (SUBMIT_HINT.test(text(f)) || (f.type ?? "").toLowerCase() === "submit"),
    ) ?? null;

  if (!sendCode && !codeField) return null; // nothing here says "we will email you a code"
  return { emailFieldId: email.id, sendCodeId: sendCode?.id ?? null, codeFieldId: codeField?.id ?? null, submitId: submit?.id ?? null };
}

/**
 * Read the verification code out of an email. Subject first (products put it there for exactly this
 * reason), then the body, and only from a context that CLAIMS to be a code — a bare number in a
 * marketing footer must never be mistaken for one.
 *
 * Returns the code, or null when nothing convincing is present. Null is the honest answer: a wrong
 * code just fails the login, and inventing one wastes an attempt against a founder's product.
 */
export function extractOtpCode(subject: string, body: string): string | null {
  const KEYWORD = /(code|otp|pin|passcode|token|verification)/i;
  // A code-shaped token: 4-8 digits, or 6-8 upper-alphanumeric (products use both).
  const CANDIDATE = /\b([0-9]{4,8}|[A-Z0-9]{6,8})\b/g;
  const WINDOW = 40; // chars either side that may carry the word "code"

  for (const source of [subject ?? "", body ?? ""]) {
    if (!source) continue;
    CANDIDATE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = CANDIDATE.exec(source)) !== null) {
      const value = m[1];
      // reject tokens that are plainly not codes: a year, a round marketing number
      if (/^[0-9]{4}$/.test(value) && Number(value) >= 1900 && Number(value) <= 2100) continue;
      // The keyword may sit on EITHER side — "123456 is your code" and "your code is 123456" are
      // both how products write it, and an after-only rule missed the first (and every subject that
      // leads with the number, which is the most common shape of all).
      const before = source.slice(Math.max(0, m.index - WINDOW), m.index);
      const after = source.slice(m.index + value.length, m.index + value.length + WINDOW);
      if (KEYWORD.test(before) || KEYWORD.test(after)) return value;
    }
  }
  // A subject that is ONLY the code, with no words at all around it.
  const bare = (subject ?? "").trim();
  if (/^[0-9]{4,8}$/.test(bare)) return bare;
  return null;
}


/**
 * Did the EMAIL-CODE login land? Judged on its own evidence, never the password form's.
 *
 * `loginSucceeded` asks whether a PASSWORD field is still present — and an email-code form has none,
 * so it answered "true" for every attempt, success or failure. That produced a false "signed in with
 * the emailed code" on a run that had actually entered a wrong code (caught by the founder reading
 * the screenshots, which is exactly the review a claim like this must survive).
 *
 * Success here means: no error on screen, AND either we left the login page or the code box is gone.
 * A code box still sitting on the same page is a failed attempt, which is the common case.
 */
export function otpLoginSucceeded(after: {
  url: string;
  beforeUrl: string;
  visibleText: string;
  stillHasCodeField: boolean;
}): boolean {
  const text = (after.visibleText ?? "").toLowerCase();
  if (
    /\b(invalid|incorrect|wrong|expired|不正确)\b[^.]{0,28}\b(code|otp|pin|verification)\b|\bcode (is )?(invalid|incorrect|expired)\b|\btry again\b/.test(
      text,
    )
  )
    return false;
  if (after.stillHasCodeField && after.url === after.beforeUrl) return false;
  return after.url !== after.beforeUrl || !after.stillHasCodeField;
}
