import { describe, expect, it } from "vitest";
import { CallData } from "starknet";

import { planVaultDeployment } from "./vault-calls";
import { toFelt } from "./felt";

/**
 * A MILESTONE GRANT, FUNDED ON THE PRIVATE RAIL.
 *
 * Gigs and grants were only ever exercised on GOAT. They reach the same launch page and the same
 * rail choice as a testing campaign, so nothing STOPS a founder choosing Starknet for a three-
 * tranche grant — and until now nothing had checked what that produces either. The failure mode
 * that matters is not a crash: it is a vault that deploys happily while holding the wrong terms,
 * because then the money is committed before anyone notices.
 *
 * Grants are also the Future Caribbean shape — a named recipient, staged tranches, real money —
 * so this is the combination that has to be right before anything is built on top of it.
 */

const OWNER = "0x4f1f6530f84e4a1db7fa35bafc313174a2482a54c775c4321487eb0fe91f434";
const OPERATOR = "0x46a1747d854e74e5082c3215841b26dcff182a6a6fd7a1f83c3e1d045996101";
const TOKEN = "0x033068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb";
const CLASS = "0x2770f9fde4668abd9bfffbf8aeca2ce5d104ed812054afa22cdc78356500e84";

/** Three tranches of $20 — the fixture the money battery uses, on the private rail. */
const TRANCHES = [
  { missionId: "0xaa1", rewardBase: BigInt(20_000_000), maxCompletions: 1 },
  { missionId: "0xbb2", rewardBase: BigInt(20_000_000), maxCompletions: 1 },
  { missionId: "0xcc3", rewardBase: BigInt(20_000_000), maxCompletions: 1 },
];
const TOTAL = BigInt(60_000_000);

const plan = (over: Partial<Parameters<typeof planVaultDeployment>[0]> = {}) =>
  planVaultDeployment({
    classHash: CLASS,
    owner: OWNER,
    operator: OPERATOR,
    token: TOKEN,
    salt: "0xabc",
    budgetCeilingBase: TOTAL,
    dailyCapBase: TOTAL,
    fundingBase: TOTAL,
    missions: TRANCHES,
    campaignIdHash: "0xdeadbeef",
    missionPlanDigest: "0xfeedface",
    ...over,
  });

const missionCalls = (calls: { entrypoint: string; calldata: string[] }[]) =>
  calls.filter((c) => c.entrypoint === "add_mission");

describe("a three-tranche grant deployed to a Cairo vault", () => {
  it("writes EVERY tranche into the vault, not just the first", () => {
    // A vault holding one of three milestones pays the first recipient and refuses the rest with
    // NO_SUCH_MISSION — after they have done the work.
    expect(missionCalls(plan().calls)).toHaveLength(3);
  });

  it("carries each tranche's own reward and cap", () => {
    for (const call of missionCalls(plan().calls)) {
      const [, reward, max] = call.calldata;
      expect(BigInt(reward)).toBe(BigInt(20_000_000));
      expect(BigInt(max)).toBe(BigInt(1));
    }
  });

  it("keys each tranche by the felt settlement will look it up under", () => {
    // The browser writes the id; settlement derives it again months later. A drift here answers
    // NO_SUCH_MISSION at the worst possible moment.
    const ids = missionCalls(plan().calls).map((c) => BigInt(c.calldata[0]));
    for (const t of TRANCHES) expect(ids).toContain(BigInt(toFelt(t.missionId)));
  });

  it("funds exactly the sum of the tranches — the budget invariant, on this rail too", () => {
    const sum = TRANCHES.reduce((s, m) => s + m.rewardBase * BigInt(m.maxCompletions), BigInt(0));
    expect(sum).toBe(TOTAL);
    const fund = plan().calls.find((c) => c.entrypoint === "fund");
    expect(BigInt(fund!.calldata[0])).toBe(TOTAL);
  });

  it("approves the token for exactly what it funds, never more", () => {
    // An approval above the funded amount leaves the vault able to pull more later.
    const approve = plan().calls.find((c) => c.entrypoint === "approve");
    const decoded = CallData.toCalldata(approve!.calldata);
    // uint256 low/high follow the spender.
    expect(BigInt(decoded[1])).toBe(TOTAL);
  });

  it("deploys, approves and funds BEFORE any mission is written", () => {
    // add_mission on a contract that does not exist yet reverts the whole batch — which is safe,
    // but it would make a correct plan look like a broken product.
    const order = plan().calls.map((c) => c.entrypoint);
    expect(order[0]).toBe("deployContract");
    expect(order.indexOf("fund")).toBeLessThan(order.indexOf("add_mission"));
  });

  it("refuses to fund more than the ceiling can ever release", () => {
    expect(() => plan({ fundingBase: TOTAL + BigInt(1) })).toThrow(/strand/i);
  });

  it("refuses a grant with no tranches at all", () => {
    expect(() => plan({ missions: [] })).toThrow(/never pay anyone/i);
  });
});
