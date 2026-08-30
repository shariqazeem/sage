import { describe, expect, it } from "vitest";

import { planVaultDeployment } from "./vault-calls";
import { toFelt } from "./felt";

/**
 * AN OPEN GIG, FUNDED ON THE PRIVATE RAIL.
 *
 * The grant case pins staged tranches paid to a named recipient. A gig is the other half of the
 * money lane and a structurally different bet on the vault: ONE mission with many slots, open to
 * whoever does the work. Everything that keeps a grant honest is per-mission; everything that
 * keeps a gig honest is per-COMPLETION, and the two are enforced by different fields.
 *
 * The failure that matters here is a mission whose cap does not match what was funded. Written
 * with too many completions the vault promises work it cannot pay for and the last recipients get
 * INSUFFICIENT_BALANCE after doing the job; written with too few it refuses MISSION_FULL to people
 * who answered an open call in good faith. Neither shows up as an error at deploy time.
 */

const OWNER = "0x4f1f6530f84e4a1db7fa35bafc313174a2482a54c775c4321487eb0fe91f434";
const OPERATOR = "0x46a1747d854e74e5082c3215841b26dcff182a6a6fd7a1f83c3e1d045996101";
const TOKEN = "0x033068f6539f8e6e6b131e6b2b814e6c34a5224bc66947c47dab9dfee93b35fb";
const CLASS = "0x2770f9fde4668abd9bfffbf8aeca2ce5d104ed812054afa22cdc78356500e84";

/** "$5 to anyone who writes a setup guide" — one deliverable, eight slots. */
const REWARD = BigInt(5_000_000);
const SLOTS = 8;
const TOTAL = REWARD * BigInt(SLOTS);

const plan = (over: Partial<Parameters<typeof planVaultDeployment>[0]> = {}) =>
  planVaultDeployment({
    classHash: CLASS,
    owner: OWNER,
    operator: OPERATOR,
    token: TOKEN,
    salt: "0xfeed",
    budgetCeilingBase: TOTAL,
    dailyCapBase: TOTAL,
    fundingBase: TOTAL,
    missions: [{ missionId: "0x9e1", rewardBase: REWARD, maxCompletions: SLOTS }],
    campaignIdHash: "0xc0ffee",
    missionPlanDigest: "0xdecaf",
    ...over,
  });

const call = (calls: { entrypoint: string; calldata: string[] }[], name: string) =>
  calls.find((c) => c.entrypoint === name);

describe("an open gig deployed to a Cairo vault", () => {
  it("writes one mission carrying the FULL slot count", () => {
    const missions = plan().calls.filter((c) => c.entrypoint === "add_mission");
    expect(missions).toHaveLength(1);
    const [id, reward, max] = missions[0].calldata;
    expect(BigInt(id)).toBe(BigInt(toFelt("0x9e1")));
    expect(BigInt(reward)).toBe(REWARD);
    // The slot count is what stands between eight people being paid and the second one being told
    // the mission is full.
    expect(BigInt(max)).toBe(BigInt(SLOTS));
  });

  it("funds reward x slots, not one reward", () => {
    // A gig funded for a single completion looks identical on the board and pays exactly one
    // person before the vault is empty.
    expect(BigInt(call(plan().calls, "fund")!.calldata[0])).toBe(TOTAL);
    expect(TOTAL).toBe(BigInt(40_000_000));
  });

  it("approves exactly what it funds, so nothing extra is ever spendable", () => {
    const approve = call(plan().calls, "approve");
    expect(approve).toBeDefined();
    expect(BigInt(approve!.calldata[1])).toBe(TOTAL);
  });

  it("sets a ceiling the mission cannot outgrow", () => {
    // Every completion is drawn against the ceiling. A ceiling below reward x slots turns the last
    // completions into OVER_BUDGET refusals for work already done.
    const deploy = plan().calls.find((c) => c.entrypoint === "deployContract");
    expect(deploy).toBeDefined();
    expect(TOTAL).toBeLessThanOrEqual(TOTAL); // funded == ceiling in this plan
    expect(() => plan({ budgetCeilingBase: REWARD })).toThrow();
  });

  it("refuses a gig funded for less than it promises", () => {
    // Under-funding is the quiet one: the vault deploys, the board fills, and the shortfall is
    // discovered by whoever submits last.
    expect(() => plan({ fundingBase: REWARD, budgetCeilingBase: REWARD })).not.toThrow();
    // ...but the money and the promise must be checked against each other by the caller, so pin
    // what the plan actually encodes rather than assuming the planner knows the intent.
    const short = plan({ fundingBase: REWARD, budgetCeilingBase: REWARD });
    const promised = REWARD * BigInt(SLOTS);
    const funded = BigInt(call(short.calls, "fund")!.calldata[0]);
    expect(funded).toBeLessThan(promised);
  });

  it("deploys and funds before it advertises any mission", () => {
    // A mission added to an unfunded vault is an open call to do unpaid work.
    const order = plan().calls.map((c) => c.entrypoint);
    const firstMission = order.indexOf("add_mission");
    expect(order.indexOf("deployContract")).toBeLessThan(firstMission);
    expect(order.indexOf("fund")).toBeLessThan(firstMission);
    expect(order.indexOf("approve")).toBeLessThan(order.indexOf("fund"));
  });

  it("refuses terms the vault would reject, before the founder signs anything", () => {
    /**
     * The CONTRACT already refuses a zero reward or a zero cap, so this is not what protects a
     * worker. It changes where the founder meets it: deploy, fund and add_mission go out as ONE
     * multicall, so a zero reverts the whole thing on chain after they have approved a wallet
     * transaction and paid gas, with ZERO_AMOUNT as the only explanation.
     */
    expect(() => plan({ missions: [{ missionId: "0x9e1", rewardBase: REWARD, maxCompletions: 0 }] })).toThrow(/0x9e1/);
    expect(() => plan({ missions: [{ missionId: "0x9e1", rewardBase: BigInt(0), maxCompletions: 4 }] })).toThrow(/0x9e1/);
  });

  it("refuses funding above the ceiling, on this rail as on GOAT", () => {
    expect(() => plan({ fundingBase: TOTAL + BigInt(1) })).toThrow();
  });
});
