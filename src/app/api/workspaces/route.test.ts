import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A NEW WORKSPACE OPENS ITS ACCOUNT — for an Ethereum-style sign-in, on the default network, once —
 * and never at the cost of the workspace itself: a Privy failure is a warning, the workspace still
 * exists, and the manual door remains. A Starknet sign-in gets a workspace and no account.
 */
const ctx = { address: `0x${"1".repeat(40)}`, memberKey: "w:x", owned: null as null | { id: string; slug: string }, memberships: [] };
const opened = vi.fn(async () => ({ privyWalletAddress: `0x${"c".repeat(40)}` }));
// `after` runs once the response is sent; here it runs at once so the test can see what it did.
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (fn: () => unknown) => { void fn(); } }));
vi.mock("@/lib/workspaces/context", () => ({ workspaceContext: async () => ctx }));
vi.mock("@/lib/db/workspaces", () => ({ createWorkspace: (i: { name: string }) => ({ id: "ws_1", name: i.name, slug: "s" }), renameWorkspace: vi.fn() }));
vi.mock("@/lib/treasury/web", () => ({ DEFAULT_ACCOUNT_CAP_USD: 50, createWebTreasury: (...a: unknown[]) => opened(...(a as [])) }));
vi.mock("@/lib/treasury/summary", () => ({ accountUnavailableBecause: (f: string) => (f.length > 42 ? "starknet" : null) }));

const { POST } = await import("./route");
const post = (name: string) => POST(new Request("http://x/api/workspaces", { method: "POST", body: JSON.stringify({ name }) }) as never);

describe("creating a workspace", () => {
  beforeEach(() => { opened.mockClear(); ctx.owned = null; ctx.address = `0x${"1".repeat(40)}`; });

  it("opens the default-network account for an Ethereum sign-in, after the response", async () => {
    const r = await post("Kingston Market Co-op");
    const j = (await r.json()) as { ok: boolean; account: { opening: boolean } };
    expect(j.ok).toBe(true);
    expect(j.account).toEqual({ opening: true });
    await new Promise((res) => setTimeout(res, 0));
    expect(opened).toHaveBeenCalledWith(ctx.address, 50);
  });

  it("still creates the workspace when the account cannot be opened", async () => {
    opened.mockRejectedValueOnce(new Error("privy down"));
    const r = await post("Blue Mountain Growers");
    const j = (await r.json()) as { ok: boolean; workspace: { id: string } };
    expect(j.ok).toBe(true);
    expect(j.workspace.id).toBe("ws_1");
    await new Promise((res) => setTimeout(res, 0));
    expect(opened).toHaveBeenCalledTimes(1);
  });

  it("opens nothing for a Starknet sign-in", async () => {
    ctx.address = `0x${"2".repeat(63)}`;
    const r = await post("Sunrise Fishers");
    const j = (await r.json()) as { ok: boolean; account: { opening: boolean } };
    expect(j.ok).toBe(true);
    expect(opened).not.toHaveBeenCalled();
    expect(j.account.opening).toBe(false);
  });
});
