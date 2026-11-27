import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { GIFT_TTL_SEC, giftCode, giftCodeValid } from "./gift-code";

const env = { SAGE_SESSION_SECRET: "a-session-secret-long-enough" };
const NOW = 1_795_000_000;
const OWNER = "0xdf70f6e8e656e5bb714ff0e8ca176d76f26890e3";

describe("gift codes: give a test to its builder, once", () => {
  it("opens the plan it was made for, while the giver still owns it", () => {
    const code = giftCode("job-1", OWNER, NOW, env)!;
    expect(code).toMatch(/^\d{10}\.[0-9a-f]{40}$/);
    expect(giftCodeValid("job-1", OWNER, code, NOW + 60, env)).toBe(true);
    // the owner's spelling does not matter: a checksummed address is the same giver
    expect(giftCodeValid("job-1", "0xDF70f6E8e656E5bb714fF0E8CA176d76F26890e3", code, NOW + 60, env)).toBe(true);
  });

  it("stops working the moment the plan changes hands (single use by construction)", () => {
    const code = giftCode("job-1", OWNER, NOW, env)!;
    expect(giftCodeValid("job-1", "0x1111111111111111111111111111111111111111", code, NOW + 60, env)).toBe(false);
  });

  it("opens no other plan, and nothing after it expires", () => {
    const code = giftCode("job-1", OWNER, NOW, env)!;
    expect(giftCodeValid("job-2", OWNER, code, NOW + 60, env)).toBe(false);
    expect(giftCodeValid("job-1", OWNER, code, NOW + GIFT_TTL_SEC + 1, env)).toBe(false);
  });

  it("refuses a tampered code, a stretched expiry, and anything that is not a code", () => {
    const code = giftCode("job-1", OWNER, NOW, env)!;
    const [expires, sig] = code.split(".");
    expect(giftCodeValid("job-1", OWNER, `${Number(expires) + 86_400}.${sig}`, NOW + 60, env)).toBe(false);
    expect(giftCodeValid("job-1", OWNER, `${expires}.${"0".repeat(40)}`, NOW + 60, env)).toBe(false);
    for (const bad of [undefined, null, 42, "", "nope", `${expires}.${sig}x`]) expect(giftCodeValid("job-1", OWNER, bad, NOW + 60, env)).toBe(false);
  });

  it("never mints or accepts a code without the secret, or for a plan nobody owns", () => {
    expect(giftCode("job-1", OWNER, NOW, {})).toBeNull();
    expect(giftCode("job-1", "anonymous", NOW, env)).toBeNull();
    const code = giftCode("job-1", OWNER, NOW, env)!;
    expect(giftCodeValid("job-1", OWNER, code, NOW + 60, {})).toBe(false);
    expect(giftCodeValid("job-1", "anonymous", code, NOW + 60, env)).toBe(false);
  });

  it("is not a Telegram hand-over code: the same secret signs a different message", () => {
    const expires = NOW + 3600;
    const handover = createHmac("sha256", env.SAGE_SESSION_SECRET).update(`handover|job-1|${OWNER}|${expires}`).digest("hex").slice(0, 40);
    expect(giftCodeValid("job-1", OWNER, `${expires}.${handover}`, NOW, env)).toBe(false);
  });
});
