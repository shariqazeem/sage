import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { db } from "@/lib/db";
import { inspectionJobs } from "@/lib/db/schema";
import { createInspectionJob, getInspectionJob } from "@/lib/db/inspection";
import { claimHandedOver, handoverClaimCode, handoverCodeValid, HANDOVER_TTL_SEC } from "./handover-claim";

/** A plan made in a walletless chat is claimed on the web only with the code the chat was given, once. */

const OWNER = "clawup:tg-12345";
const WALLET = "0x5555555555555555555555555555555555555555";
const OTHER = "0x6666666666666666666666666666666666666666";
const NOW = 1_795_000_000;
const ENV = { SAGE_SESSION_SECRET: "a-test-secret-of-enough-length" };
let n = 0;

function plan(owner = OWNER) {
  return createInspectionJob({
    founderWallet: owner,
    publicCampaignId: `launch-handover-${++n}`,
    productUrl: `https://acme${n}.example`,
    goal: "",
    targetUsers: "",
    totalBudgetBase: BigInt(20_000_000),
    tokenDecimals: 6,
    planningRequestId: `req-handover-${n}`,
  }).job.id;
}

beforeEach(() => {
  vi.stubEnv("SAGE_SESSION_SECRET", ENV.SAGE_SESSION_SECRET);
  db.delete(inspectionJobs).run();
});
afterEach(() => vi.unstubAllEnvs());

describe("the claim code", () => {
  it("is minted only for a chat-owned plan, and only with a secret", () => {
    expect(handoverClaimCode("insp", OWNER, NOW, ENV)).toMatch(/^\d+\.[0-9a-f]{40}$/);
    expect(handoverClaimCode("insp", WALLET, NOW, ENV)).toBeNull();
    expect(handoverClaimCode("insp", OWNER, NOW, {})).toBeNull();
  });

  it("is valid for that plan and owner until it expires", () => {
    const code = handoverClaimCode("insp", OWNER, NOW, ENV);
    expect(handoverCodeValid("insp", OWNER, code, NOW + 60, ENV)).toBe(true);
    expect(handoverCodeValid("other", OWNER, code, NOW + 60, ENV)).toBe(false);
    expect(handoverCodeValid("insp", "clawup:tg-999", code, NOW + 60, ENV)).toBe(false);
    expect(handoverCodeValid("insp", OWNER, code, NOW + HANDOVER_TTL_SEC + 1, ENV)).toBe(false);
    expect(handoverCodeValid("insp", OWNER, "123.abc", NOW, ENV)).toBe(false);
  });
});

describe("claimHandedOver", () => {
  it("moves the plan from the chat to the signed-in wallet, once", () => {
    const id = plan();
    const code = handoverClaimCode(id, OWNER, NOW);
    expect(claimHandedOver(id, code, WALLET, NOW + 10)).toEqual({ ok: true });
    expect(getInspectionJob(id)?.founderWallet).toBe(WALLET);
    expect(claimHandedOver(id, code, WALLET, NOW + 20)).toEqual({ ok: true }); // same claim again
    expect(claimHandedOver(id, code, OTHER, NOW + 30)).toEqual({ ok: false, reason: "not_handed_over" });
  });

  it("refuses a wrong code and changes nothing", () => {
    const id = plan();
    expect(claimHandedOver(id, "1795000000.0000000000000000000000000000000000000000", WALLET, NOW)).toEqual({ ok: false, reason: "bad_code" });
    expect(getInspectionJob(id)?.founderWallet).toBe(OWNER);
  });

  it("never moves a plan a wallet already owns", () => {
    const id = plan(OTHER);
    const code = handoverClaimCode(id, OWNER, NOW);
    expect(claimHandedOver(id, code, WALLET, NOW)).toEqual({ ok: false, reason: "not_handed_over" });
    expect(getInspectionJob(id)?.founderWallet).toBe(OTHER);
  });
});
