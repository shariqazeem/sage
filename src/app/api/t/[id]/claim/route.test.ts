import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Claiming a test at the money moment: nobody's plan goes to whoever signs in first, a Telegram plan only
 * with its code, and a plan another wallet (or an X account) owns never moves through this door.
 */

const h = vi.hoisted(() => ({ me: null as string | null }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/founder", async (orig) => ({ ...(await orig<typeof import("@/lib/auth/founder")>()), getFounderAddress: async () => h.me }));

import { db } from "@/lib/db";
import { inspectionJobs } from "@/lib/db/schema";
import { createInspectionJob, getInspectionJob } from "@/lib/db/inspection";
import { handoverClaimCode } from "@/lib/telegram/handover-claim";
import { POST } from "./route";

const ME = "0x5555555555555555555555555555555555555555";
const OTHER = "0x6666666666666666666666666666666666666666";
let n = 0;

function plan(owner: string) {
  return createInspectionJob({
    founderWallet: owner,
    publicCampaignId: `launch-claimroute-${++n}`,
    productUrl: `https://claim${n}.example`,
    goal: "",
    targetUsers: "",
    totalBudgetBase: BigInt(20_000_000),
    tokenDecimals: 6,
    planningRequestId: `req-claimroute-${n}`,
  }).job.id;
}

const post = (id: string, body: unknown = {}) =>
  POST(new NextRequest(`https://sagepays.xyz/api/t/${id}/claim`, { method: "POST", body: JSON.stringify(body), headers: { "x-forwarded-for": `10.1.${n}.${Math.floor(Math.random() * 250)}` } }), { params: Promise.resolve({ id }) });

beforeEach(() => {
  h.me = null;
  vi.stubEnv("SAGE_SESSION_SECRET", "a-test-secret-of-enough-length");
  db.delete(inspectionJobs).run();
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/t/[id]/claim", () => {
  it("asks a stranger to sign in, and answers 404 for no such test", async () => {
    const id = plan("anonymous");
    expect((await post(id)).status).toBe(401);
    h.me = ME;
    expect((await post("no-such-test")).status).toBe(404);
  });

  it("gives nobody's plan to the first signed-in person, and only to them", async () => {
    const id = plan("anonymous");
    h.me = ME;
    expect(await (await post(id)).json()).toMatchObject({ ok: true, claimed: true });
    expect(getInspectionJob(id)?.founderWallet).toBe(ME);
    h.me = OTHER;
    expect((await post(id)).status).toBe(403);
  });

  it("says a plan is already yours without changing it", async () => {
    const id = plan(ME);
    h.me = ME;
    expect(await (await post(id)).json()).toMatchObject({ ok: true, claimed: false });
  });

  it("moves a Telegram plan only with its own code", async () => {
    const id = plan("clawup:tg-777");
    h.me = ME;
    expect((await post(id, { claim: "1900000000.0000000000000000000000000000000000000000" })).status).toBe(403);
    expect(getInspectionJob(id)?.founderWallet).toBe("clawup:tg-777");
    const code = handoverClaimCode(id, "clawup:tg-777");
    expect(await (await post(id, { claim: code })).json()).toMatchObject({ ok: true, claimed: true });
    expect(getInspectionJob(id)?.founderWallet).toBe(ME);
  });

  it("never moves a plan another wallet or an X account owns", async () => {
    h.me = ME;
    const theirs = plan(OTHER);
    const tagged = plan("x:42");
    expect((await post(theirs)).status).toBe(403);
    expect((await post(tagged)).status).toBe(403);
    expect(getInspectionJob(theirs)?.founderWallet).toBe(OTHER);
    expect(getInspectionJob(tagged)?.founderWallet).toBe("x:42");
  });
});
