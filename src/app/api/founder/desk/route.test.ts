import { beforeEach, describe, expect, it, vi } from "vitest";

const founder = vi.fn();
const loadDesk = vi.fn();

vi.mock("@/lib/auth/founder", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/founder")>("@/lib/auth/founder");
  return { ...actual, getFounderAddress: () => founder() };
});
vi.mock("@/lib/campaigns/founder-activity", () => ({
  loadFounderDesk: (w: string, n: number) => loadDesk(w, n),
}));

const EVM = "0x3a60af43c67dd9d552f180d30d9a042948078341";

beforeEach(() => {
  founder.mockReset().mockResolvedValue(null);
  loadDesk.mockReset().mockReturnValue({ events: [], lastWorkedAt: null });
});

describe("GET /api/founder/desk", () => {
  it("hands an anonymous caller an empty desk and never consults the loader", async () => {
    // The desk aggregates activity across everything a founder owns — exactly the kind of
    // cross-campaign view that must not exist for a caller with no identity.
    const { GET } = await import("./route");
    const body = await (await GET()).json();
    expect(body.desk).toEqual({ events: [], lastWorkedAt: null });
    expect(loadDesk).not.toHaveBeenCalled();
  });

  it("returns the signed-in founder's desk, keyed by their own wallet", async () => {
    founder.mockResolvedValue(EVM);
    const desk = {
      events: [{ id: "e1", kind: "paid", at: 1788000000, amountBase: 500000, wallet: "0xabc", txHash: "0xdead", confidencePct: null, reasonClass: null, campaignId: "c1", campaignTitle: "Test my app" }],
      lastWorkedAt: 1788000000,
    };
    loadDesk.mockReturnValue(desk);
    const { GET } = await import("./route");
    const body = await (await GET()).json();
    expect(loadDesk).toHaveBeenCalledWith(EVM, 8);
    expect(body.desk.events).toHaveLength(1);
    expect(body.desk.events[0].txHash).toBe("0xdead");
  });
});
