import { describe, it, expect } from "vitest";
import { planOtpForm, extractOtpCode, type LoginCandidateField } from "./authenticated-exploration";

const f = (o: Partial<LoginCandidateField> & { id: string; tag: string }): LoginCandidateField => ({
  typable: /^(input|textarea)$/i.test(o.tag),
  ...o,
});

/**
 * EMAIL-CODE LOGIN — the shape ClawUp and most Privy/Dynamic products actually ship. The password
 * planner correctly refuses these, which left the single most common modern login unreachable.
 */
describe("planOtpForm — the passwordless email wall", () => {
  it("plans ClawUp's shape: email + Send Code + code box + Sign in", () => {
    const plan = planOtpForm([
      f({ id: "em", tag: "input", type: "email", placeholder: "you@company.com" }),
      f({ id: "code", tag: "input", type: "text", placeholder: "Verification code (1 min)" }),
      f({ id: "send", tag: "button", label: "Send Code" }),
      f({ id: "go", tag: "button", label: "Sign in" }),
    ]);
    expect(plan).toEqual({ emailFieldId: "em", sendCodeId: "send", codeFieldId: "code", submitId: "go" });
  });

  it("works when the code box only appears AFTER the code is requested", () => {
    const plan = planOtpForm([
      f({ id: "em", tag: "input", type: "email" }),
      f({ id: "send", tag: "button", label: "Send verification code" }),
    ]);
    expect(plan?.emailFieldId).toBe("em");
    expect(plan?.sendCodeId).toBe("send");
    expect(plan?.codeFieldId).toBeNull(); // caller re-plans after sending
  });

  it("REFUSES a password form (that is the other planner's job — they can never both fire)", () => {
    expect(
      planOtpForm([
        f({ id: "em", tag: "input", type: "email" }),
        f({ id: "pw", tag: "input", type: "password" }),
        f({ id: "go", tag: "button", label: "Sign in" }),
      ]),
    ).toBeNull();
  });

  it("REFUSES a page with no email-code affordance at all (pure OAuth wall)", () => {
    expect(planOtpForm([f({ id: "g", tag: "button", label: "Continue with Google" })])).toBeNull();
    expect(planOtpForm([f({ id: "em", tag: "input", type: "email" })])).toBeNull();
  });

  it("never mistakes the signup/social control for the submit", () => {
    const plan = planOtpForm([
      f({ id: "em", tag: "input", type: "email" }),
      f({ id: "code", tag: "input", placeholder: "One-time code" }),
      f({ id: "send", tag: "button", label: "Send Code" }),
      f({ id: "gh", tag: "button", label: "Continue with GitHub" }),
      f({ id: "su", tag: "button", label: "Sign up" }),
    ]);
    expect(plan?.submitId).not.toBe("gh");
    expect(plan?.submitId).not.toBe("su");
  });
});

describe("extractOtpCode — read the code, or admit there isn't one", () => {
  it("reads it from the subject (where products put it)", () => {
    expect(extractOtpCode("123456 is your ClawUp verification code", "")).toBe("123456");
    expect(extractOtpCode("Your code: 4821", "")).toBe("4821");
    expect(extractOtpCode("847213", "")).toBe("847213");
  });

  it("reads it from the body when the subject has none", () => {
    expect(extractOtpCode("Sign in to ClawUp", "Your verification code is 902144. It expires in 1 minute.")).toBe("902144");
    expect(extractOtpCode("", "Enter this OTP: A1B2C3 to continue")).toBe("A1B2C3");
  });

  it("returns null rather than grabbing a random number from marketing copy", () => {
    expect(extractOtpCode("Welcome to ClawUp", "Join 200000 developers building agents. Unsubscribe here.")).toBeNull();
    expect(extractOtpCode("Your receipt", "Order 2024 total $42.19 — thanks!")).toBeNull();
  });
});
