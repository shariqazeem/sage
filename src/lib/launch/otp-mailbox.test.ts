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

  it("prefers the NEWEST message when several are present", async () => {
    const code = await fetchOtpCode(access, new Date(0), {
      fetchRecent: async () => [
        { subject: "111111 is your verification code", text: "" },
        { subject: "999888 is your verification code", text: "" },
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
