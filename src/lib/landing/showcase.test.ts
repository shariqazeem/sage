import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { db } from "@/lib/db";
import { campaigns, decisions, missions, submissions } from "@/lib/db/schema";
import { createCampaign, createMission, createSubmission } from "@/lib/db/campaigns";
import { eq } from "drizzle-orm";
import { loadShowcase } from "./showcase";

const seedCampaign = (chainId: number, sandbox = false) =>
  createCampaign({
    title: "Testing campaign · example.com",
    rewardAmount: 500_000,
    vaultAddress: "0x0000000000000000000000000000000000000001",
    posterWallet: "0x00000000000000000000000000000000000000f1",
    autonomy: "autopilot",
    sandbox,
    chainId,
  } as never);

let mseq = 0;
function seedRun(chainId: number, opts: { quote?: string | null; sandbox?: boolean } = {}) {
  const c = seedCampaign(chainId, opts.sandbox ?? false);
  const hash = `0x${(++mseq).toString(16).padStart(64, "0")}`;
  createMission({
    campaignId: c.id,
    missionKey: `m${mseq}`,
    missionIdHash: hash,
    title: "Search by contract address lands on a populated contract page",
    descriptionMd: "",
    objective: "reach a populated contract page",
    instructions: "",
    targetSurface: "https://example.com/contract",
    criteria: ["The reached page quotes the contract name", "The tab strip is visible"],
    evidenceList: ["paste the url"],
    rewardAmount: 500_000,
    maxCompletions: 2,
  } as never);
  const r = createSubmission({ campaignId: c.id, wallet: "0x00000000000000000000000000000000000000a1", evidenceUrl: "https://a.example/x", missionIdHash: hash });
  if (!r.ok) throw new Error(r.error);
  db.update(submissions).set({ status: "paid", payoutTx: `0xtx-${c.id}`, decidedAt: 1_788_000_000 }).where(eq(submissions.id, r.submission.id)).run();
  db.insert(decisions).values({
    id: `d-${c.id}`,
    submissionId: r.submission.id,
    campaignId: c.id,
    engine: "llm",
    brief: {
      recommendation: "pay",
      reasonCode: "verified",
      confidence: 0.93,
      summary: "met",
      criteria: [{ criterion: "The reached page quotes the contract name", met: true, confidence: 0.95, ...(opts.quote === null ? {} : { quote: opts.quote ?? "Starknet: Attestation" }) }],
    } as never,
    createdAt: 1_788_000_000,
  } as never).run();
  return c;
}

beforeEach(() => {
  db.delete(decisions).run();
  db.delete(submissions).run();
  db.delete(missions).run();
  db.delete(campaigns).run();
});

describe("the landing's fourth chapter shows a move, never chapter three again", () => {
  it("a recorded move is shown as real, with its reason and price", async () => {
    const { recordIntent } = await import("@/lib/db/operator");
    const { loadShowcaseMove } = await import("./showcase");
    recordIntent({ founderAddress: `0x${"a".repeat(40)}`, surface: "acme.io", kind: "testing", goal: "find where checkout breaks", decidedBy: "llm", budgetBase: 5_000_000, reason: "the last run filled", commitAt: 1_800_000_000 });
    const m = await loadShowcaseMove();
    expect(m?.source).toBe("real");
    expect(m?.surface).toBe("acme.io");
    expect(m?.budgetUsd).toBe(5);
    expect(m?.reason).toBe("the last run filled");
    expect(JSON.stringify(m)).not.toMatch(/0xaaaa/);
  });
});

describe("the landing's showcase is a real run or nothing", () => {
  it("returns the latest paid mainnet run with a quoted verdict — public material only", () => {
    seedRun(2345);
    const sc = loadShowcase();
    expect(sc).not.toBeNull();
    expect(sc!.targetHost).toBe("example.com");
    expect(sc!.mission.title).toContain("Search by contract address");
    expect(sc!.decision.criteria[0].quote).toBe("Starknet: Attestation");
    expect(sc!.decision.recommendation).toBe("pay");
    expect(JSON.stringify(sc)).not.toContain("0x00000000000000000000000000000000000000a1"); // never the wallet
  });

  it("a verdict with no verbatim quote is not legible enough to showcase", () => {
    seedRun(2345, { quote: null });
    expect(loadShowcase()).toBeNull();
  });

  it("testnet and sandbox runs never reach the front door", () => {
    seedRun(59902);
    seedRun(2345, { sandbox: true });
    expect(loadShowcase()).toBeNull();
  });
});
