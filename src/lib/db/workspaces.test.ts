import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { workspaceInvites, workspaceMembers, workspaces } from "@/lib/db/schema";
import {
  campaignWorkspace,
  createInvite,
  createWorkspace,
  isWorkspaceMemberAddress,
  listMembers,
  redeemInvite,
  removeMember,
  revokeInvite,
  telegramMemberKey,
  walletMemberKey,
  workspaceOwnedBy,
  workspacesForAddress,
  workspacesForMember,
} from "./workspaces";

const OWNER = "0xDF70b3e2A1c1c8E2e4A9A6f2B3c4D5e6F7a8b9E3";
const STARK = "0x1d9029ec661f4ecf11c9d34255d923af47fcd62ebd25486f8e42fec94e7367c";
const STARK_PADDED = "0x01d9029ec661f4ecf11c9d34255d923af47fcd62ebd25486f8e42fec94e7367c";

beforeEach(() => {
  db.delete(workspaceInvites).run();
  db.delete(workspaceMembers).run();
  db.delete(workspaces).run();
});

describe("workspaces — the closed loop's tables", () => {
  it("creating a workspace makes its founder the owner member, with a unique slug", () => {
    const a = createWorkspace({ name: "Kingston Market Co-op", ownerKey: walletMemberKey(OWNER), ownerAddress: OWNER });
    const b = createWorkspace({ name: "Kingston Market Co-op", ownerKey: walletMemberKey("0x1111111111111111111111111111111111111111"), ownerAddress: "0x1111111111111111111111111111111111111111" });
    expect(a.slug).toBe("kingston-market-co-op");
    expect(b.slug).not.toBe(a.slug);
    expect(listMembers(a.id).map((m) => m.role)).toEqual(["owner"]);
    expect(workspaceOwnedBy(walletMemberKey(OWNER))?.id).toBe(a.id);
  });

  it("an invite joins a wallet member and a Telegram member; the cap is the caller's plan, not this layer's opinion", () => {
    const ws = createWorkspace({ name: "Team", ownerKey: walletMemberKey(OWNER), ownerAddress: OWNER });
    const inv = createInvite({ workspaceId: ws.id, createdBy: walletMemberKey(OWNER) });
    expect(inv.code).toMatch(/^ws_inv_/);
    const r1 = redeemInvite(inv.code, { memberKey: walletMemberKey(STARK), address: STARK }, { memberCap: 3 });
    expect(r1).toMatchObject({ ok: true, already: false });
    const r2 = redeemInvite(inv.code, { memberKey: telegramMemberKey("123"), address: "0x4a4e04babb990b9f7e8a7afb0900222624665026431158b5031b46687211526" }, { memberCap: 3 });
    expect(r2).toMatchObject({ ok: true, already: false });
    const r3 = redeemInvite(inv.code, { memberKey: walletMemberKey("0x2222222222222222222222222222222222222222"), address: "0x2222222222222222222222222222222222222222" }, { memberCap: 3 });
    expect(r3).toMatchObject({ ok: false, reason: "member_cap" });
    // re-opening the link as an existing member is fine, and never counts a use
    expect(redeemInvite(inv.code, { memberKey: walletMemberKey(STARK), address: STARK }, { memberCap: 3 })).toMatchObject({ ok: true, already: true });
    expect(listMembers(ws.id)).toHaveLength(3);
    expect(workspacesForMember(telegramMemberKey("123")).map((w) => w.id)).toEqual([ws.id]);
  });

  it("membership by address is felt-tolerant and case-insensitive — the submit gate's question", () => {
    const ws = createWorkspace({ name: "Team", ownerKey: walletMemberKey(OWNER), ownerAddress: OWNER });
    const inv = createInvite({ workspaceId: ws.id, createdBy: walletMemberKey(OWNER) });
    redeemInvite(inv.code, { memberKey: walletMemberKey(STARK), address: STARK }, { memberCap: 10 });
    expect(isWorkspaceMemberAddress(ws.id, STARK_PADDED)).toBe(true);
    expect(isWorkspaceMemberAddress(ws.id, OWNER.toLowerCase())).toBe(true);
    expect(isWorkspaceMemberAddress(ws.id, "0x0999")).toBe(false);
    expect(workspacesForAddress(STARK_PADDED).map((w) => w.id)).toEqual([ws.id]);
  });

  it("a revoked or exhausted invite refuses; the owner can never be removed", () => {
    const ws = createWorkspace({ name: "Team", ownerKey: walletMemberKey(OWNER), ownerAddress: OWNER });
    const inv = createInvite({ workspaceId: ws.id, createdBy: walletMemberKey(OWNER), maxUses: 1 });
    redeemInvite(inv.code, { memberKey: walletMemberKey(STARK), address: STARK }, { memberCap: 10 });
    expect(redeemInvite(inv.code, { memberKey: telegramMemberKey("9"), address: null }, { memberCap: 10 })).toMatchObject({ ok: false, reason: "exhausted" });
    const inv2 = createInvite({ workspaceId: ws.id, createdBy: walletMemberKey(OWNER) });
    revokeInvite(inv2.code);
    expect(redeemInvite(inv2.code, { memberKey: telegramMemberKey("9"), address: null }, { memberCap: 10 })).toMatchObject({ ok: false, reason: "revoked" });
    expect(removeMember(ws.id, walletMemberKey(OWNER))).toBe(false);
    expect(removeMember(ws.id, walletMemberKey(STARK))).toBe(true);
    expect(redeemInvite("ws_inv_nope", { memberKey: telegramMemberKey("9"), address: null }, { memberCap: 10 })).toMatchObject({ ok: false, reason: "not_found" });
  });

  it("a campaign belongs to its founder's workspace even before the column is set", () => {
    const ws = createWorkspace({ name: "Team", ownerKey: walletMemberKey(OWNER), ownerAddress: OWNER });
    expect(campaignWorkspace({ workspaceId: null, posterWallet: OWNER })?.id).toBe(ws.id);
    expect(campaignWorkspace({ workspaceId: null, posterWallet: "0x3333333333333333333333333333333333333333" })).toBeNull();
    expect(campaignWorkspace({ workspaceId: ws.id, posterWallet: "0x3333333333333333333333333333333333333333" })?.id).toBe(ws.id);
  });
});
