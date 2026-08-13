import { describe, it, expect } from "vitest";
import { fetchOtpCode, type MailboxAccess } from "./otp-mailbox";

const access: MailboxAccess = { host: "imap.test", user: "t@e.co", appPassword: "app-pw" };
const noSleep = async () => {};

describe("fetchOtpCode — reads the code it just caused, or nothing", () => {
  it("returns the code from a freshly arrived message", async () => {
    const code = await fetchOtpCode(access, new Date(0), {
      fetchRecent: async () => [{ subject: "123456 is your ClawUp verification code", text: "" }],
      sleep: noSleep,
    });
    expect(code).toBe("123456");
  });

  it("takes the first entry when the source is already newest-first and untimed", async () => {
    // the real reader returns IMAP sequence order, newest FIRST — so no reversal is applied.
    const code = await fetchOtpCode(access, new Date(0), {
      fetchRecent: async () => [
        { subject: "999888 is your verification code", text: "" },
        { subject: "111111 is your verification code", text: "" },
      ],
      sleep: noSleep,
    });
    expect(code).toBe("999888");
  });

  it("keeps polling until the mail lands, then stops", async () => {
    let calls = 0;
    const code = await fetchOtpCode(access, new Date(0), {
      fetchRecent: async () => (++calls < 3 ? [] : [{ subject: "Your code is 424242", text: "" }]),
      sleep: noSleep,
    });
    expect(code).toBe("424242");
    expect(calls).toBe(3);
  });

  it("gives up quietly when nothing ever arrives (a wall, not an error)", async () => {
    let t = 0;
    const code = await fetchOtpCode(access, new Date(0), {
      fetchRecent: async () => [],
      sleep: noSleep,
      now: () => (t += 10_000),
    });
    expect(code).toBeNull();
  });

  it("returns null — never throws — when the mailbox cannot be read", async () => {
    const code = await fetchOtpCode(access, new Date(0), {
      fetchRecent: async () => { throw new Error("auth failed"); },
      sleep: noSleep,
    });
    expect(code).toBeNull();
  });
});

/**
 * THE STALE CODE (measured on ClawUp job mzQGzfo_0J8s): IMAP's SINCE is DATE-granular, so a mailbox
 * that already received a code earlier the same day hands back that older mail too. Sage typed it,
 * the sign-in failed, and — because success was judged on a password field an email-code form does
 * not have — it reported "signed in" anyway. Both halves are pinned: here, and in otp-login.test.ts.
 */
describe("only the code that arrived AFTER the request is used", () => {
  const requestedAt = new Date("2026-08-13T09:00:00Z");

  it("ignores an older code from earlier the same day", async () => {
    const code = await fetchOtpCode(access, requestedAt, {
      fetchRecent: async () => [
        { subject: "111111 is your verification code", text: "", at: new Date("2026-08-13T07:30:00Z") },
        { subject: "656565 is your verification code", text: "", at: new Date("2026-08-13T09:00:04Z") },
      ],
      sleep: noSleep,
    });
    expect(code).toBe("656565");
  });

  it("picks the newest when several arrive after the request", async () => {
    const code = await fetchOtpCode(access, requestedAt, {
      fetchRecent: async () => [
        { subject: "222222 is your verification code", text: "", at: new Date("2026-08-13T09:00:05Z") },
        { subject: "333333 is your verification code", text: "", at: new Date("2026-08-13T09:00:20Z") },
      ],
      sleep: noSleep,
    });
    expect(code).toBe("333333");
  });

  it("keeps waiting when only stale mail is present", async () => {
    let t = 0;
    const code = await fetchOtpCode(access, requestedAt, {
      fetchRecent: async () => [
        { subject: "999999 is your verification code", text: "", at: new Date("2026-08-13T06:00:00Z") },
      ],
      sleep: noSleep,
      now: () => (t += 10_000),
    });
    expect(code).toBeNull();
  });
});

/**
 * THE MESSAGE-ID TRAP (ClawUp job -O1PL4k4ohhA, found by reading the live mail). Searching the raw
 * MIME source let a Message-ID fragment — 157475, inside
 * "<6a7d7ffc.574ab080.157475.15ee...@mx.google.com>" — beat the real code 220322, which sat right
 * after "Your ClawUp verification code is:". Headers are routing metadata, not the message.
 */
describe("only the message BODY is searched for a code", () => {
  const RAW = [
    "Received: by mx.google.com with SMTP id 998877665544;",
    "dmarc=pass (p=NONE sp=NONE dis=NONE) header.from=eigen.market",
    "Message-ID: <6a7d7ffc.574ab080.157475.15eeSMTPIN_ADDED_BROKEN@mx.google.com>",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Your ClawUp verification code is: 220322",
    "This code expires in 5 minutes.",
  ].join("\r\n");

  it("reads the code from the body, never a header fragment", async () => {
    const code = await fetchOtpCode(access, new Date(0), {
      fetchRecent: async () => [{ subject: "ClawUp email verification code", text: RAW.slice(RAW.search(/\r?\n\r?\n/)) }],
      sleep: noSleep,
    });
    expect(code).toBe("220322");
    expect(code).not.toBe("157475");
  });
});
