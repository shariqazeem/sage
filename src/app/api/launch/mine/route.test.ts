import { beforeEach, describe, expect, it, vi } from "vitest";

const founder = vi.fn();
const listJobs = vi.fn();

vi.mock("@/lib/auth/founder", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/founder")>("@/lib/auth/founder");
  return { ...actual, getFounderAddress: () => founder() };
});
vi.mock("@/lib/db/inspection", () => ({ listInspectionJobs: (w: string) => listJobs(w) }));

const EVM = "0x3a60af43c67dd9d552f180d30d9a042948078341";
const SN = "0x5db1a00fa6ad44e82de90cae46d82cd5ce052394320d60946ef661db68e3048";

const job = (id: string) => ({
  id,
  productUrl: "https://example.com/app",
  status: "ready",
  createdAt: 1788000000,
});

beforeEach(() => {
  founder.mockReset().mockResolvedValue(null);
  listJobs.mockReset().mockReturnValue([]);
});

describe("GET /api/launch/mine", () => {
  it("returns nothing to a visitor who is not signed in", async () => {
    // Never a list of somebody else's product URLs to an anonymous caller.
    const { GET } = await import("./route");
    const body = await (await GET()).json();
    expect(body.jobs).toEqual([]);
    expect(listJobs).not.toHaveBeenCalled();
  });

  it("lists the signed-in founder's own inspections", async () => {
    founder.mockResolvedValue(EVM);
    listJobs.mockReturnValue([job("a"), job("b")]);
    const { GET } = await import("./route");
    const body = await (await GET()).json();
    expect(body.jobs.map((j: { id: string }) => j.id)).toEqual(["a", "b"]);
    expect(listJobs).toHaveBeenCalledWith(EVM);
  });

  it("works the same for a Starknet founder — the list follows the wallet, not the chain", async () => {
    founder.mockResolvedValue(SN);
    listJobs.mockReturnValue([job("c")]);
    const { GET } = await import("./route");
    expect((await (await GET()).json()).jobs).toHaveLength(1);
    expect(listJobs).toHaveBeenCalledWith(SN);
  });

  it("queries by the CALLER, never by an address the caller could supply", async () => {
    // The query key comes from the session. If it ever came from input, one founder could read
    // another's inspections by naming their wallet.
    founder.mockResolvedValue(EVM);
    const { GET } = await import("./route");
    await GET();
    expect(listJobs).toHaveBeenCalledTimes(1);
    expect(listJobs).toHaveBeenCalledWith(EVM);
  });

  it("caps the list rather than returning an unbounded history", async () => {
    founder.mockResolvedValue(EVM);
    listJobs.mockReturnValue(Array.from({ length: 40 }, (_, i) => job(`j${i}`)));
    const { GET } = await import("./route");
    expect((await (await GET()).json()).jobs.length).toBeLessThanOrEqual(12);
  });

  it("exposes only the fields the list needs — no founder wallet, no plan", async () => {
    founder.mockResolvedValue(EVM);
    listJobs.mockReturnValue([{ ...job("a"), founderWallet: EVM, result: { secret: 1 } }]);
    const { GET } = await import("./route");
    const [row] = (await (await GET()).json()).jobs;
    expect(Object.keys(row).sort()).toEqual(["createdAt", "id", "productUrl", "status"]);
  });
});
