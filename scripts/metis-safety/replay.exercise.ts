import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { createPublicClient, http, getAddress } from "viem";
import { getCampaign, getSubmission } from "@/lib/db/campaigns";
import { settleWithRecovery } from "@/lib/campaigns/settle";
import { runDeputyOnSubmission } from "@/lib/deputy/pipeline";

const RPC = "https://sepolia.metisdevops.link";
const VAULT = getAddress("0xa37DE5781c297CbB0F5e10AD89C638517506416d");
const TOKEN = getAddress("0xF176f521290A937d81cc5878dfc19908f4D681A1");
const RECIPIENT = getAddress("0xDF70f6E8e656E5bb714fF0E8CA176d76F26890e3");
const stage4 = JSON.parse(fs.readFileSync("scripts/metis-safety/out/stage4.json", "utf8"));

const CHAIN = {
  id: 59902,
  name: "Metis Sepolia",
  nativeCurrency: { name: "Metis", symbol: "tMETIS", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
} as const;
const pub = createPublicClient({ chain: CHAIN, transport: http(RPC) });
const erc20 = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;
const vaultAbi = JSON.parse(fs.readFileSync("contracts/out/PolicyVault.sol/PolicyVault.json", "utf8")).abi;
const balOf = (a: `0x${string}`) => pub.readContract({ address: TOKEN, abi: erc20, functionName: "balanceOf", args: [a] }) as Promise<bigint>;
const stats = () => pub.readContract({ address: VAULT, abi: vaultAbi, functionName: "getSpendStats" }) as Promise<[bigint, bigint, bigint]>;

describe("METIS SEPOLIA safety exercise — application-level replay (durable resume)", () => {
  it("re-invoking the real settlement path moves ZERO additional funds", async () => {
    expect(await pub.getChainId()).toBe(59902);
    const campaign = getCampaign(stage4.campaignId)!;
    const submission = getSubmission(stage4.submissionId)!;

    const recipBefore = await balOf(RECIPIENT);
    const [spentBefore, , countBefore] = await stats();

    // 1) Direct re-invocation of settleWithRecovery — the durable attempt is
    //    'settled', so planResume returns the RECORDED outcome (no broadcast).
    const outcome = await settleWithRecovery(campaign, submission);
    expect(outcome.settled).toBe(true);
    expect(outcome.txHash?.toLowerCase()).toBe(stage4.settleTx.toLowerCase()); // SAME tx reused

    // 2) Re-running the whole pipeline: the submission is already 'paid', so the
    //    gate short-circuits (no new settle).
    const rerun = await runDeputyOnSubmission(stage4.submissionId);
    expect(rerun.action).not.toBe("settled");

    const recipAfter = await balOf(RECIPIENT);
    const [spentAfter, , countAfter] = await stats();

    expect(recipAfter).toBe(recipBefore); // recipient balance unchanged
    expect(spentAfter).toBe(spentBefore); // vault totalSpent unchanged
    expect(countAfter).toBe(countBefore); // payout count unchanged
    console.log(
      "REPLAY_APP",
      JSON.stringify({
        reusedTx: outcome.txHash,
        rerunAction: rerun.action,
        recipUnchanged: recipAfter === recipBefore,
        spentUnchanged: spentAfter === spentBefore,
        countUnchanged: countAfter === countBefore,
        spentBase: spentAfter.toString(),
        payoutCount: countAfter.toString(),
      }),
    );
  });
});
