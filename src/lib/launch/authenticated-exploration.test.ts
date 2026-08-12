import { describe, it, expect } from "vitest";
import {
  planLoginForm,
  loginSucceeded,
  redactSecrets,
  containsSecret,
  REDACTED,
  redactFieldTestDeep,
  type LoginCandidateField,
} from "./authenticated-exploration";

const f = (o: Partial<LoginCandidateField> & { id: string; tag: string }): LoginCandidateField => ({
  typable: true,
  ...o,
});

describe("planLoginForm — only ever types into a REAL password login", () => {
  it("finds email + password + submit on a classic form", () => {
    const plan = planLoginForm([
      f({ id: "e", tag: "input", type: "email", name: "email" }),
      f({ id: "p", tag: "input", type: "password", name: "password" }),
      f({ id: "s", tag: "button", label: "Sign in", typable: false }),
    ]);
    expect(plan).toEqual({ emailFieldId: "e", passwordFieldId: "p", submitId: "s" });
  });

  it("pairs an unlabelled text box that sits above the password", () => {
    const plan = planLoginForm([
      f({ id: "u", tag: "input", type: "text" }),
      f({ id: "p", tag: "input", type: "password" }),
    ]);
    expect(plan?.emailFieldId).toBe("u");
    expect(plan?.submitId).toBeNull(); // caller presses Enter
  });

  it("REFUSES when there is no password input (OAuth / wallet / OTP walls)", () => {
    expect(planLoginForm([f({ id: "g", tag: "button", label: "Continue with Google", typable: false })])).toBeNull();
    expect(planLoginForm([f({ id: "w", tag: "button", label: "Connect Wallet", typable: false })])).toBeNull();
    expect(planLoginForm([f({ id: "e", tag: "input", type: "email" })])).toBeNull();
  });

  it("never picks a signup/forgot/social control as the submit button", () => {
    const plan = planLoginForm([
      f({ id: "e", tag: "input", type: "email" }),
      f({ id: "p", tag: "input", type: "password" }),
      f({ id: "su", tag: "button", label: "Sign up", typable: false }),
      f({ id: "fg", tag: "button", label: "Forgot password?", typable: false }),
      f({ id: "gg", tag: "button", label: "Sign in with Google", typable: false }),
    ]);
    expect(plan?.submitId).not.toBe("su");
    expect(plan?.submitId).not.toBe("fg");
    expect(plan?.submitId).not.toBe("gg");
  });
});

describe("loginSucceeded — honest about whether we actually got in", () => {
  const base = { beforeUrl: "https://x.test/login", stillHasPasswordField: false, visibleText: "Dashboard" };
  it("true when the url moved on", () => {
    expect(loginSucceeded({ ...base, url: "https://x.test/app" })).toBe(true);
  });
  it("true when the password field is gone even at the same url (SPA)", () => {
    expect(loginSucceeded({ ...base, url: base.beforeUrl })).toBe(true);
  });
  it("false when still on the login page with the field present", () => {
    expect(loginSucceeded({ ...base, url: base.beforeUrl, stillHasPasswordField: true })).toBe(false);
  });
  it("false on an explicit error, even if the url changed", () => {
    expect(
      loginSucceeded({ ...base, url: "https://x.test/login?e=1", visibleText: "Invalid email or password" }),
    ).toBe(false);
  });
});

describe("redactSecrets — the layer that stands between logging in and leaking a founder's keys", () => {
  it("removes provider API keys, bearer tokens, JWTs and private keys", () => {
    const samples = [
      "Your key: sk-abcd1234efgh5678ijkl",
      "ghp_ABCDEFGHIJKLMNOPQRST1234",
      "Authorization: Bearer abcdef1234567890abcdef",
      "token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
      "AKIAIOSFODNN7EXAMPLE",
      "-----BEGIN PRIVATE KEY-----abc\ndef-----END PRIVATE KEY-----",
    ];
    for (const s of samples) {
      expect(containsSecret(s), `should redact: ${s}`).toBe(true);
      expect(redactSecrets(s)).toContain(REDACTED);
    }
  });

  it("removes email addresses (a dashboard shows the founder's own)", () => {
    expect(redactSecrets("Signed in as zainab@example.com")).toBe(`Signed in as ${REDACTED}`);
  });

  it("removes the credential VALUES themselves if a form echoes them back", () => {
    const out = redactSecrets("Welcome tester@mail.com / hunter2GoodPass", {
      email: "tester@mail.com",
      password: "hunter2GoodPass",
    });
    expect(out).not.toContain("hunter2GoodPass");
    expect(out).not.toContain("tester@mail.com");
  });

  it("leaves ordinary product text alone — the corpus must stay useful", () => {
    const text = "Request Log shows Time, Endpoint, Model, Cost and Status for every call.";
    expect(redactSecrets(text)).toBe(text);
    expect(containsSecret(text)).toBe(false);
  });

  it("is idempotent", () => {
    const once = redactSecrets("key sk-abcd1234efgh5678ijkl");
    expect(redactSecrets(once)).toBe(once);
  });
});

/**
 * THE LEAK THIS SUITE MISSED (measured live on token-watcher vNHD6UOmojlm, with a real test account).
 *
 * The pure functions were correct; the WIRING was not. The redaction window opened AFTER the login
 * attempt returned, but attemptLogin captures its own outcome state — the first authenticated screen,
 * the one most likely to render "Signed in as <email>". That state fell outside the window and the
 * credential reached the stored result. Docs read while signed in were harvested outside capture()
 * entirely and were never redacted at all.
 *
 * These pin the RULE the wiring must satisfy: from the first keystroke of a credential onward, every
 * piece of text that can become corpus — states AND doc excerpts — is redacted.
 */
describe("the redaction window covers the login moment itself", () => {
  const creds = { email: "founder@startup.io", password: "S3cretLaunchPass" };

  it("scrubs the FIRST authenticated screen (the login-outcome state)", () => {
    const firstScreen = "Console — Signed in as founder@startup.io — API key sk-live-1111aaaa2222bbbb";
    const out = redactSecrets(firstScreen, creds);
    expect(out).not.toContain("founder@startup.io");
    expect(out).not.toContain("sk-live-1111aaaa2222bbbb");
    expect(out).toContain("Console");
  });

  it("scrubs a DOC read while signed in (harvested outside capture)", () => {
    const doc = "Getting started — your key: sk-live-99998888777766665555. Contact founder@startup.io.";
    const out = redactSecrets(doc, creds);
    expect(out).not.toContain("sk-live-99998888777766665555");
    expect(out).not.toContain("founder@startup.io");
    expect(out).toContain("Getting started");
  });

  it("a failed login leaves public text untouched (window must close again)", () => {
    const publicPage = "Sign in to Token Watcher — Invalid email or password";
    expect(redactSecrets(publicPage, creds)).toBe(publicPage);
  });
});

/**
 * THE BOUNDARY SWEEP. Per-capture redaction missed three harvest paths that reach the same artifact
 * (the page crawl, its CTA lists, and vision descriptions of authenticated screenshots) — each leaked
 * a real credential into a stored result. This pins the structural rule: given credentials, NOTHING
 * in a field-test summary carries a secret, however deeply nested or newly added.
 */
describe("redactFieldTestDeep — nothing leaves the field test unswept", () => {
  const creds = { email: "founder@startup.io", password: "S3cretLaunchPass" };

  it("scrubs every nested path, including ones per-capture redaction never touched", () => {
    const summary = {
      mode: "interactive",
      states: [{ trigger: "opened /app", visibleTextExcerpt: "Signed in as founder@startup.io" }],
      pages: [
        {
          url: "https://x.test/app",
          ctas: ["founder@startup.io", "Overview"],
          visibleTextExcerpt: "api governance founder@startup.io NAVIGATION",
        },
      ],
      visionObservations: [
        { uiElements: [{ label: "founder@startup.io" }, { label: "Endpoints" }] },
      ],
      docs: [{ excerpt: "your key sk-live-aaaa1111bbbb2222 and S3cretLaunchPass" }],
    };
    const out = redactFieldTestDeep(summary, creds);
    const blob = JSON.stringify(out);
    for (const secret of [creds.email, creds.password, "sk-live-aaaa1111bbbb2222"]) {
      expect(blob, `leaked: ${secret}`).not.toContain(secret);
    }
    // structure and product knowledge survive — a swept artifact must still be useful
    expect(out.states[0].trigger).toBe("opened /app");
    expect(out.pages[0].ctas[1]).toBe("Overview");
    expect(out.visionObservations[0].uiElements[1].label).toBe("Endpoints");
    expect(blob).toContain("NAVIGATION");
  });

  it("preserves non-string values and is idempotent", () => {
    const once = redactFieldTestDeep({ n: 5, b: true, z: null, s: "founder@startup.io" }, creds);
    expect(once).toEqual({ n: 5, b: true, z: null, s: "[redacted]" });
    expect(redactFieldTestDeep(once, creds)).toEqual(once);
  });
});
