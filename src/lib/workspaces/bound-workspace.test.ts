import { describe, expect, it, vi, beforeEach } from "vitest";
import { linkWallets } from "@/lib/campaigns/wallet-links";
import { createWorkspace } from "@/lib/db/workspaces";

/**
 * "i was logged in with email, i binded ethereum wallet, it again asking for this all, it should be
 * binded in same email right?" — reported 2026-09-05, and yes it should.
 *
 * A workspace follows the person, not whichever of their wallets is currently in the session. A
 * wallet they DECLARED as theirs is the same account; a wallet the consolidation watch merely
 * linked to them is not, or a farm cluster could walk into a founder's workspace.
 */
const evm = (n: string) => `0x${n.repeat(40).slice(0, 40)}`;
const felt = (n: string) => `0x${n.repeat(63).slice(0, 63)}`;

const signedInAs = (address: string) => {
  vi.doMock("@/lib/auth/session", () => ({ getSessionAddress: async () => address }));
  vi.doMock("@/lib/auth/starknet-session", () => ({ getStarknetSessionAddress: async () => null }));
};

describe("a bound wallet lands in the account it belongs to", () => {
  beforeEach(() => vi.resetModules());

  it("finds the workspace owned by a wallet the person declared as theirs", async () => {
    const [account, bound] = [evm("4"), felt("5")];
    createWorkspace({ name: "Kingston Market Co-op", ownerKey: account, ownerAddress: account });
    linkWallets(account, bound, 1_800_000_000, "declared");
    signedInAs(bound);
    const { workspaceContext } = await import("./context");
    expect((await workspaceContext())?.owned?.name).toBe("Kingston Market Co-op");
  });

  it("still prefers a workspace this wallet owns outright", async () => {
    const [a, b] = [evm("6"), felt("7")];
    createWorkspace({ name: "Theirs", ownerKey: a, ownerAddress: a });
    createWorkspace({ name: "Mine", ownerKey: b, ownerAddress: b });
    linkWallets(a, b, 1_800_000_000, "declared");
    signedInAs(b);
    const { workspaceContext } = await import("./context");
    expect((await workspaceContext())?.owned?.name).toBe("Mine");
  });

  it("NEVER walks in through a link the watch discovered", async () => {
    const [founder, farm] = [evm("8"), evm("9")];
    createWorkspace({ name: "Not yours", ownerKey: founder, ownerAddress: founder });
    linkWallets(founder, farm, 1_800_000_000, "discovered");
    signedInAs(farm);
    const { workspaceContext } = await import("./context");
    expect((await workspaceContext())?.owned).toBeNull();
  });
});
