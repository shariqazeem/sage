import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isPublicWork } from "@/lib/campaigns/visibility";
import { bareHexKey } from "@/lib/campaigns/chain-address";
import { linkWallets } from "@/lib/campaigns/wallet-links";
import { recordIdentityProof, walletsForNullifier, nullifierFor } from "@/lib/db/identity";
import { countPaidByWalletsInCampaign, listSlotClaimantWallets, createSubmission } from "@/lib/db/campaigns";
import { seedV2Campaign, payBrief } from "@/lib/campaigns/campaign-v2.fixture";
import { insertDecision } from "@/lib/db/campaigns";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { submissions } from "@/lib/db/schema";
import { personWallets, sameNullifierWallets } from "./person";
import { identityDoorArmed, alreadyClaimedCopy, PERSONHOOD_DOOR_COPY } from "./door";
import { isSanctionedWallet } from "@/lib/deputy/sanctions";

/**
 * ONE PERSON, ONE SLOT — the door and the counts it rests on.
 *
 * "$50 with 50 slots can be farmed" was the founder's objection to a gate keyed on what a mission
 * pays, and it was right: every cheap slot was open to any fresh wallet. These pin the replacement:
 * public work is the only place the door stands, a person is every wallet that is them, and the
 * caps count that person. The route's ORDER is read from its source because nothing else drives it.
 */
const evm = (n: string) => `0x${n.repeat(40).slice(0, 40)}`;

describe("what counts as public work", () => {
  it("listed with no recipient list is public; anything else is not", () => {
    expect(isPublicWork({ visibility: "listed", allowlist: null })).toBe(true);
    expect(isPublicWork({ visibility: "listed", allowlist: [] })).toBe(true);
    expect(isPublicWork({ visibility: "unlisted", allowlist: null })).toBe(false);
    expect(isPublicWork({ visibility: "listed", allowlist: [evm("a")] })).toBe(false);
  });
});

describe("one key per account, whatever the spelling", () => {
  it("collapses case and leading zeros so a felt and its stripped form match", () => {
    expect(bareHexKey("0x04F1f6")).toBe(bareHexKey("0x4f1f6"));
    expect(bareHexKey("0x0000")).toBe("0x0");
  });
});

describe("a person is every wallet that is them", () => {
  it("includes the wallets sharing a personhood nullifier", () => {
    const [a, b] = [evm("1"), evm("2")];
    recordIdentityProof({ wallet: a, provider: "worldid", nullifier: "0xnull-one", level: "device" });
    recordIdentityProof({ wallet: b, provider: "worldid", nullifier: "0xnull-one", level: "device" });
    expect(nullifierFor(a)?.nullifier).toBe("0xnull-one");
    expect(walletsForNullifier("worldid", "0xnull-one").map(bareHexKey).sort()).toEqual([a, b].map(bareHexKey).sort());
    expect(personWallets(a).map(bareHexKey).sort()).toEqual([a, b].map(bareHexKey).sort());
    expect(sameNullifierWallets(a).map(bareHexKey)).toContain(bareHexKey(b));
  });

  it("includes chain-linked and declared wallets, and always itself", () => {
    const [c, d, e] = [evm("3"), evm("4"), evm("5")];
    linkWallets(c, d, 1_800_000_000, "discovered");
    linkWallets(c, e, 1_800_000_001, "declared");
    expect(personWallets(c).map(bareHexKey).sort()).toEqual([c, d, e].map(bareHexKey).sort());
    expect(personWallets(evm("6"))).toEqual([evm("6")]);
    // the nullifier-only subset names nobody here — no proof was recorded for these
    expect(sameNullifierWallets(c)).toEqual([]);
  });
});

describe("the caps count the person", () => {
  it("a second wallet of the same person holds the same slot", () => {
    const f = seedV2Campaign({ wallet: evm("7") });
    const [w1, w2] = [evm("8"), evm("9")];
    const made = createSubmission({ campaignId: f.campaign.id, wallet: w1, note: "I opened the page and read the whole quickstart, carefully, twice.", missionIdHash: f.mission.missionIdHash });
    if (!made.ok) throw new Error(made.error);
    recordIdentityProof({ wallet: w1, provider: "worldid", nullifier: "0xnull-two", level: "device" });
    recordIdentityProof({ wallet: w2, provider: "worldid", nullifier: "0xnull-two", level: "device" });
    const mine = new Set(personWallets(w2).map(bareHexKey));
    const claimants = listSlotClaimantWallets(f.mission.missionIdHash);
    expect(claimants.map((c) => c.wallet)).toContain(w1);
    expect(claimants.some((c) => mine.has(bareHexKey(c.wallet)))).toBe(true);
  });

  it("paid completions are summed across the person's wallets, in any spelling", () => {
    const f = seedV2Campaign({ wallet: evm("b") });
    const paid = f.submission.wallet;
    insertDecision({ submissionId: f.submission.id, campaignId: f.campaign.id, engine: "llm", model: "t", brief: payBrief(), contentSha256: null, evidenceOk: true, latencyMs: null, costUsd: null, x402PaymentTx: null, x402Status: "not_required", x402Reason: null });
    // mark the fixture's submission paid
    db.update(submissions).set({ status: "paid", payoutTx: `0x${"c".repeat(64)}` }).where(eq(submissions.id, f.submission.id)).run();
    expect(countPaidByWalletsInCampaign(f.campaign.id, [paid.toUpperCase()])).toBe(1);
    expect(countPaidByWalletsInCampaign(f.campaign.id, [evm("d")])).toBe(0);
    expect(countPaidByWalletsInCampaign(f.campaign.id, [])).toBe(0);
  });
});

describe("the door itself", () => {
  it("is armed by IDENTITY_DOOR=1 and says why in words a person can act on", () => {
    expect(identityDoorArmed({})).toBe(false);
    expect(identityDoorArmed({ IDENTITY_DOOR: "1" })).toBe(true);
    expect(PERSONHOOD_DOOR_COPY).toMatch(/one person, once/);
    expect(PERSONHOOD_DOOR_COPY).toMatch(/No name, no document/);
    expect(alreadyClaimedCopy("mission")).toMatch(/already claimed/);
    expect(alreadyClaimedCopy("campaign")).toMatch(/per person/);
  });

  it("the web route asks the door BEFORE the slot math, and answers with the widget's key", () => {
    const src = readFileSync(resolve(process.cwd(), "src/app/api/campaigns/[id]/submit/route.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const door = src.indexOf("identityDoorArmed() && publicWork");
    const tier = src.indexOf("identityTiersArmed()");
    const personSlot = src.indexOf("listSlotClaimantWallets(mission.missionIdHash)");
    const slots = src.indexOf("missionSlotStatus(");
    expect(door).toBeGreaterThan(-1);
    expect(door).toBeLessThan(tier);            // the person rule speaks before the money rule
    expect(personSlot).toBeGreaterThan(-1);
    expect(personSlot).toBeLessThan(slots);     // one-per-person before the global count
    expect(src).toMatch(/needsVerification: true/);
    expect(src).toMatch(/countPaidByWalletsInCampaign\(campaign\.id, person\)/);
    // the reward-tier rule can never speak while the door is armed
    expect(src).toMatch(/!identityDoorArmed\(\) && identityTiersArmed\(\)/);
  });

  it("the Telegram door screens sanctions and counts the person — it had neither", () => {
    const src = readFileSync(resolve(process.cwd(), "src/lib/campaigns/recipient-submit.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(src).toMatch(/isSanctionedWallet\(wallet\)/);
    expect(src).toMatch(/listSlotClaimantWallets\(mission\.missionIdHash\)/);
    // and no personhood proof is demanded there: an invited recipient is members-only work
    expect(src).not.toMatch(/identityFor\(/);
    // the durable anchor on the vendored list (Ronin bridge / Lazarus)
    expect(isSanctionedWallet("0x098B716B8Aaf21512996dC57EB0615e2383E2f96")).toBe(true);
  });

  it("the payout pipeline counts the person, not the string", () => {
    const src = readFileSync(resolve(process.cwd(), "src/lib/deputy/pipeline.ts"), "utf8");
    expect(src).toMatch(/countPaidByWalletsInCampaign\(campaign\.id, personWallets\(submission\.wallet\)\)/);
  });
});
