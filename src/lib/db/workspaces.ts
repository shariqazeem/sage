import "server-only";
import { and, eq, ne, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db } from "./index";
import { campaigns, planRenewals, promoCodes, promoRedemptions, workspaceInvites, workspaceMembers, workspacePayments, workspaces, type Campaign, type PlanPaymentMethod, type PlanRenewal, type Workspace, type WorkspaceInvite, type WorkspaceMember, type WorkspacePayment, type WorkspaceRole, type WorkspacePlan } from "./schema";
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

export function setWorkspacePlan(id: string, plan: WorkspacePlan, planUntil: number | null): void {
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
/** Make a member an admin or back (never the owner, whose role is not this door's to change). */
export function setMemberRole(workspaceId: string, memberKey: string, role: "admin" | "member"): boolean {
  const res = db
    .update(workspaceMembers)
    .set({ role })
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.memberKey, memberKey), ne(workspaceMembers.role, "owner")))
    .run();
  return res.changes > 0;
}

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

/** Record a plan payment once; a hash already spent returns null and changes nothing. */
export function recordPlanPayment(input: {
  txHash: string;
  workspaceId: string;
  chainId: number;
  payer: string;
  amountBase: bigint;
  planUntil: number;
  plan?: WorkspacePlan;
  periodStart?: number;
  method?: PlanPaymentMethod;
  /** a percent code this payment used: redeemed in the same transaction as the payment. */
  promo?: { code: string; percentOff: number; founder: string };
}): WorkspacePayment | null {
  const plan = input.plan ?? "pro";
  const paidAt = nowSeconds();
  // The payment and the plan it extends change together or not at all: a recorded payment whose plan
  // never moved would be money taken for nothing.
  const inserted = db.transaction((tx) => {
    const res = tx
      .insert(workspacePayments)
      .values({
        txHash: input.txHash.toLowerCase(),
        workspaceId: input.workspaceId,
        chainId: input.chainId,
        payer: input.payer.toLowerCase(),
        amountBase: Number(input.amountBase),
        paidAt,
        planUntil: input.planUntil,
        plan,
        periodStart: input.periodStart ?? paidAt,
        method: input.method ?? null,
      })
      .onConflictDoNothing()
      .run();
    if (res.changes === 0) return false;
    tx.update(workspaces).set({ plan, planUntil: input.planUntil, updatedAt: paidAt }).where(eq(workspaces.id, input.workspaceId)).run();
    if (input.promo) {
      // The customer paid the discounted price the code was quoted at, so the code is honoured even if
      // its last use went to someone else in the same moment: the count may run one past its cap.
      const r = tx
        .insert(promoRedemptions)
        .values({ code: input.promo.code, workspaceId: input.workspaceId, founder: input.promo.founder.toLowerCase(), plan, kind: "percent", percentOff: input.promo.percentOff, txHash: input.txHash.toLowerCase(), planUntil: input.planUntil, redeemedAt: paidAt })
        .onConflictDoNothing()
        .run();
      if (r.changes > 0) tx.update(promoCodes).set({ uses: sql`${promoCodes.uses} + 1` }).where(eq(promoCodes.code, input.promo.code)).run();
    }
    return true;
  });
  if (!inserted) return null;
  return db.select().from(workspacePayments).where(eq(workspacePayments.txHash, input.txHash.toLowerCase())).get() ?? null;
}

export function listPlanPayments(workspaceId: string): WorkspacePayment[] {
  return db.select().from(workspacePayments).where(eq(workspacePayments.workspaceId, workspaceId)).orderBy(workspacePayments.paidAt).all();
}

/** One payment by its transaction, for its receipt. */
export function getPlanPayment(txHash: string): WorkspacePayment | null {
  return db.select().from(workspacePayments).where(eq(workspacePayments.txHash, txHash.toLowerCase())).get() ?? null;
}

/** Turn a workspace's automatic renewal on or off. The plan in force is unchanged either way. */
export function setAutoRenew(workspaceId: string, on: boolean): void {
  db.update(workspaces).set({ autoRenew: on, updatedAt: nowSeconds() }).where(eq(workspaces.id, workspaceId)).run();
}

/** Remember that this period's "renews soon" reminder went out. */
export function setRenewReminded(workspaceId: string, periodEnd: number): void {
  db.update(workspaces).set({ renewRemindedFor: periodEnd }).where(eq(workspaces.id, workspaceId)).run();
}

/** Every workspace on a paid plan whose period ends in [from, to): the renewal sweep's candidates. */
export function workspacesEndingBetween(from: number, to: number): Workspace[] {
  return db
    .select()
    .from(workspaces)
    .where(and(ne(workspaces.plan, "free"), sql`${workspaces.planUntil} is not null and ${workspaces.planUntil} >= ${from} and ${workspaces.planUntil} < ${to}`))
    .all();
}

/**
 * CLAIM THIS PERIOD'S RENEWAL before any money moves. The first claim inserts the row as `charging`; a
 * row already `failed` may be claimed again (a retry), never one that is `charging` or `paid`. Returns
 * the claimed row, or null when another attempt holds it or it already succeeded.
 */
export function claimRenewal(input: { workspaceId: string; periodEnd: number; plan: WorkspacePlan; now: number; retryAfter: number }): PlanRenewal | null {
  return db.transaction((tx) => {
    const key = and(eq(planRenewals.workspaceId, input.workspaceId), eq(planRenewals.periodEnd, input.periodEnd));
    const existing = tx.select().from(planRenewals).where(key).get();
    if (!existing) {
      tx.insert(planRenewals)
        .values({ workspaceId: input.workspaceId, periodEnd: input.periodEnd, plan: input.plan, status: "charging", attempts: 1, lastAttemptAt: input.now, createdAt: input.now, updatedAt: input.now })
        .run();
      return tx.select().from(planRenewals).where(key).get() ?? null;
    }
    if (existing.status !== "failed") return null;
    if ((existing.lastAttemptAt ?? 0) > input.now - input.retryAfter) return null;
    tx.update(planRenewals)
      .set({ status: "charging", plan: input.plan, attempts: existing.attempts + 1, lastAttemptAt: input.now, error: null, updatedAt: input.now })
      .where(key)
      .run();
    return tx.select().from(planRenewals).where(key).get() ?? null;
  });
}

/** The moment the payment is sent, its hash is kept: a crash after this point is recovered from the chain, never paid twice. */
export function markRenewalSent(workspaceId: string, periodEnd: number, txHash: string, gasTxHash: string | null, now: number): void {
  db.update(planRenewals)
    .set({ txHash: txHash.toLowerCase(), gasTxHash: gasTxHash ?? undefined, updatedAt: now })
    .where(and(eq(planRenewals.workspaceId, workspaceId), eq(planRenewals.periodEnd, periodEnd)))
    .run();
}

/** Settle a claimed renewal: paid with its transaction, or failed with a reason the owner can act on. */
export function finishRenewal(input: { workspaceId: string; periodEnd: number; status: "paid" | "failed"; txHash?: string | null; gasTxHash?: string | null; error?: string | null; now: number }): void {
  db.update(planRenewals)
    .set({
      status: input.status,
      txHash: input.txHash ?? undefined,
      gasTxHash: input.gasTxHash ?? undefined,
      error: input.status === "failed" ? (input.error ?? "The renewal didn't go through.") : null,
      updatedAt: input.now,
    })
    .where(and(eq(planRenewals.workspaceId, input.workspaceId), eq(planRenewals.periodEnd, input.periodEnd)))
    .run();
}

/** The renewal for a workspace's current period end, if one was attempted. */
export function getRenewal(workspaceId: string, periodEnd: number | null): PlanRenewal | null {
  if (periodEnd == null) return null;
  return db.select().from(planRenewals).where(and(eq(planRenewals.workspaceId, workspaceId), eq(planRenewals.periodEnd, periodEnd))).get() ?? null;
}

/**
 * A renewal left `charging` by a crash (the process died between claiming and finishing). It is only
 * safe to retry once the chain shows no payment went out, so this returns them for the sweep to check
 * against the workspace's recorded payments; it never re-sends by itself.
 */
export function staleChargingRenewals(olderThan: number): PlanRenewal[] {
  return db.select().from(planRenewals).where(and(eq(planRenewals.status, "charging"), sql`${planRenewals.lastAttemptAt} < ${olderThan}`)).all();
}
