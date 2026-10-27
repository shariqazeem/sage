import { beforeEach, describe, expect, it, vi } from "vitest";
import { linkWallets } from "@/lib/campaigns/wallet-links";
import { addMember, createWorkspace, setWorkspacePlan, walletMemberKey } from "@/lib/db/workspaces";
import { isWorkspacePerson, personRole } from "./person-role";

/**
 * A ROLE FOLLOWS THE PERSON (27 Oct 2026). Signed in with a wallet they bound to their account, a
 * founder walked into their own workspace and launched on its plan, then was told "only the workspace
 * owner can invite". Every role check now asks about the person: the session wallet and every wallet
 * they DECLARED as theirs. A link the farm watch discovered never carries a role.
 */
const evm = (n: string) => `0x${n.repeat(40).slice(0, 40)}`;
const felt = (n: string) => `0x${n.repeat(63).slice(0, 63)}`;
const LINKED_AT = 1_800_000_000;

describe("personRole", () => {
  it("is the owner signed in directly", () => {
    const owner = evm("a1");
    const ws = createWorkspace({ name: "Direct", ownerKey: walletMemberKey(owner), ownerAddress: owner });
    expect(personRole(ws, owner)).toBe("owner");
  });

  it("is still the owner signed in with a wallet they declared as theirs", () => {
    const [account, metamask] = [felt("2b"), evm("b3")];
    const ws = createWorkspace({ name: "Bound", ownerKey: walletMemberKey(account), ownerAddress: account });
    linkWallets(account, metamask, LINKED_AT, "declared");
    expect(personRole(ws, metamask)).toBe("owner");
  });

  it("never hands a role through a link the watch discovered", () => {
    const [founder, farm] = [evm("c4"), evm("c5")];
    const ws = createWorkspace({ name: "Not yours", ownerKey: walletMemberKey(founder), ownerAddress: founder });
    linkWallets(founder, farm, LINKED_AT, "discovered");
    expect(personRole(ws, farm)).toBeNull();
  });

  it("takes the strongest role among the person's wallets", () => {
    const [owner, email, metamask] = [evm("d6"), evm("d7"), evm("d8")];
    const ws = createWorkspace({ name: "Co-op", ownerKey: walletMemberKey(owner), ownerAddress: owner });
    addMember({ workspaceId: ws.id, memberKey: walletMemberKey(email), address: email, role: "admin" });
    addMember({ workspaceId: ws.id, memberKey: walletMemberKey(metamask), address: metamask, role: "member" });
    linkWallets(email, metamask, LINKED_AT, "declared");
    expect(personRole(ws, metamask)).toBe("admin");
    expect(personRole(ws, evm("d9"))).toBeNull();
  });
});

describe("isWorkspacePerson: the members-only door", () => {
  it("lets in a member who joined by email and submits from the MetaMask they bound", () => {
    const [owner, email, metamask] = [evm("e1"), evm("e2"), evm("e3")];
    const ws = createWorkspace({ name: "Team", ownerKey: walletMemberKey(owner), ownerAddress: owner });
    addMember({ workspaceId: ws.id, memberKey: walletMemberKey(email), address: email });
    expect(isWorkspacePerson(ws.id, metamask)).toBe(false);
    linkWallets(email, metamask, LINKED_AT, "declared");
    expect(isWorkspacePerson(ws.id, metamask)).toBe(true);
  });

  it("keeps out a wallet only the watch linked to a member", () => {
    const [owner, member, farm] = [evm("f1"), evm("f2"), evm("f3")];
    const ws = createWorkspace({ name: "Closed", ownerKey: walletMemberKey(owner), ownerAddress: owner });
    addMember({ workspaceId: ws.id, memberKey: walletMemberKey(member), address: member });
    linkWallets(member, farm, LINKED_AT, "discovered");
    expect(isWorkspacePerson(ws.id, farm)).toBe(false);
  });
});

describe("the invite door, signed in with a bound wallet", () => {
  beforeEach(() => vi.resetModules());

  it("mints an invite for the owner of a workspace that came through a declared link", async () => {
    const [account, metamask] = [felt("27"), evm("a8")];
    const ws = createWorkspace({ name: "Linked Co", ownerKey: walletMemberKey(account), ownerAddress: account });
    setWorkspacePlan(ws.id, "pro", Math.floor(Date.now() / 1000) + 30 * 86_400);
    linkWallets(account, metamask, LINKED_AT, "declared");
    vi.doMock("@/lib/auth/session", () => ({ getSessionAddress: async () => metamask }));
    vi.doMock("@/lib/auth/starknet-session", () => ({ getStarknetSessionAddress: async () => null }));
    const { POST } = await import("@/app/api/workspaces/invites/route");
    const res = await POST(new Request("http://x/api/workspaces/invites", { method: "POST", body: JSON.stringify({ workspaceId: ws.id }) }) as never);
    const body = (await res.json()) as { ok?: boolean; url?: string; error?: string };
    expect(body.error).toBeUndefined();
    expect(res.status).toBe(200);
    expect(body.url).toMatch(/\/join\//);
  });
});
