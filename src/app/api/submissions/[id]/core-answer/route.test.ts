import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * THE CORE MISSION'S TAPS are the tester's own: only the person who sent the answer sets them, only
 * on an answer to the core mission, and they stop changing once the answer is decided.
 */
let evm: string | null = null;
vi.mock("@/lib/auth/session", () => ({ getSessionAddress: async () => evm }));
vi.mock("@/lib/auth/starknet-session", () => ({ getStarknetSessionAddress: async () => null }));

import { NextRequest } from "next/server";
import { GET, POST } from "./route";
import { getCoreAnswer } from "@/lib/core-test/answers";
import { CORE_MISSION_KEY } from "@/lib/core-test/shape";
import { missionIdHash } from "@/lib/campaigns/mission-plan";
import { createCampaign, createMission, createSubmission, updateSubmission } from "@/lib/db/campaigns";

const TESTER = "0x00000000000000000000000000000000000000C7";
const OTHER = "0x00000000000000000000000000000000000000d8";
let n = 0;
const wallet = () => `0x${(++n + 12288).toString(16).padStart(40, "0")}`;

function seed(missionKey = CORE_MISSION_KEY) {
  const c = createCampaign({ title: "Try my app", rewardAmount: 2_000_000, maxRecipients: 5, chainId: 1088, vaultAddress: wallet(), posterWallet: wallet(), status: "live" });
  const hash = missionIdHash(c.id, missionKey);
  createMission({ campaignId: c.id, missionKey, missionIdHash: hash, title: "Try it", rewardAmount: 2_000_000, maxCompletions: 5 });
  const r = createSubmission({ campaignId: c.id, wallet: TESTER, note: "a\n\nb\n\nc\n\nd", missionIdHash: hash });
  if (!r.ok) throw new Error(r.error);
  return r.submission.id;
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
let ip = 0;
const post = (id: string, body: unknown) =>
  POST(new NextRequest(`http://localhost/api/submissions/${id}/core-answer`, { method: "POST", body: JSON.stringify(body), headers: { "x-forwarded-for": `10.9.${++ip}.1` } }), ctx(id));
const get = (id: string) => GET(new NextRequest(`http://localhost/api/submissions/${id}/core-answer`), ctx(id));

beforeEach(() => {
  evm = null;
});

describe("POST /api/submissions/[id]/core-answer", () => {
  it("is only for the person who sent the answer", async () => {
    const id = seed();
    expect((await post(id, { reached: "started", again: "maybe" })).status).toBe(401);
    evm = OTHER;
    expect((await post(id, { reached: "started", again: "maybe" })).status).toBe(404);
    expect((await get(id)).status).toBe(404);
    expect((await post("nope", { reached: "started", again: "maybe" })).status).toBe(404);
    expect(getCoreAnswer(id)).toBeNull();
  });

  it("saves the two taps, and the last ones stand while the answer is being checked", async () => {
    const id = seed();
    evm = TESTER.toLowerCase();
    expect(await (await post(id, { reached: "started", again: "maybe" })).json()).toEqual({ ok: true, coreAnswer: { reached: "started", again: "maybe" } });
    expect((await post(id, { reached: "finished", again: "yes" })).status).toBe(200);
    expect(await (await get(id)).json()).toEqual({ coreAnswer: { reached: "finished", again: "yes" } });
  });

  it("takes only the choices on the form", async () => {
    const id = seed();
    evm = TESTER;
    for (const body of [{}, { reached: "started" }, { reached: "the checkout page", again: "yes" }, { reached: "finished", again: "definitely" }, { reached: 3, again: true }]) {
      expect((await post(id, body)).status).toBe(400);
    }
    expect(getCoreAnswer(id)).toBeNull();
  });

  it("is refused for an answer to any other mission", async () => {
    const id = seed("start-a-drop");
    evm = TESTER;
    expect((await post(id, { reached: "finished", again: "yes" })).status).toBe(409);
    expect(getCoreAnswer(id)).toBeNull();
  });

  it("an answer Sage decided within seconds still takes its first taps, and then they are part of the record", async () => {
    const id = seed();
    evm = TESTER;
    updateSubmission(id, { status: "paid", decidedAt: 1_800_000_000 });
    expect((await post(id, { reached: "found-start", again: "no" })).status).toBe(200);
    expect((await post(id, { reached: "finished", again: "yes" })).status).toBe(409);
    expect(getCoreAnswer(id)).toMatchObject({ reached: "found-start", again: "no" });
  });
});
