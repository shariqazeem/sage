import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A FOUNDER MUST BE ABLE TO REVIEW THEIR OWN CAMPAIGN, WHICHEVER CHAIN THEY SIGNED IN FROM.
 *
 * This route read the EVM session unconditionally and compared with `isSameWallet`, so a founder
 * who owns a STARKNET campaign could not authenticate to their own review at all — the same
 * lockout the board's `me` route had, on the path that releases money.
 *
 * It matters more here than anywhere: a hold is Sage saying it could not verify enough to pay by
 * itself and asking the person whose money it is. If that person cannot reach the endpoint, held
 * work is unreleasable — and on the Starknet rail that is every founder, because the walletless
 * Telegram path launches on GOAT.
 */

const getFounderAddress = vi.fn(async (): Promise<string | null> => null);
const settleByRail = vi.fn(async () => ({
  outcome: { settled: true, txHash: "0xpaid", explorerUrl: null, reason: null, recipient: "0x1", amountBase: 500000, needsOwnerAdd: false, failedCheckIndex: null },
  vault: null,
}));
const updateSubmission = vi.fn();

const FELT = "0x5db1a00fa6ad44e82de90cae46d82cd5ce052394320d60946ef661db68e3048";
const EVM = "0x3a60af43c67dd9d552f180d30d9a042948078341";
let poster = FELT;

vi.mock("@/lib/auth/founder", () => ({
  getFounderAddress: () => getFounderAddress(),
  sameFounder: (a: string | null, b: string | null) => {
    const n = (v: string | null) => v?.trim().toLowerCase().replace(/^0x0*/, "") ?? null;
    return !!n(a) && n(a) === n(b);
  },
}));
vi.mock("@/lib/campaigns/settle-dispatch", () => ({ settleByRail: (...a: unknown[]) => settleByRail(...(a as [])) }));
vi.mock("@/lib/db/campaigns", () => ({
  getCampaign: (id: string) => (id === "c1" ? { id, posterWallet: poster, chainId: 900001 } : null),
  getSubmission: (sid: string) => (sid === "s1" ? { id: sid, campaignId: "c1", status: "pending", wallet: "0xbeef" } : null),
  updateSubmission: (...a: unknown[]) => updateSubmission(...(a as [])),
  recordEvent: () => {},
  getMissionByHash: () => null,
}));
vi.mock("@/lib/campaigns/status", () => ({ canDecide: () => true }));
vi.mock("@/lib/format", () => ({ short: (v: string) => v.slice(0, 8) }));
vi.mock("@/lib/db/keys", () => ({ nowSeconds: () => 1788000000 }));

import { POST } from "./route";

const call = (decision: string, id = "c1") =>
  POST(
    { json: async () => ({ decision }) } as never,
    { params: Promise.resolve({ id, sid: "s1" }) },
  ) as Promise<Response>;

beforeEach(() => {
  poster = FELT;
  getFounderAddress.mockReset().mockResolvedValue(null);
  settleByRail.mockClear();
  updateSubmission.mockClear();
});

describe("who may release held work", () => {
  it("lets the STARKNET founder release their own campaign's submission", async () => {
    getFounderAddress.mockResolvedValue(FELT);
    const res = await call("approve");
    expect(res.status).toBe(200);
    expect(settleByRail).toHaveBeenCalledTimes(1);
  });

  it("lets the EVM founder do the same, unchanged", async () => {
    poster = EVM;
    getFounderAddress.mockResolvedValue(EVM);
    expect((await call("approve")).status).toBe(200);
    expect(settleByRail).toHaveBeenCalledTimes(1);
  });

  it("refuses a signed-in wallet that does not own the campaign", async () => {
    getFounderAddress.mockResolvedValue(EVM); // poster is the felt
    const res = await call("approve");
    expect(res.status).toBe(403);
    expect(settleByRail).not.toHaveBeenCalled();
  });

  it("refuses when nobody is signed in", async () => {
    const res = await call("approve");
    expect(res.status).toBe(401);
    expect(settleByRail).not.toHaveBeenCalled();
  });

  it("a refusal moves no money", async () => {
    getFounderAddress.mockResolvedValue(FELT);
    expect((await call("reject")).status).toBe(200);
    expect(settleByRail).not.toHaveBeenCalled();
    expect(updateSubmission).toHaveBeenCalledWith("s1", expect.objectContaining({ status: "rejected" }));
  });
});
