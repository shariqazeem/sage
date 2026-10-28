import { describe, expect, it } from "vitest";
import { launchReadiness, nativeAmount } from "./launch-readiness";

/** One answer for every door that launches from the account, so the composer and the plan page agree. */
describe("can this account launch this job", () => {
  it("is ready when the money, the per-job limit and the fee are all there", () => {
    expect(launchReadiness({ balanceUsd: 10, perCampaignCapUsd: 50, enoughGas: true }, 6)).toMatchObject({ ready: true, short: false, overCap: false, needsFee: false, addUsd: 0 });
  });

  it("names what to add, rounded up to the cent so adding it is enough", () => {
    expect(launchReadiness({ balanceUsd: 3.39, perCampaignCapUsd: 50, enoughGas: true }, 6)).toMatchObject({ ready: false, short: true, addUsd: 2.61 });
    expect(launchReadiness({ balanceUsd: 0.089, perCampaignCapUsd: 50, enoughGas: true }, 1.01).addUsd).toBe(0.93);
    expect(launchReadiness({ balanceUsd: 0.09, perCampaignCapUsd: 50, enoughGas: true }, 1.01).addUsd).toBe(0.92);
  });

  it("holds a job above the account's per-job limit, and one without the network fee", () => {
    expect(launchReadiness({ balanceUsd: 100, perCampaignCapUsd: 50, enoughGas: true }, 60)).toMatchObject({ ready: false, overCap: true });
    expect(launchReadiness({ balanceUsd: 100, perCampaignCapUsd: 50, enoughGas: false }, 6)).toMatchObject({ ready: false, needsFee: true });
  });

  it("does not refuse on a fee it could not read", () => {
    expect(launchReadiness({ balanceUsd: 100, perCampaignCapUsd: 50, enoughGas: null }, 6).ready).toBe(true);
  });

  it("writes a fee in plain digits", () => {
    expect(nativeAmount("50000000000000000")).toBe("0.05");
    expect(nativeAmount(null)).toBe("a little");
  });
});
