import { describe, it, expect, beforeAll } from "vitest";
import { sealTestAccount, openTestAccount } from "./test-account-crypto";
import { redactSecrets } from "./authenticated-exploration";

beforeAll(() => { process.env.SAGE_SESSION_SECRET = "test-secret-value-long-enough"; });

/**
 * END-TO-END CREDENTIAL SAFETY. The founder's password travels: form -> API -> sealed at the door ->
 * DB -> opened at run time -> browser login. This pins the two properties that make that acceptable:
 * it is never at rest in plaintext, and nothing it touches can carry it (or a dashboard secret) into
 * the corpus that becomes public mission copy.
 */
describe("a founder's test-account credentials never leak", () => {
  const acct = { email: "founder@startup.io", password: "S3cretLaunchPass", mailbox: null };

  it("is unreadable at rest and recoverable only with the server secret", () => {
    const sealed = sealTestAccount(acct)!;
    expect(sealed).not.toContain(acct.password);
    expect(sealed).not.toContain(acct.email);
    expect(openTestAccount(sealed)).toEqual(acct);

    const prev = process.env.SAGE_SESSION_SECRET;
    process.env.SAGE_SESSION_SECRET = "a-different-server-secret-entirely";
    expect(openTestAccount(sealed)).toBeNull(); // another server cannot open it
    process.env.SAGE_SESSION_SECRET = prev;
  });

  it("cannot reach the corpus even if the product echoes it back on screen", () => {
    const dashboard = [
      "Welcome back, founder@startup.io",
      "Session token: eyJhbGciOiJIUzI1NiJ9.abcdefghijklmnop",
      "Your password is S3cretLaunchPass",
      "API key sk-live-aaaabbbbccccdddd1111",
      "Request Log — Time, Endpoint, Model, Cost",
    ].join("\n");
    const scrubbed = redactSecrets(dashboard, acct);
    for (const secret of [acct.email, acct.password, "sk-live-aaaabbbbccccdddd1111", "eyJhbGciOiJIUzI1NiJ9"]) {
      expect(scrubbed, `leaked: ${secret}`).not.toContain(secret);
    }
    // and the product knowledge Sage logged in to get is still there
    expect(scrubbed).toContain("Request Log");
    expect(scrubbed).toContain("Endpoint");
  });
});
