import { describe, it, expect, beforeAll } from "vitest";
import { sealTestAccount, openTestAccount, validateTestAccount } from "./test-account-crypto";

beforeAll(() => { process.env.SAGE_SESSION_SECRET = "test-secret-value-long-enough"; });

describe("test-account credentials at rest", () => {
  it("round-trips and never stores the plaintext", () => {
    const acct = {
      email: "tester@example.com",
      password: "CorrectHorse9",
      mailbox: { host: "imap.gmail.com", user: "tester@example.com", appPassword: "mail-app-pw" },
    };
    const sealed = sealTestAccount(acct)!;
    expect(sealed).not.toContain("CorrectHorse9");
    expect(sealed).not.toContain("tester@example.com");
    expect(sealed).not.toContain("mail-app-pw"); // the mailbox secret is sealed too
    expect(openTestAccount(sealed)).toEqual(acct);
  });

  it("refuses tampered or foreign ciphertext instead of returning garbage", () => {
    const sealed = sealTestAccount({ email: "a@b.co", password: "pw12345" })!;
    const parts = sealed.split(".");
    const tampered = [parts[0], parts[1], parts[2], Buffer.from("evil").toString("base64url")].join(".");
    expect(openTestAccount(tampered)).toBeNull();
    expect(openTestAccount("v1.a.b.c")).toBeNull();
    expect(openTestAccount("not-sealed")).toBeNull();
    expect(openTestAccount(null)).toBeNull();
  });

  it("REFUSES to seal when no server secret is configured (never plaintext by accident)", () => {
    const prev = process.env.SAGE_SESSION_SECRET;
    process.env.SAGE_SESSION_SECRET = "";
    expect(sealTestAccount({ email: "a@b.co", password: "pw12345" })).toBeNull();
    process.env.SAGE_SESSION_SECRET = prev;
  });

  it("validates founder input without echoing it", () => {
    expect(validateTestAccount(null)).toEqual({ ok: true, value: null });
    expect(validateTestAccount({ email: "", password: "" })).toEqual({ ok: true, value: null });
    expect(validateTestAccount({ email: "a@b.co" })).toEqual({
      ok: false,
      error: "A test account needs a password, or a mailbox Sage can read the sign-in code from.",
    });
    expect(validateTestAccount({ email: "nope", password: "x" }).ok).toBe(false);
    const good = validateTestAccount({ email: "t@e.co", password: "pw" });
    expect(good).toEqual({ ok: true, value: { email: "t@e.co", password: "pw", mailbox: null } });

    // PASSWORDLESS (ClawUp / Privy): an email + a readable mailbox IS the whole credential.
    const otp = validateTestAccount({
      email: "t@e.co",
      mailbox: { host: "imap.gmail.com", user: "t@e.co", appPassword: "app-pw" },
    });
    expect(otp.ok).toBe(true);
    expect((otp as { value: { mailbox: unknown } }).value.mailbox).toEqual({
      host: "imap.gmail.com",
      user: "t@e.co",
      appPassword: "app-pw",
    });
  });
});

/**
 * THE PASSWORDLESS SEAL (measured: three live ClawUp runs never attempted the wall). An email-code
 * product has NO password — the mailbox is the second factor — and the opener rejected exactly that
 * shape, so the field test received no credential at all.
 */
describe("a mailbox-only credential survives the round trip", () => {
  it("opens an email + mailbox credential with no password", () => {
    const acct = {
      email: "briefaiagent@example.com",
      password: "",
      mailbox: { host: "imap.gmail.com", user: "briefaiagent@example.com", appPassword: "app-pw-here" },
    };
    const sealed = sealTestAccount(acct)!;
    expect(sealed).not.toContain("app-pw-here");
    const opened = openTestAccount(sealed);
    expect(opened).not.toBeNull();
    expect(opened!.email).toBe(acct.email);
    expect(opened!.mailbox).toEqual(acct.mailbox);
  });

  it("still refuses a credential with no email at all", () => {
    const sealed = sealTestAccount({ email: "", password: "pw" });
    expect(sealed ? openTestAccount(sealed) : null).toBeNull();
  });
});
