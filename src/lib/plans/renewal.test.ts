import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { planRenewals, workspacePayments, workspaceMembers, workspaces } from "@/lib/db/schema";
import { createWorkspace, getRenewal, setAutoRenew, setWorkspacePlan } from "@/lib/db/workspaces";
import { founderStorageKey } from "@/lib/auth/founder";

/**
 * PLANS THAT RENEW LIKE A CARD (21 Oct 2026). What these hold, because each one is money:
 * - the reminder goes out three days ahead, once per period;
 * - the charge happens in the plan's last day, once per period, from the Sage balance, never twice
 *   whatever the sweep does (overlapping ticks, a crash after the money left, a retry);
 * - a failed charge is retried no sooner than six hours later, and not at all after the grace window;
 * - a founder without a Sage balance, or with renewal off, is reminded and never charged;
 * - an arranged plan (a grant, Programs) is never charged here.
 */
const h = vi.hoisted(() => ({ account: true }));
const OWNER = "0x1111111111111111111111111111111111111111";
const ACCOUNT = "0x2222222222222222222222222222222222222222";
vi.mock("@/lib/treasury/web", () => ({
  getWebTreasuryOn: (founder: string, chainId: number) =>
    h.account && founder.toLowerCase() === OWNER && chainId === 1088 ? { chatId: `web:${OWNER}@1088`, chainId: 1088, privyWalletAddress: ACCOUNT, privyWalletId: "pw", perCampaignCapBase: 50_000_000 } : null,
  listWebTreasuries: () => [],
}));

const { renewalAction, renewalNotice, renewDuePlans, REMIND_AHEAD_SECONDS, RENEW_AHEAD_SECONDS, RENEW_GRACE_SECONDS, RENEW_RETRY_SECONDS, RENEW_STALE_SECONDS } = await import("./renewal");
const { applyPlanPayment } = await import("./apply-payment");

const NOW = 1_800_000_000;
const HOUR = 3600;
const DAY = 86_400;
let seq = 0;
const tx = () => `0x${(++seq).toString(16).padStart(64, "0")}`;

beforeAll(() => {
  process.env.SAGE_BILLING_ADDRESS = "0x0deF3D4124D0cD1708aEFFE6c1BC8182342a44D6";
});
afterAll(() => {
  delete process.env.SAGE_BILLING_ADDRESS;
});
beforeEach(() => {
  db.delete(planRenewals).run();
  db.delete(workspacePayments).run();
  db.delete(workspaceMembers).run();
  db.delete(workspaces).run();
  h.account = true;
});

function proEndingIn(seconds: number) {
  const ws = createWorkspace({ name: "Coop", ownerKey: founderStorageKey(OWNER), ownerAddress: OWNER });
  setWorkspacePlan(ws.id, "pro", NOW + seconds);
  return ws.id;
}
const wsRow = (id: string) => db.select().from(workspaces).where(eq(workspaces.id, id)).get()!;

/** A payment that really applies, the way payPlanFromBalance does after it reads the receipt. */
const realPay = vi.fn(async (_input: unknown, d: { quote?: () => ReturnType<typeof import("./apply-payment").quoteWorkspacePlan>; onSent?: (t: `0x${string}`, g: `0x${string}` | null) => void }) => {
  const q = d.quote!();
  if (!q.ok) return { ok: false as const, code: "quote" as const, status: 400, error: q.error };
  const hash = tx() as `0x${string}`;
  d.onSent?.(hash, null);
  applyPlanPayment(q, { txHash: hash, chainId: 1088, payer: ACCOUNT, amountBase: q.priceBase, method: "renewal" });
  return { ok: true as const, txHash: hash, until: q.until, amountUsd: q.priceUsd, explorerUrl: "", plan: q.plan, workspaceId: q.workspace.id };
});

describe("renewalAction (pure)", () => {
  const base = { plan: "pro", autoRenew: true, remindedFor: null, attempt: null, now: NOW };
  it("does nothing for Free, an arranged plan, or a plan with no period", () => {
    expect(renewalAction({ ...base, plan: "free", planUntil: NOW + HOUR }).kind).toBe("none");
    expect(renewalAction({ ...base, plan: "programs", planUntil: NOW + HOUR }).kind).toBe("none");
    expect(renewalAction({ ...base, planUntil: null }).kind).toBe("none");
  });
  it("reminds once inside the three days, and charges only inside the last day", () => {
    expect(renewalAction({ ...base, planUntil: NOW + REMIND_AHEAD_SECONDS + HOUR }).kind).toBe("none");
    expect(renewalAction({ ...base, planUntil: NOW + 2 * DAY }).kind).toBe("remind");
    expect(renewalAction({ ...base, planUntil: NOW + 2 * DAY, remindedFor: NOW + 2 * DAY }).kind).toBe("none");
    expect(renewalAction({ ...base, planUntil: NOW + RENEW_AHEAD_SECONDS - 1 }).kind).toBe("charge");
  });
  it("retries a failed charge no sooner than six hours, and stops after the grace window", () => {
    const failedAt = (t: number) => ({ status: "failed" as const, lastAttemptAt: t });
    expect(renewalAction({ ...base, planUntil: NOW + HOUR, attempt: failedAt(NOW - HOUR) }).kind).toBe("none");
    expect(renewalAction({ ...base, planUntil: NOW + HOUR, attempt: failedAt(NOW - RENEW_RETRY_SECONDS) }).kind).toBe("charge");
    expect(renewalAction({ ...base, planUntil: NOW - DAY, attempt: failedAt(NOW - RENEW_RETRY_SECONDS) }).kind).toBe("charge");
    expect(renewalAction({ ...base, planUntil: NOW - RENEW_GRACE_SECONDS - 1, attempt: failedAt(NOW - DAY) }).kind).toBe("none");
  });
  it("never charges with renewal off, and never charges a period already paid or in flight", () => {
    // renewal off: the owner is reminded the plan ends, and nothing is charged
    expect(renewalAction({ ...base, autoRenew: false, planUntil: NOW + HOUR }).kind).toBe("remind");
    expect(renewalAction({ ...base, autoRenew: false, planUntil: NOW + HOUR, remindedFor: NOW + HOUR }).kind).toBe("none");
    expect(renewalAction({ ...base, planUntil: NOW + HOUR, attempt: { status: "paid", lastAttemptAt: NOW - HOUR } }).kind).toBe("none");
    expect(renewalAction({ ...base, planUntil: NOW + HOUR, attempt: { status: "charging", lastAttemptAt: NOW - 7 * HOUR } }).kind).toBe("none");
  });
});

describe("renewalNotice (pure)", () => {
  const n = (over: Partial<Parameters<typeof renewalNotice>[0]>) => renewalNotice({ plan: "pro", planUntil: NOW + 2 * DAY, autoRenew: true, hasBalance: true, attempt: null, balanceUsd: 100, now: NOW, ...over });
  it("says when, how much and from where; warns when the balance is short", () => {
    expect(n({})?.text).toMatch(/Pro renews on .* for \$29 from your Sage balance\./);
    expect(n({ balanceUsd: 10 })).toMatchObject({ tone: "warn" });
    expect(n({ balanceUsd: 10 })?.text).toMatch(/holds \$10\.00/);
  });
  it("says renewal is off, or that there's no balance to renew from, or why a renewal failed", () => {
    expect(n({ autoRenew: false })?.text).toMatch(/Renewal is off/);
    expect(n({ hasBalance: false })?.text).toMatch(/add a Sage balance and it renews itself/);
    expect(n({ attempt: { status: "failed", error: "the balance was short." } })).toMatchObject({ tone: "warn" });
    expect(n({ plan: "free" })).toBeNull();
  });
});

describe("renewDuePlans", () => {
  it("charges once in the plan's last day, from the balance, and the plan runs another period", async () => {
    const id = proEndingIn(12 * HOUR);
    realPay.mockClear();
    const s = await renewDuePlans(NOW, { pay: realPay as never });
    expect(s.charged).toBe(1);
    expect(realPay).toHaveBeenCalledTimes(1);
    expect(realPay.mock.calls[0]![0]).toMatchObject({ founder: OWNER, plan: "pro", chainId: 1088, method: "renewal" });
    expect(wsRow(id).planUntil).toBe(NOW + 12 * HOUR + 30 * DAY);
    expect(getRenewal(id, NOW + 12 * HOUR)).toMatchObject({ status: "paid" });
    // the same tick again, or the next one: the new period is a month away, so nothing is charged
    await renewDuePlans(NOW, { pay: realPay as never });
    await renewDuePlans(NOW + HOUR, { pay: realPay as never });
    expect(realPay).toHaveBeenCalledTimes(1);
    expect(db.select().from(workspacePayments).all()).toHaveLength(1);
  });

  it("a crash after the money left is finished from the chain, never charged twice", async () => {
    const id = proEndingIn(6 * HOUR);
    const sent = tx() as `0x${string}`;
    // the payment goes out, then the process dies before the receipt is read
    const crashing = vi.fn(async (_i: unknown, d: { onSent?: (t: `0x${string}`, g: null) => void }) => {
      d.onSent?.(sent, null);
      return { ok: false as const, code: "unconfirmed" as const, status: 202, error: "not readable yet", txHash: sent };
    });
    await renewDuePlans(NOW, { pay: crashing as never });
    expect(getRenewal(id, NOW + 6 * HOUR)).toMatchObject({ status: "charging", txHash: sent });
    // a later tick before the row is stale: no second charge
    await renewDuePlans(NOW + 10 * 60, { pay: crashing as never });
    expect(crashing).toHaveBeenCalledTimes(1);
    // once stale, the receipt is read and applied, exactly once
    const read = vi.fn(async () => ({ ok: true as const, from: ACCOUNT, to: "0x0deF3D4124D0cD1708aEFFE6c1BC8182342a44D6", amountBase: BigInt(29_000_000) }));
    const s = await renewDuePlans(NOW + RENEW_STALE_SECONDS + 60, { pay: crashing as never, readPayment: read as never });
    expect(s.recovered).toBe(1);
    expect(crashing).toHaveBeenCalledTimes(1);
    expect(getRenewal(id, NOW + 6 * HOUR)).toMatchObject({ status: "paid", txHash: sent });
    expect(wsRow(id).planUntil).toBe(NOW + 6 * HOUR + 30 * DAY);
    expect(db.select().from(workspacePayments).all()).toHaveLength(1);
  });

  it("a failed charge says why, and is retried no sooner than six hours later", async () => {
    const id = proEndingIn(10 * HOUR);
    const short = vi.fn(async () => ({ ok: false as const, code: "insufficient" as const, status: 400, error: "Pro is $29 and your Sage balance holds $3.00." }));
    await renewDuePlans(NOW, { pay: short as never });
    expect(getRenewal(id, NOW + 10 * HOUR)).toMatchObject({ status: "failed", attempts: 1 });
    expect(getRenewal(id, NOW + 10 * HOUR)?.error).toMatch(/holds \$3\.00/);
    await renewDuePlans(NOW + HOUR, { pay: short as never });
    expect(short).toHaveBeenCalledTimes(1);
    await renewDuePlans(NOW + RENEW_RETRY_SECONDS, { pay: short as never });
    expect(short).toHaveBeenCalledTimes(2);
    expect(getRenewal(id, NOW + 10 * HOUR)).toMatchObject({ attempts: 2 });
  });

  it("a founder with no Sage balance, or with renewal off, is reminded and never charged", async () => {
    const id = proEndingIn(2 * DAY);
    h.account = false;
    realPay.mockClear();
    const s = await renewDuePlans(NOW, { pay: realPay as never });
    expect(s.reminded).toBe(1);
    expect(wsRow(id).renewRemindedFor).toBe(NOW + 2 * DAY);
    // the last day comes: still no balance, so still no charge
    await renewDuePlans(NOW + 2 * DAY - HOUR, { pay: realPay as never });
    h.account = true;
    setAutoRenew(id, false);
    await renewDuePlans(NOW + 2 * DAY - HOUR, { pay: realPay as never });
    expect(realPay).not.toHaveBeenCalled();
    expect(db.select().from(planRenewals).all()).toHaveLength(0);
  });

  it("never charges an arranged plan, or one that lapsed past the grace window", async () => {
    const ws = createWorkspace({ name: "Program", ownerKey: founderStorageKey(OWNER), ownerAddress: OWNER });
    setWorkspacePlan(ws.id, "programs", NOW + HOUR);
    realPay.mockClear();
    await renewDuePlans(NOW, { pay: realPay as never });
    setWorkspacePlan(ws.id, "pro", NOW - RENEW_GRACE_SECONDS - HOUR);
    await renewDuePlans(NOW, { pay: realPay as never });
    expect(realPay).not.toHaveBeenCalled();
  });
});
