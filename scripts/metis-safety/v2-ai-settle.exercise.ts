import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { createPublicClient, http, getAddress, parseEventLogs, defineChain } from "viem";
import {
  createCampaign,
  createMission,
  createSubmission,
  getCampaign,
  getDecisionBySubmission,
  getMissionByHash,
  getSubmission,
  lockMissionPlan,
  recomputeMissionSpecDigest,
} from "@/lib/db/campaigns";
import { runDeputyOnSubmission } from "@/lib/deputy/pipeline";
import { operatorAddress } from "@/lib/deputy/signer";
import { briefFromRow } from "@/lib/deputy/decisions";
import { computeDecisionCommitmentV2 } from "@/lib/deputy/campaign-commitment";
import { composeProof, isFoundProof } from "@/lib/deputy/proof";

/**
 * TX6 (+ application replay recovery + verified V2 proof): drive the REAL Sage
 * pipeline for a mission-bound payout to a previously-unknown tester. Evidence →
 * real LLM decision → DecisionCommitmentV2 → PayoutIntentV2 → durable attempt →
 * operator requestPayout on the deployed CampaignVaultV2 → on-chain 0.1 mUSDC.
 * Then re-run the pipeline (idempotent — no double-pay) and verify the canonical
 * V2 proof is AI-bound. NB: seeds are frozen; the DB row id is a nanoid but the
 * on-chain identity is carried by the stored hash columns.
 */

const RPC = "https://sepolia.metisdevops.link";
const CHAIN = defineChain({ id: 59902, name: "Metis Sepolia", nativeCurrency: { name: "Metis", symbol: "tMETIS", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const pub = createPublicClient({ chain: CHAIN, transport: http(RPC, { timeout: 60000, retryCount: 2 }) });

const VAULT = getAddress("0x73Ce425A84B1c2e4F19c7cB9f5d745EE529e4972");
const TOKEN = getAddress("0xF176f521290A937d81cc5878dfc19908f4D681A1");
const OWNER = getAddress("0xb77e6f5466cf52524e8465859277f192Be0bCfe4");
const OPERATOR = getAddress("0x7704E5BEe00Ef085dde85EEB0c49ae12d9F9BC35");
const TESTER = getAddress("0xDF70f6E8e656E5bb714fF0E8CA176d76F26890e3");
const CID = "0x4a5024d5af6dfe32e1ae40fb73978a8e1c793ef157109316ed2db31d868d10e7";
const MID = "0x9af3313cb0b13822c9caaab12045888fbf36fcfa80ef85ddb76bb5b3c000c6f3";
const PLAN = "0x48f6d45295be7b0b4b85ab99846e5dec29408a7c101eeb63865abeef31d803d2";
const SPEC = "0x20cc206239baf11097d21683a2602d1ba56e4dc9ca36356e05f32d0cbf20e8ad";
const URL = "https://sage.80.225.209.190.sslip.io/ai-proof-fixture.txt";
const NOTE =
  'I opened the target URL over HTTPS. The page contains the verification phrase "SAGE_V2_AI_PIPELINE_OK" on its third line (the line reading "Verification phrase: SAGE_V2_AI_PIPELINE_OK"). Source: https://sage.80.225.209.190.sslip.io/ai-proof-fixture.txt';
const OUT = "scripts/metis-safety/out/v2-ai-proof.json";

const usdcAbi = JSON.parse(fs.readFileSync("contracts/out/MockUSDC.sol/MockUSDC.json", "utf8")).abi;
const vaultAbi = JSON.parse(fs.readFileSync("contracts/out/CampaignVault.sol/CampaignVault.json", "utf8")).abi;
const balOf = (a: `0x${string}`) => pub.readContract({ address: TOKEN, abi: usdcAbi, functionName: "balanceOf", args: [a] }) as Promise<bigint>;
const vaultSpent = async () => ((await pub.readContract({ address: VAULT, abi: vaultAbi, functionName: "getSpendStats" })) as [bigint, bigint, bigint])[0];

describe("METIS SEPOLIA V2 AI-proof — real pipeline mission payout", () => {
  it("evidence → LLM → DecisionCommitmentV2 → durable attempt → real 0.1 mUSDC payout → verified V2 proof", async () => {
    expect(await pub.getChainId()).toBe(59902); // HARD chain guard
    expect(operatorAddress(59902).toLowerCase()).toBe(OPERATOR.toLowerCase());

    // ---- seed the frozen campaign_v2 + locked mission (stored hash columns carry identity) ----
    const campaign = createCampaign({
      title: "Metis Sepolia V2 AI-proof — public HTTPS evidence",
      descriptionMd: "Controlled testnet AI-bound payout exercise.",
      criteria: [],
      conditionType: "approval",
      rewardAmount: 100000,
      maxRecipients: 1,
      vaultAddress: VAULT,
      chainId: 59902,
      posterWallet: OWNER,
      ownerIsSage: false,
      status: "active",
      autonomy: "autopilot",
      autopilotThreshold: 0.85,
      vaultKind: "campaign_v2",
      settlementToken: TOKEN,
      campaignIdHash: CID,
      missionPlanDigest: PLAN,
      commitmentVersion: 2,
    });

    createMission({
      campaignId: campaign.id,
      missionKey: "public-https-evidence-verification",
      missionIdHash: MID,
      title: "Verify Sage's public AI proof fixture",
      objective: "Confirm that the supplied public HTTPS evidence page contains the exact CampaignVaultV2 verification phrase.",
      instructions: "Open the supplied HTTPS URL. Locate the verification phrase. Submit the source URL, the exact quoted phrase, and one concise sentence describing where it appears.",
      targetSurface: URL,
      criteria: [
        "The evidence URL is publicly reachable over HTTPS.",
        "The fetched evidence contains the exact phrase SAGE_V2_AI_PIPELINE_OK.",
        "The submitted quote exactly matches the phrase in the fetched evidence.",
      ],
      evidenceList: [
        "The public HTTPS source URL.",
        "The exact verification phrase quoted from the fetched evidence.",
        "A concise observation describing where the phrase appears.",
      ],
      rewardAmount: 100000,
      maxCompletions: 1,
      status: "draft",
      displayOrder: 0,
    });

    // lock → freeze the MissionSpecV1 digest; it MUST equal the frozen 0x20cc2062…
    expect(lockMissionPlan(campaign.id, CID)).toBe(1);
    const mission = getMissionByHash(campaign.id, MID)!;
    expect(mission.status).toBe("active");
    expect(recomputeMissionSpecDigest(mission, CID)).toBe(SPEC);
    expect(mission.specDigest).toBe(SPEC);

    const sub = createSubmission({
      campaignId: campaign.id,
      wallet: TESTER,
      evidenceUrl: URL,
      note: NOTE,
      missionIdHash: MID,
      missionSpecDigest: mission.specDigest, // captured = the locked digest
    });
    expect(sub.ok).toBe(true);
    const submissionId = sub.ok ? sub.submission.id : "";
    expect(getSubmission(submissionId)?.status).toBe("pending");

    const testerBefore = await balOf(TESTER);
    const spentBefore = await vaultSpent();

    // ---- THE REAL PIPELINE: real evidence fetch + real LLM + real operator signer + chain ----
    const result = await runDeputyOnSubmission(submissionId);
    console.log("PIPELINE_RESULT", JSON.stringify(result));

    const decRow = getDecisionBySubmission(submissionId)!;
    const brief = briefFromRow(decRow);
    expect(brief.engine).toBe("llm");
    expect(brief.recommendation).toBe("pay");
    expect(brief.confidence).toBeGreaterThanOrEqual(0.85);
    expect(brief.fraudSignals.some((f) => f.severity === "high")).toBe(false);
    expect(brief.contentSha256).toBe("35d2b4c27dafedc6f8fd7932de6ab3cc010a8d2d4bbde15fee01fdce5a516ab6");
    expect(decRow.commitmentVersion).toBe(2);
    expect(decRow.missionIdHash).toBe(MID);
    expect(decRow.missionSpecDigest).toBe(SPEC);

    expect(result.action).toBe("settled");
    const settleTx = result.txHash!;
    expect(settleTx).toBeTruthy();

    // ---- independently recompute the AI-binding commitment (must match the on-chain event) ----
    const camp = getCampaign(campaign.id)!;
    const { decisionDigest, payoutIntentHash } = computeDecisionCommitmentV2({
      chainId: 59902,
      vault: VAULT,
      campaignIdHash: camp.campaignIdHash as `0x${string}`,
      missionPlanDigest: camp.missionPlanDigest as `0x${string}`,
      missionIdHash: MID as `0x${string}`,
      submissionId,
      decisionId: decRow.id,
      recipient: TESTER,
      rewardBase: BigInt(mission.rewardAmount),
      evidenceSha256: decRow.contentSha256,
      criteria: brief.criteria,
      fraudSignals: brief.fraudSignals,
      recommendation: brief.recommendation,
      reasonCode: brief.reasonCode,
      confidence: brief.confidence,
      model: decRow.model,
      provider: brief.provider,
    });

    // ---- verify the on-chain PayoutSettled event ----
    const rc = await pub.getTransactionReceipt({ hash: settleTx as `0x${string}` });
    const ev = parseEventLogs({ abi: vaultAbi, logs: rc.logs, eventName: "PayoutSettled" })[0] as
      | unknown as
      | { args: { recipient: string; amount: bigint; missionId: string; intentHash: string; decisionDigest?: string } }
      | undefined;
    console.log("PAYOUT_SETTLED_EVENT", JSON.stringify(ev?.args, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
    expect(ev).toBeTruthy();
    expect(getAddress(ev!.args.recipient)).toBe(TESTER);
    expect(ev!.args.amount).toBe(BigInt(100000));
    expect(ev!.args.missionId.toLowerCase()).toBe(MID.toLowerCase());
    expect(ev!.args.intentHash.toLowerCase()).toBe(payoutIntentHash.toLowerCase()); // AI-bound intent
    if (ev!.args.decisionDigest) {
      expect(ev!.args.decisionDigest.toLowerCase()).toBe(decisionDigest.toLowerCase());
    }

    // ---- on-chain balances + vault state ----
    const testerAfter = await balOf(TESTER);
    const spentAfter = await vaultSpent();
    expect(testerAfter - testerBefore).toBe(BigInt(100000));
    expect(spentAfter - spentBefore).toBe(BigInt(100000));
    expect(getSubmission(submissionId)?.status).toBe("paid");
    expect(await pub.readContract({ address: VAULT, abi: vaultAbi, functionName: "isIntentUsed", args: [payoutIntentHash] })).toBe(true);
    expect(await pub.readContract({ address: VAULT, abi: vaultAbi, functionName: "hasRecipientCompleted", args: [MID, TESTER] })).toBe(true);
    expect(await pub.readContract({ address: VAULT, abi: vaultAbi, functionName: "getMissionRemaining", args: [MID] })).toBe(BigInt(0));

    // ---- APPLICATION REPLAY RECOVERY: re-run the pipeline — must NOT double-pay ----
    const replay = await runDeputyOnSubmission(submissionId);
    console.log("REPLAY_RESULT", JSON.stringify(replay));
    expect(["skipped", "settled"]).toContain(replay.action); // idempotent; never a second on-chain payout
    const testerAfterReplay = await balOf(TESTER);
    expect(testerAfterReplay).toBe(testerAfter); // no additional payout

    // ---- verified canonical V2 proof (AI-bound) ----
    const proof = await composeProof(settleTx, 59902);
    expect(isFoundProof(proof)).toBe(true);
    if (isFoundProof(proof)) {
      console.log("PROOF_V2", JSON.stringify({
        state: proof.state,
        commitmentVersion: proof.commitmentVersion,
        vaultKind: proof.vaultKind,
        v2Verified: proof.v2?.integrity?.verified ?? null,
        commitmentMatches: proof.commitment?.matches ?? null,
        v2MissionSpecDigest: proof.v2?.missionSpecDigest ?? null,
      }));
      expect(proof.state).toBe("committed_settlement");
      expect(proof.commitmentVersion).toBe(2);
    }

    fs.mkdirSync("scripts/metis-safety/out", { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify({
      campaignDbId: campaign.id,
      submissionId,
      decisionId: decRow.id,
      engine: brief.engine, model: brief.model, provider: brief.provider,
      recommendation: brief.recommendation, confidence: brief.confidence, reasonCode: brief.reasonCode,
      evidenceSha256: brief.contentSha256,
      x402Status: decRow.x402Status, x402PaymentTx: decRow.x402PaymentTx,
      campaignIdHash: CID, missionIdHash: MID, missionPlanDigest: PLAN, missionSpecDigest: SPEC,
      decisionDigest, payoutIntentHash,
      onchainIntentHash: ev!.args.intentHash,
      settleTx,
      testerBefore: testerBefore.toString(), testerAfter: testerAfter.toString(),
      vaultSpentBefore: spentBefore.toString(), vaultSpentAfter: spentAfter.toString(),
      replayAction: replay.action,
      proofState: isFoundProof(proof) ? proof.state : "not_found",
      proofCommitmentVersion: isFoundProof(proof) ? proof.commitmentVersion : null,
    }, null, 2));
    console.log("V2_AI_PROOF_OUT", fs.readFileSync(OUT, "utf8"));
  });
});
