import { describe, expect, it } from "vitest";

import { toFelt } from "./felt";
import { readMission, readVaultBalance, readVaultState, simulateVaultPayout } from "./vault";

/**
 * CAN THIS RAIL ACTUALLY PAY?
 *
 * Everything else about the Starknet rail is proven by construction: the deploy calls, the plan
 * digests, the budget invariant, the decoders. The one thing none of that establishes is the
 * moment that matters — the operator asking a real, funded vault to release real money — because
 * no Starknet submission has ever reached settlement in production.
 *
 * This runs the REAL payout call against the REAL vault and commits nothing. It proves the four
 * things that have each broken this rail at least once:
 *
 *   · the checked-in ABI still compiles `request_payout` against the deployed class
 *   · the operator key Sage holds is the one the vault accepts (NOT_OPERATOR)
 *   · the mission exists under the felt settlement will look it up by (NO_SUCH_MISSION)
 *   · the vault holds enough to honour it (INSUFFICIENT_BALANCE)
 *
 * Guarded, because it needs the operator key and a live RPC:
 *   STARKNET_DRYRUN=1 npx vitest run payout-dryrun.live
 *
 * VAULT and MISSION default to the live starkscan campaign; override for another.
 */

const LIVE = process.env.STARKNET_DRYRUN === "1";
const VAULT =
  process.env.DRYRUN_VAULT ?? "0x9bd1ea4e66d6b1dd0d92e8e4a4b9ae82df0c260c2a25ce4c0015501d83d3f8";
const MISSION_HASH =
  process.env.DRYRUN_MISSION ?? "0x39c8721bf3388ef78c49a7a69c2eaa0f74e51f6c21cafad763f1734a5c8a347d";
/** A wallet that has never been paid by this vault, so ALREADY_PAID cannot mask the answer. */
const RECIPIENT =
  process.env.DRYRUN_RECIPIENT ?? "0x64b48806902a367c8598f4f95c305e8c1a1acba5f082d294a43793113115691";

describe.skipIf(!LIVE)("a payout against the live vault, simulated", () => {
  it("the vault is readable, active, and funded", async () => {
    const state = await readVaultState(VAULT);
    const balance = await readVaultBalance(VAULT);
    console.log(
      `vault ${VAULT}\n  status=${state.statusLabel} operator=${state.operator}\n` +
        `  ceiling=${state.budgetCeilingBase} spent=${state.totalSpentBase} balance=${balance}`,
    );
    expect(state.statusLabel).toBe("active");
    expect(balance).toBeGreaterThan(BigInt(0));
  }, 120_000);

  it("the mission exists under the felt settlement will look it up by", async () => {
    const felt = toFelt(MISSION_HASH);
    const m = await readMission(VAULT, felt);
    console.log(`  mission ${felt}\n  exists=${m.exists} reward=${m.rewardBase} paid=${m.paidCompletions}/${m.maxCompletions}`);
    // A 256-bit mission id hash does not fit a felt. If the reduction here ever disagrees with the
    // one used at deploy, this reads as NO_SUCH_MISSION at the worst possible moment.
    expect(m.exists).toBe(true);
    expect(m.rewardBase).toBeGreaterThan(BigInt(0));
    expect(m.paidCompletions).toBeLessThan(m.maxCompletions);
  }, 120_000);

  it("WOULD PAY — the operator is accepted and the vault releases the reward", async () => {
    const sim = await simulateVaultPayout({
      vaultAddress: VAULT,
      missionId: toFelt(MISSION_HASH),
      recipient: RECIPIENT,
      // Non-zero on purpose: a zero digest is refused with MISSING_DIGESTS, which would look like
      // a pass of this test's setup and a failure of the rail.
      decisionDigest: "0x1a2b3c",
      intentHash: "0x4d5e6f",
    });
    console.log(`  simulation: wouldPay=${sim.wouldPay} code=${sim.code} — ${sim.reason}${sim.error ? `\n  ${sim.error}` : ""}`);
    expect(sim.reverted, sim.error ?? "").toBe(false);
    expect(sim.code, sim.reason).toBe(0);
    expect(sim.wouldPay).toBe(true);
  }, 180_000);

  it("and refuses a mission it does not have, so the check above is not vacuous", async () => {
    // If the simulation said "would pay" to anything, the test above would prove nothing.
    const sim = await simulateVaultPayout({
      vaultAddress: VAULT,
      missionId: "0xdeadbeefdeadbeef",
      recipient: RECIPIENT,
      decisionDigest: "0x1a2b3c",
      intentHash: "0x4d5e6f",
    });
    console.log(`  control: wouldPay=${sim.wouldPay} code=${sim.code} — ${sim.reason}`);
    expect(sim.wouldPay).toBe(false);
    expect(sim.code).toBe(3); // NO_SUCH_MISSION
  }, 180_000);
});
