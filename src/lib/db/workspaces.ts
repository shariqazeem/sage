import "server-only";
import { and, eq, ne, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./index";
import { campaigns, workspaceInvites, workspaceMembers, workspaces, type Campaign, type Workspace, type WorkspaceInvite, type WorkspaceMember, type WorkspaceRole } from "./schema";
import { nowSeconds } from "./keys";
import { founderStorageKey, sameFounder } from "@/lib/auth/founder";

/** A member key: a wallet's founder storage key, or `tg:<chatId>` for a Telegram member. */
export const walletMemberKey = (address: string) => founderStorageKey(address);
export const telegramMemberKey = (chatId: string) => `tg:${chatId}`;

const bare = (a: string) => a.trim().toLowerCase().replace(/^0x/, "").replace(/^0+/, "");

export function slugify(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return base || "workspace";
}

export function createWorkspace(input: { name: string; ownerKey: string; ownerAddress: string; displayName?: string | null }): Workspace {
  const now = nowSeconds();
  const id = `ws_${nanoid(10)}`;
  const name = input.name.trim().slice(0, 60) || "My workspace";
  let slug = slugify(name);
  if (getWorkspaceBySlug(slug)) slug = `${slug}-${nanoid(4).toLowerCase()}`;
  db.insert(workspaces).values({ id, name, slug, ownerKey: input.ownerKey, plan: "free", planUntil: null, createdAt: now, updatedAt: now }).run();
  db.insert(workspaceMembers)
    .values({ workspaceId: id, memberKey: input.ownerKey, address: input.ownerAddress.toLowerCase(), role: "owner", displayName: input.displayName ?? null, invitedBy: null, joinedAt: now })
    .onConflictDoNothing()
    .run();
  return getWorkspace(id)!;
}

export function getWorkspace(id: string): Workspace | null {
  return db.select().from(workspaces).where(eq(workspaces.id, id)).get() ?? null;
}

export function getWorkspaceBySlug(slug: string): Workspace | null {
  return db.select().from(workspaces).where(eq(workspaces.slug, slug)).get() ?? null;
}

export function renameWorkspace(id: string, name: string): void {
  db.update(workspaces).set({ name: name.trim().slice(0, 60) || "My workspace", updatedAt: nowSeconds() }).where(eq(workspaces.id, id)).run();
}

export function setWorkspacePlan(id: string, plan: "free" | "pro", planUntil: number | null): void {
  db.update(workspaces).set({ plan, planUntil, updatedAt: nowSeconds() }).where(eq(workspaces.id, id)).run();
}

/** The workspace this founder OWNS (v1: one per founder). */
export function workspaceOwnedBy(ownerKey: string): Workspace | null {
  return db.select().from(workspaces).where(eq(workspaces.ownerKey, ownerKey)).orderBy(workspaces.createdAt).get() ?? null;
}

/** Every workspace this member belongs to, owner or not. */
export function workspacesForMember(memberKey: string): Workspace[] {
  return db
    .select({ ws: workspaces })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.memberKey, memberKey))
    .all()
    .map((r) => r.ws);
}

/** Workspaces that pay THIS address (a Telegram member's Sage wallet, or a wallet member). */
export function workspacesForAddress(address: string): Workspace[] {
  const b = bare(address);
  if (!b) return [];
  return db
    .select({ ws: workspaces })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(sql`ltrim(lower(substr(${workspaceMembers.address}, 3)), '0') = ${b}`)
    .all()
    .map((r) => r.ws);
}

export function listMembers(workspaceId: string): WorkspaceMember[] {
  return db.select().from(workspaceMembers).where(eq(workspaceMembers.workspaceId, workspaceId)).orderBy(workspaceMembers.joinedAt).all();
}

export function countMembers(workspaceId: string): number {
  return listMembers(workspaceId).length;
}

export function memberRole(workspaceId: string, memberKey: string): WorkspaceRole | null {
  const row = db.select().from(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.memberKey, memberKey))).get();
  return row?.role ?? null;
}

/** Felt-tolerant: `0x01d9…` and `0x1d9…` are one account; EVM addresses compare case-insensitively. */
export function isWorkspaceMemberAddress(workspaceId: string, address: string): boolean {
  const b = bare(address);
  if (!b) return false;
  const row = db
    .select({ k: workspaceMembers.memberKey })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), sql`ltrim(lower(substr(${workspaceMembers.address}, 3)), '0') = ${b}`))
    .get();
  return !!row;
}

export function addMember(input: { workspaceId: string; memberKey: string; address: string | null; role?: WorkspaceRole; invitedBy?: string | null; displayName?: string | null }): { added: boolean; member: WorkspaceMember } {
  const res = db
    .insert(workspaceMembers)
    .values({ workspaceId: input.workspaceId, memberKey: input.memberKey, address: input.address?.toLowerCase() ?? null, role: input.role ?? "member", displayName: input.displayName ?? null, invitedBy: input.invitedBy ?? null, joinedAt: nowSeconds() })
    .onConflictDoNothing()
    .run();
  const member = db.select().from(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, input.workspaceId), eq(workspaceMembers.memberKey, input.memberKey))).get()!;
  return { added: res.changes > 0, member };
}

/** Never the owner: a workspace without its owner is a locked door. */
export function removeMember(workspaceId: string, memberKey: string): boolean {
  const res = db.delete(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.memberKey, memberKey), ne(workspaceMembers.role, "owner"))).run();
  return res.changes > 0;
}

export function createInvite(input: { workspaceId: string; createdBy: string; maxUses?: number }): WorkspaceInvite {
  const code = `ws_inv_${nanoid(12)}`;
  db.insert(workspaceInvites).values({ code, workspaceId: input.workspaceId, createdBy: input.createdBy, createdAt: nowSeconds(), maxUses: input.maxUses ?? 50, uses: 0, revokedAt: null }).run();
  return getInvite(code)!;
}

export function getInvite(code: string): WorkspaceInvite | null {
  return db.select().from(workspaceInvites).where(eq(workspaceInvites.code, code)).get() ?? null;
}

export function listInvites(workspaceId: string): WorkspaceInvite[] {
  return db.select().from(workspaceInvites).where(eq(workspaceInvites.workspaceId, workspaceId)).orderBy(workspaceInvites.createdAt).all();
}

export function revokeInvite(code: string): void {
  db.update(workspaceInvites).set({ revokedAt: nowSeconds() }).where(eq(workspaceInvites.code, code)).run();
}

export type RedeemInviteResult =
  | { ok: true; workspace: Workspace; already: boolean }
  | { ok: false; reason: "not_found" | "revoked" | "exhausted" | "member_cap"; workspace: Workspace | null };

/**
 * Join through an invite. `memberCap` is the plan's limit, decided by the caller (plan.ts) so this
 * layer stays free of pricing. An existing member re-opening the link is simply told so.
 */
export function redeemInvite(
  code: string,
  member: { memberKey: string; address: string | null; displayName?: string | null },
  opts: { memberCap: number },
): RedeemInviteResult {
  const invite = getInvite(code);
  if (!invite) return { ok: false, reason: "not_found", workspace: null };
  const workspace = getWorkspace(invite.workspaceId);
  if (!workspace) return { ok: false, reason: "not_found", workspace: null };
  if (memberRole(workspace.id, member.memberKey)) return { ok: true, workspace, already: true };
  if (invite.revokedAt) return { ok: false, reason: "revoked", workspace };
  if (invite.uses >= invite.maxUses) return { ok: false, reason: "exhausted", workspace };
  if (countMembers(workspace.id) >= opts.memberCap) return { ok: false, reason: "member_cap", workspace };
  const { added } = addMember({ workspaceId: workspace.id, memberKey: member.memberKey, address: member.address, role: "member", invitedBy: invite.createdBy, displayName: member.displayName ?? null });
  if (added) db.update(workspaceInvites).set({ uses: invite.uses + 1 }).where(eq(workspaceInvites.code, code)).run();
  return { ok: true, workspace, already: !added };
}

/**
 * THE WORKSPACE A CAMPAIGN BELONGS TO. By its own column when set; otherwise the workspace its
 * founder owns — a founder with a workspace launches into it, whichever door they used (web
 * composer, Telegram, MCP). Personal campaigns of founders without a workspace stay personal.
 */
export function campaignWorkspace(campaign: Pick<Campaign, "workspaceId" | "posterWallet">): Workspace | null {
  if (campaign.workspaceId) return getWorkspace(campaign.workspaceId);
  return workspaceOwnedBy(founderStorageKey(campaign.posterWallet));
}

export function listWorkspaceCampaigns(ws: Workspace): Campaign[] {
  return db
    .select()
    .from(campaigns)
    .all()
    .filter((c) => c.workspaceId === ws.id || (!c.workspaceId && sameFounder(c.posterWallet, ws.ownerKey)))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function assignCampaignToWorkspace(campaignId: string, workspaceId: string): void {
  db.update(campaigns).set({ workspaceId }).where(eq(campaigns.id, campaignId)).run();
}
