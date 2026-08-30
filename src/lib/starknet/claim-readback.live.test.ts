import { describe, expect, it } from "vitest";
import { readClaim } from "./claims";

/** Read one claim by commitment. CLAIM_COMMITMENT=<decimal> npx vitest run claim-readback.live */
const C = process.env.CLAIM_COMMITMENT;
describe.skipIf(!C)("reading a claim back", () => {
  it("reports what the chain holds for this commitment", async () => {
    const c = await readClaim(C!);
    console.log(`  exists=${c.exists} claimed=${c.claimed} amount=${c.amountBase} expiry=${c.expiry}`);
    expect(typeof c.exists).toBe("boolean");
  }, 120_000);
});
