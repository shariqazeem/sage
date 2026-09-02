import { beforeEach, describe, expect, it, vi } from "vitest";
const evm = vi.fn(); const sn = vi.fn(); const link = vi.fn(); const closure = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getSessionAddress: () => evm() }));
vi.mock("@/lib/auth/starknet-session", () => ({ getStarknetSessionAddress: () => sn() }));
vi.mock("@/lib/campaigns/wallet-links", () => ({ linkWallets: (a: string, b: string) => link(a, b), linkedWalletsOf: (w: string) => closure(w) }));

beforeEach(() => { evm.mockReset().mockResolvedValue(null); sn.mockReset().mockResolvedValue(null); link.mockReset().mockReturnValue({ linked: true }); closure.mockReset().mockReturnValue(["a", "b"]); });

describe("POST /api/record/link", () => {
  it("refuses with one session — a link needs both proofs of control", async () => {
    evm.mockResolvedValue("0x00000000000000000000000000000000000000a1");
    const { POST } = await import("./route");
    const res = await POST();
    expect(res.status).toBe(401);
    expect(link).not.toHaveBeenCalled();
  });
  it("links exactly the two signed-in wallets — never anything from a body", async () => {
    evm.mockResolvedValue("0x00000000000000000000000000000000000000a1");
    sn.mockResolvedValue("0x05db1a00fa6ad44e82de90cae46d82cd5ce052394320d60946ef661db68e3048");
    const { POST } = await import("./route");
    const body = await (await POST()).json();
    expect(link).toHaveBeenCalledWith("0x00000000000000000000000000000000000000a1", "0x05db1a00fa6ad44e82de90cae46d82cd5ce052394320d60946ef661db68e3048");
    expect(body.wallets).toEqual(["a", "b"]);
  });
});
