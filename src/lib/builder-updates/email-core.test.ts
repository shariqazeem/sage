import { describe, expect, it } from "vitest";
import { cleanEmail, dueByEmail, emailConfigured, emailFor, emailKind, maskEmail, readStopToken, stopToken } from "./email-core";

/** Builder updates by email, the pure parts: off until set up, masked on a page, one signed way to stop. */
const ENV = { SAGE_SESSION_SECRET: "a-test-secret-of-enough-length" };
const WHO = `0x${"ab".repeat(20)}`;

describe("email is off until it is set up", () => {
  it("needs both settings", () => {
    expect(emailConfigured({})).toBe(false);
    expect(emailConfigured({ RESEND_API_KEY: "re_x" })).toBe(false);
    expect(emailConfigured({ SAGE_EMAIL_FROM: "Sage <updates@sagepays.xyz>" })).toBe(false);
    expect(emailConfigured({ RESEND_API_KEY: " ", SAGE_EMAIL_FROM: "Sage <updates@sagepays.xyz>" })).toBe(false);
    expect(emailConfigured({ RESEND_API_KEY: "re_x", SAGE_EMAIL_FROM: "not an address" })).toBe(false);
    expect(emailConfigured({ RESEND_API_KEY: "re_x", SAGE_EMAIL_FROM: "Sage <updates@sagepays.xyz>" })).toBe(true);
  });
});

describe("an address", () => {
  it("is shown only masked", () => {
    expect(maskEmail("shariq@gmail.com")).toBe("sh…@gmail.com");
    expect(maskEmail("ab@x.io")).toBe("a…@x.io");
    expect(maskEmail("a@x.io")).toBe("a…@x.io");
    expect(maskEmail("nonsense")).toBe("…");
    expect(maskEmail("shariq@gmail.com")).not.toContain("shariq");
  });

  it("is one plain address or nothing", () => {
    expect(cleanEmail(" Shariq@Gmail.com ")).toBe("shariq@gmail.com");
    for (const bad of ["", "a@b", "a b@c.com", "a@b.com, c@d.com", "<a@b.com>", "a@b.com\nbcc: x@y.com", null, 5]) expect(cleanEmail(bad), String(bad)).toBeNull();
  });
});

describe("the stop link's token", () => {
  it("names one builder, is signed, and does not expire", () => {
    const t = stopToken(WHO, ENV)!;
    expect(t).toMatch(/^[A-Za-z0-9_-]+\.[0-9a-f]{40}$/);
    expect(readStopToken(t, ENV)).toBe(WHO);
    // the same token every time: an old email's link still works
    expect(stopToken(WHO.toUpperCase().replace("0X", "0x"), ENV)).toBe(t);
  });

  it("is refused when it was not signed here, was changed, or is for someone else", () => {
    const t = stopToken(WHO, ENV)!;
    const [who, sig] = t.split(".");
    const other = Buffer.from(`0x${"cd".repeat(20)}`).toString("base64url");
    expect(readStopToken(`${other}.${sig}`, ENV)).toBeNull();
    expect(readStopToken(`${who}.${"0".repeat(40)}`, ENV)).toBeNull();
    expect(readStopToken(t, { SAGE_SESSION_SECRET: "another-secret-of-enough-length" })).toBeNull();
    for (const junk of ["", "x", "a.b", null, 4, `${who}.${sig}00`]) expect(readStopToken(junk, ENV)).toBeNull();
  });

  it("is not made without a secret, so no email goes out without a way to stop", () => {
    expect(stopToken(WHO, {})).toBeNull();
    expect(stopToken(WHO, { SAGE_SESSION_SECRET: "short" })).toBeNull();
    expect(readStopToken("anything.at-all", {})).toBeNull();
  });
});

describe("a notice as an email", () => {
  it("is Telegram's words, the first sentence as the subject, and the footer with the way to stop", () => {
    const m = emailFor("The first answer to your test of umanity.gives is in.\nhttps://sagepays.xyz/t/abc#people", "https://sagepays.xyz/api/updates/email/stop?t=tok");
    expect(m.subject).toBe("The first answer to your test of umanity.gives is in");
    expect(m.text).toBe(
      "The first answer to your test of umanity.gives is in.\nhttps://sagepays.xyz/t/abc#people\n\nYou get these because you turned on email updates for your tests on Sage. Stop them: https://sagepays.xyz/api/updates/email/stop?t=tok",
    );
    // a host's dot is not the end of the sentence
    expect(emailFor("Your test of umanity.gives has ended: 2 of 2 people paid. What they found is here.\nurl", "s").subject).toBe("Your test of umanity.gives has ended: 2 of 2 people paid");
  });
});

describe("which notices are due by email", () => {
  it("is each kind once on this channel, whatever Telegram was sent", () => {
    const due = [{ kind: "first-answer" }, { kind: "held:s1" }, { kind: "findings" }];
    expect(dueByEmail(due, new Set(["first-answer", "held:s1", "findings"])).map((n) => n.kind)).toEqual(["first-answer", "held:s1", "findings"]);
    expect(dueByEmail(due, new Set([emailKind("first-answer"), "findings"])).map((n) => n.kind)).toEqual(["held:s1", "findings"]);
    expect(emailKind("done")).toBe("email:done");
  });
});
