import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { createPublicClient, http, getAddress } from "viem";
import {
  createCampaign,
  createSubmission,
  getCampaign,
  getDecisionBySubmission,
  getSubmission,
} from "@/lib/db/campaigns";
import { getAttempt } from "@/lib/db/settlement-attempts";
import { runDeputyOnSubmission } from "@/lib/deputy/pipeline";
import { derivePayoutIntent } from "@/lib/campaigns/settle";
import { operatorAddress } from "@/lib/deputy/signer";
import { getPayoutProof, isIntentUsed } from "@/lib/deputy/chain";
import { briefFromRow } from "@/lib/deputy/decisions";

const RPC = "https://sepolia.metisdevops.link";
const VAULT = getAddress("0xa37DE5781c297CbB0F5e10AD89C638517506416d");
const TOKEN = getAddress("0xF176f521290A937d81cc5878dfc19908f4D681A1");
const OWNER = getAddress("0xb77e6f5466cf52524e8465859277f192Be0bCfe4");
const RECIPIENT = getAddress("0xDF70f6E8e656E5bb714fF0E8CA176d76F26890e3");
const OPERATOR = getAddress("0x7704E5BEe00Ef085dde85EEB0c49ae12d9F9BC35");
const OUT = "scripts/metis-safety/out/stage4.json";

const CHAIN = {
  id: 59902,
  name: "Metis Sepolia",
  nativeCurrency: { name: "Metis", symbol: "tMETIS", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
} as const;
const pub = createPublicClient({ chain: CHAIN, transport: http(RPC) });
const erc20 = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "a", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;
const vaultAbi = JSON.parse(
  fs.readFileSync("contracts/out/PolicyVault.sol/PolicyVault.json", "utf8"),
).abi;
const balOf = (a: `0x${string}`) =>
  pub.readContract({ address: TOKEN, abi: erc20, functionName: "balanceOf", args: [a] }) as Promise<bigint>;
const vaultSpent = async () =>
  (
    (await pub.readContract({
      address: VAULT,
      abi: vaultAbi,
      functionName: "getSpendStats",
    })) as [bigint, bigint, bigint]
  )[0];

describe("METIS SEPOLIA safety exercise — real pipeline settle", () => {
  it("evidence → LLM → commitment → durable attempt → real 0.5 tUSDC settle → consumed intent", async () => {
    expect(await pub.getChainId()).toBe(59902); // HARD chain guard
    // the app's operator MUST be the fresh disposable operator (env override took)
    expect(operatorAddress(59902).toLowerCase()).toBe(OPERATOR.toLowerCase());

    const campaign = createCampaign({
      title: "Metis Sepolia safety exercise — verify example.com",
      descriptionMd: "Controlled testnet verification.",
      criteria: [
        'The evidence page at https://example.com contains the exact phrase "Example Domain".',
      ],
      rewardAmount: 500_000, // 0.5 tUSDC
      maxRecipients: 4,
      vaultAddress: VAULT,
      chainId: 59902,
      posterWallet: OWNER,
      ownerIsSage: false,
      autonomy: "autopilot",
      autopilotThreshold: 0.85,
      status: "active",
    });
    const sub = createSubmission({
      campaignId: campaign.id,
      wallet: RECIPIENT,
      evidenceUrl: "https://example.com",
      note: 'Submitting example.com as the required evidence; it displays the "Example Domain" heading.',
    });
    expect(sub.ok).toBe(true);
    const submissionId = sub.ok ? sub.submission.id : "";
    expect(getSubmission(submissionId)?.status).toBe("pending");

    const recipBefore = await balOf(RECIPIENT);
    const spentBefore = await vaultSpent();

    // ---- THE REAL PIPELINE: real evidence fetch + real LLM + real signer + chain ----
    const result = await runDeputyOnSubmission(submissionId);

    const decRow = getDecisionBySubmission(submissionId);
    expect(decRow).not.toBeNull();
    const brief = briefFromRow(decRow!);
    expect(brief.engine).toBe("llm");
    expect(brief.recommendation).toBe("pay");
    expect(brief.confidence).toBeGreaterThanOrEqual(0.85);
    expect(brief.fraudSignals.some((f) => f.severity === "high")).toBe(false);
    expect(brief.contentSha256).toBeTruthy();

    const camp = getCampaign(campaign.id)!;
    const submission = getSubmission(submissionId)!;
    const { payoutIntentHash, decisionDigest } = derivePayoutIntent(camp, submission, decRow!);
    expect(decisionDigest).toBeTruthy();
    expect(payoutIntentHash).toBeTruthy();

    expect(result.action).toBe("settled");
    const settleTx = result.txHash!;
    expect(settleTx).toBeTruthy();

    const attempt = getAttempt(payoutIntentHash);
    expect(attempt?.status).toBe("settled");
    expect(attempt?.txHash?.toLowerCase()).toBe(settleTx.toLowerCase());
    expect(attempt?.decisionDigest?.toLowerCase()).toBe(decisionDigest!.toLowerCase());

    const proof = await getPayoutProof(settleTx, 59902);
    expect(proof?.settled).toBe(true);
    expect(proof?.intentHash.toLowerCase()).toBe(payoutIntentHash.toLowerCase());
    expect(await isIntentUsed(VAULT, payoutIntentHash, 59902)).toBe(true);

    const recipAfter = await balOf(RECIPIENT);
    const spentAfter = await vaultSpent();
    expect(recipAfter - recipBefore).toBe(BigInt(500_000)); // exact base units
    expect(spentAfter - spentBefore).toBe(BigInt(500_000));
    expect(getSubmission(submissionId)?.status).toBe("paid");

    fs.mkdirSync("scripts/metis-safety/out", { recursive: true });
    fs.writeFileSync(
      OUT,
      JSON.stringify(
        {
          campaignId: campaign.id,
          submissionId,
          decisionId: decRow!.id,
          engine: brief.engine,
          model: brief.model,
          provider: brief.provider,
          recommendation: brief.recommendation,
          confidence: brief.confidence,
          reasonCode: brief.reasonCode,
          summary: brief.summary,
          evidenceSha256: brief.contentSha256,
          decisionDigest,
          payoutIntentHash,
          onchainIntentHash: proof?.intentHash,
          settleTx,
          recipientBefore: recipBefore.toString(),
          recipientAfter: recipAfter.toString(),
          vaultSpentBefore: spentBefore.toString(),
          vaultSpentAfter: spentAfter.toString(),
          attemptStatus: attempt?.status,
        },
        null,
        2,
      ),
    );
    console.log("STAGE4_OUT", fs.readFileSync(OUT, "utf8"));
  });
});
