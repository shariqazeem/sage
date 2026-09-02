import { describe, expect, it } from "vitest";
import { Account, RpcProvider } from "starknet";
import { starknetAddresses, starknetConfig, starknetVaultClassHash } from "./config";
import { deployVaultCall, predictVaultAddress, saltForJob, vaultConstructorCalldata } from "./vault-calls";

/**
 * WOULD THE PRIVACY CLASS DEPLOY? — simulated on mainnet, committing nothing.
 *
 * The $25 gig will be the first vault ever deployed from the privacy class (declared 2026-09-02),
 * signed by the founder's wallet in their browser. A founder's launch must not be the first test
 * of the constructor + class pair: this simulates the app's OWN deploy call (same calldata builder,
 * same UDC path, same salt scheme) from the operator account and reads the chain's own trace.
 *
 *   STARKNET_DEPLOY_DRYRUN=1 npx vitest run deploy-dryrun.live     (VM: real env, real chain)
 */
const LIVE = process.env.STARKNET_DEPLOY_DRYRUN === "1";

describe.skipIf(!LIVE)("privacy-class vault deploy (live simulation)", () => {
  it("the UDC deploy of the privacy class simulates clean and lands on the predicted address", async () => {
    const cfg = starknetConfig()!;
    const addr = starknetAddresses()!;
    const classHash = starknetVaultClassHash()!;
    expect(BigInt(classHash)).toBe(BigInt("0x6d55773e63601dfbd861c78e03c5ac3085b472d7c067d9c5634da03a00b5aa0"));

    const provider = new RpcProvider({ nodeUrl: cfg.rpcUrl });
    const account = new Account({ provider, address: cfg.accountAddress, signer: cfg.privateKey });
    const constructorCalldata = vaultConstructorCalldata({
      owner: cfg.accountAddress,
      operator: cfg.accountAddress,
      token: addr.token,
      budgetCeilingBase: BigInt(25_000_000),
      dailyCapBase: BigInt(25_000_000),
      campaignIdHash: `0x${"a".repeat(60)}1`,
      missionPlanDigest: `0x${"b".repeat(60)}2`,
    });
    const salt = saltForJob(`deploy-dryrun-${Date.now()}`);
    const predicted = predictVaultAddress({ classHash, deployer: cfg.accountAddress, salt, constructorCalldata });
    const call = deployVaultCall({ classHash, salt, constructorCalldata });
    console.log(`  class ${classHash.slice(0, 12)}… · predicted vault ${predicted.slice(0, 14)}…`);

    let reverted: string | null = null;
    let trace: unknown;
    try {
      const sim = await account.simulateTransaction([{ type: "INVOKE" as const, payload: [call] }]);
      const r = sim as unknown as { simulated_transactions?: { transaction_trace?: unknown }[] } | { transaction_trace?: unknown }[];
      trace = Array.isArray(r) ? r[0]?.transaction_trace : r.simulated_transactions?.[0]?.transaction_trace;
    } catch (e) {
      reverted = e instanceof Error ? e.message : String(e);
    }
    if (reverted) console.log(`  SIMULATION REVERTED:\n${reverted.slice(0, 1200)}`);
    expect(reverted, reverted ?? "").toBeNull();
    const s = JSON.stringify(trace);
    console.log(`  simulated ok · trace ${s.length} chars · reverted=${/is_reverted":true/.test(s)}`);
    expect(/is_reverted":true/.test(s)).toBe(false);
    // the chain's own trace names the deployed address — it must be the one the app predicted
    const norm = (h: string) => BigInt(h).toString(16);
    expect(s.toLowerCase().includes(norm(predicted))).toBe(true);
  }, 180_000);
});
