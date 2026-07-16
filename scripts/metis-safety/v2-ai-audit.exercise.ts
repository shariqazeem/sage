import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { createPublicClient, http, getAddress, parseEventLogs, defineChain, decodeEventLog } from "viem";
import {
  getCampaign,
  getDecisionBySubmission,
  listMissions,
  listSubmissions,
} from "@/lib/db/campaigns";
import { briefFromRow } from "@/lib/deputy/decisions";
import { composeProof, isFoundProof } from "@/lib/deputy/proof";
import { verifyPublicIdentity, missionToIdentity } from "@/lib/campaigns/public-identity";
import { runDeputyOnSubmission } from "@/lib/deputy/pipeline";

/**
 * PROMPT 02E.2 Part C — READ-ONLY audit of the real AI-bound settlement. No mutation,
 * no new transaction. Verifies the on-chain facts, the exactly-once durable/journal/fee
 * records, the recomputed identity + commitment, the canonical proof, and the TRUTHFUL
 * x402 state (a fallback is NEVER reported as paid).
 */

const RPC = "https://sepolia.metisdevops.link";
const CHAIN = defineChain({ id: 59902, name: "Metis Sepolia", nativeCurrency: { name: "tMetis", symbol: "tMETIS", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const pub = createPublicClient({ chain: CHAIN, transport: http(RPC, { timeout: 60000, retryCount: 2 }) });

const TX = "0x912b48cefdddad6c4c25701482ea0f1210051df271d9e349c379f0d0981e4024";
const VAULT = getAddress("0x73Ce425A84B1c2e4F19c7cB9f5d745EE529e4972");
const FACTORY = getAddress("0x2249b773aFEd5594985F7D350581A1b55f279C7f");
const TOKEN = getAddress("0xF176f521290A937d81cc5878dfc19908f4D681A1");
const TESTER = getAddress("0xDF70f6E8e656E5bb714fF0E8CA176d76F26890e3");
const MID = "0x9af3313cb0b13822c9caaab12045888fbf36fcfa80ef85ddb76bb5b3c000c6f3";
const CID = "0x4a5024d5af6dfe32e1ae40fb73978a8e1c793ef157109316ed2db31d868d10e7";
const PLAN = "0x48f6d45295be7b0b4b85ab99846e5dec29408a7c101eeb63865abeef31d803d2";
const INTENT = "0xe1ee09ada0b863e0075cbe3285d9d23ba6fa86d4a1edc848cfa45841c08f8318";
const CAMPAIGN_ID = "sage-metis-v2-ai-proof-1";

const vaultAbi = JSON.parse(fs.readFileSync("contracts/out/CampaignVault.sol/CampaignVault.json", "utf8")).abi;
const facAbi = JSON.parse(fs.readFileSync("contracts/out/CampaignVaultFactory.sol/CampaignVaultFactory.json", "utf8")).abi;

async function dbCount(
  table: "settlementAttempts" | "events" | "fees",
  campaignId: string,
): Promise<Record<string, unknown>[]> {
  const { db } = await import("@/lib/db");
  const s = await import("@/lib/db/schema");
  const { eq } = await import("drizzle-orm");
  if (table === "settlementAttempts")
    return db.select().from(s.settlementAttempts).where(eq(s.settlementAttempts.campaignId, campaignId)).all() as Record<string, unknown>[];
  if (table === "events")
    return db.select().from(s.events).where(eq(s.events.campaignId, campaignId)).all() as Record<string, unknown>[];
  return db.select().from(s.fees).where(eq(s.fees.campaignId, campaignId)).all() as Record<string, unknown>[];
}

describe("02E.2 Part C — read-only audit of the live AI-bound settlement", () => {
  it("on-chain: recipient +100000, spent 100000, remaining 0, mission 1/1, intent consumed, factory recognizes", async () => {
    expect(await pub.getChainId()).toBe(59902);
    const rc = await pub.getTransactionReceipt({ hash: TX as `0x${string}` });
    // ERC-20 Transfer(vault → tester, 100000) proves the recipient balance delta exactly.
    const transfer = rc.logs
      .filter((l) => getAddress(l.address) === TOKEN)
      .map((l) => {
        try {
          return decodeEventLog({ abi: [{ type: "event", name: "Transfer", inputs: [{ indexed: true, name: "from", type: "address" }, { indexed: true, name: "to", type: "address" }, { indexed: false, name: "value", type: "uint256" }] }], data: l.data, topics: l.topics });
        } catch {
          return null;
        }
      })
      .find((e) => e && getAddress((e.args as { to: string }).to) === TESTER);
    expect(transfer).toBeTruthy();
    expect((transfer!.args as { value: bigint }).value).toBe(BigInt(100000)); // recipient delta

    const settled = parseEventLogs({ abi: vaultAbi, logs: rc.logs, eventName: "PayoutSettled" })[0] as unknown as
      | { args: { amount: bigint; recipient: string; missionId: string; intentHash: string } }
      | undefined;
    expect(settled).toBeTruthy();
    expect(settled!.args.amount).toBe(BigInt(100000));
    expect(getAddress(settled!.args.recipient)).toBe(TESTER);
    expect(settled!.args.intentHash.toLowerCase()).toBe(INTENT);

    const stats = (await pub.readContract({ address: VAULT, abi: vaultAbi, functionName: "getSpendStats" })) as [bigint, bigint, bigint];
    expect(stats[0]).toBe(BigInt(100000)); // totalSpent
    expect(stats[1]).toBe(BigInt(0)); // remaining
    expect(await pub.readContract({ address: VAULT, abi: vaultAbi, functionName: "getMissionRemaining", args: [MID] })).toBe(BigInt(0)); // 1/1
    expect(await pub.readContract({ address: VAULT, abi: vaultAbi, functionName: "hasRecipientCompleted", args: [MID, TESTER] })).toBe(true);
    expect(await pub.readContract({ address: VAULT, abi: vaultAbi, functionName: "isIntentUsed", args: [INTENT] })).toBe(true);
    expect(await pub.readContract({ address: FACTORY, abi: facAbi, functionName: "isVault", args: [VAULT] })).toBe(true); // factory provenance
  });

  it("DB: exactly one durable attempt, one settled journal event, one fee — replay adds nothing", async () => {
    const attempts = await dbCount("settlementAttempts", CAMPAIGN_ID);
    expect(attempts).toHaveLength(1);
    expect((attempts[0] as { status: string }).status).toBe("settled");
    expect((attempts[0] as { txHash: string }).txHash.toLowerCase()).toBe(TX);

    const events = (await dbCount("events", CAMPAIGN_ID)) as { kind: string }[];
    expect(events.filter((e) => e.kind === "settled")).toHaveLength(1);
    expect(events.filter((e) => e.kind === "autopay_settled")).toHaveLength(1);
    expect((await dbCount("fees", CAMPAIGN_ID))).toHaveLength(1);

    // REPLAY: re-running the pipeline is a side-effect-free no-op (already paid).
    const sub = listSubmissions(CAMPAIGN_ID)[0];
    const before = (await dbCount("settlementAttempts", CAMPAIGN_ID)).length;
    const r = await runDeputyOnSubmission(sub.id);
    expect(r.action).toBe("skipped");
    expect((await dbCount("settlementAttempts", CAMPAIGN_ID)).length).toBe(before); // no new attempt
    expect((await dbCount("fees", CAMPAIGN_ID))).toHaveLength(1); // no new fee
  });

  it("identity: the public id NOW recomputes to the stored + on-chain campaignIdHash / plan / mission / spec", async () => {
    const campaign = getCampaign(CAMPAIGN_ID)!;
    const missions = listMissions(CAMPAIGN_ID);
    const sub = listSubmissions(CAMPAIGN_ID)[0];
    const identity = verifyPublicIdentity({
      publicCampaignId: campaign.id,
      storedCampaignIdHash: campaign.campaignIdHash,
      storedMissionPlanDigest: campaign.missionPlanDigest,
      missions: missions.map(missionToIdentity),
      submission: { missionIdHash: sub.missionIdHash, missionSpecDigest: sub.missionSpecDigest },
      onchain: { campaignIdHash: CID, missionPlanDigest: PLAN },
    });
    expect(identity.ok).toBe(true); // the exercise defect is now internally consistent
    expect(identity.recomputed.campaignIdHash).toBe(CID);
    expect(identity.recomputed.missionPlanDigest).toBe(PLAN);
  });

  it("proof: committed_settlement, verified, intents + decision digest agree, x402 reported TRUTHFULLY", async () => {
    const proof = await composeProof(TX, 59902);
    expect(isFoundProof(proof)).toBe(true);
    if (!isFoundProof(proof)) return;
    expect(proof.state).toBe("committed_settlement");
    expect(proof.commitment?.matches).toBe(true);
    expect(proof.commitment?.recomputedIntent?.toLowerCase()).toBe(INTENT);
    expect(proof.commitment?.storedIntent?.toLowerCase()).toBe(INTENT);
    expect(proof.commitment?.onchainIntent?.toLowerCase()).toBe(INTENT);
    expect(proof.v2?.integrity.verified).toBe(true);

    // x402 truth: the RAIL-1 payment fell back to a direct fetch — it must NOT read as paid.
    const sub = listSubmissions(CAMPAIGN_ID)[0];
    const brief = briefFromRow(getDecisionBySubmission(sub.id)!);
    console.log("AUDIT_X402", JSON.stringify({ status: brief.x402Status, reason: brief.x402Reason, tx: brief.x402PaymentTx }));
    expect(brief.x402Status).not.toBe("paid");
    expect(brief.x402PaymentTx).toBeNull();
    expect(["live_fallback", "not_required", "not_configured"]).toContain(brief.x402Status);
    console.log("AUDIT_OK", JSON.stringify({ state: proof.state, verified: proof.v2?.integrity.verified, amount: proof.human.amountUsd, recipient: proof.human.recipient }));
  });
});
