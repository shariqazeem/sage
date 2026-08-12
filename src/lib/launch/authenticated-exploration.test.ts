import { describe, it, expect } from "vitest";
import {
  planLoginForm,
  loginSucceeded,
  redactSecrets,
  containsSecret,
  REDACTED,
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
