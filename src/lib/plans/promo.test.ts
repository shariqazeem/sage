import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { promoCodes, promoRedemptions, workspaceMembers, workspacePayments, workspaces, type PromoCode } from "@/lib/db/schema";
import { createWorkspace, recordPlanPayment, setWorkspacePlan } from "@/lib/db/workspaces";
import { founderStorageKey } from "@/lib/auth/founder";
import { checkPromo, discountedPriceUsd, normalizePromoCode, paymentPromo, promoFor, promoPeriod, redeemPromoDays } from "./promo";
import { quotePlan } from "./apply-payment";

/**
 * PROMO CODES (21 Oct 2026): giveaways that bring people in, without a way to take more than was given.
 * - a DAYS code gives free days and charges nothing; a workspace that never paid isn't renewed after it;
 * - a PERCENT code takes its share off the first payment, priced on the server from the code;
 * - one redemption per workspace, uses capped, expiry and "new customers only" honoured.
 */
const NOW = Math.floor(Date.now() / 1000);
const DAY = 86_400;
const F1 = "0x1111111111111111111111111111111111111111";
const F2 = "0x2222222222222222222222222222222222222222";

function code(row: Partial<PromoCode> & { code: string; kind: "days" | "percent" }) {
  db.insert(promoCodes)
    .values({ plan: "pro", days: null, percentOff: null, maxUses: null, uses: 0, expiresAt: null, newOnly: false, note: null, createdAt: NOW, disabledAt: null, ...row })
    .run();
}
const wsOf = (f: string) => db.select().from(workspaces).where(eq(workspaces.ownerKey, founderStorageKey(f))).get();

beforeEach(() => {
  db.delete(promoRedemptions).run();
  db.delete(promoCodes).run();
  db.delete(workspacePayments).run();
  db.delete(workspaceMembers).run();
  db.delete(workspaces).run();
});

describe("the rules (pure)", () => {
  it("codes are upper-case letters, digits and dashes", () => {
    expect(normalizePromoCode(" rise30 ")).toBe("RISE30");
    expect(normalizePromoCode("METIS-RISE")).toBe("METIS-RISE");
    for (const bad of ["", "ab", "a b c", "-LEAD", "x".repeat(33), 42, null]) expect(normalizePromoCode(bad)).toBeNull();
  });

  it("a percent off lands on whole cents and never reaches zero", () => {
    expect(discountedPriceUsd(29, 50)).toBe(14.5);
    expect(discountedPriceUsd(29, 33)).toBe(19.43);
    expect(discountedPriceUsd(149, 10)).toBe(134.1);
    expect(discountedPriceUsd(29, 100)).toBe(0.29); // capped at 99%
  });

  it("refuses a disabled, expired, used-up, wrong-plan, already-used or new-only code with a reason", () => {
    const row = (o: Partial<PromoCode>): PromoCode => ({ code: "X1", plan: "pro", kind: "days", days: 30, percentOff: null, maxUses: null, uses: 0, expiresAt: null, newOnly: false, note: null, createdAt: NOW, disabledAt: null, ...o });
    const ctx = { code: "X1", plan: "pro" as const, redeemed: false, everPaid: false, now: NOW, priceUsd: 29 };
    expect(checkPromo(row({ disabledAt: NOW }), ctx)).toMatchObject({ ok: false });
    expect(checkPromo(row({ expiresAt: NOW - 1 }), ctx)).toMatchObject({ ok: false, error: "That code has expired." });
    expect(checkPromo(row({ maxUses: 2, uses: 2 }), ctx)).toMatchObject({ ok: false, error: "That code has been used up." });
    expect(checkPromo(row({ plan: "team" }), ctx)).toMatchObject({ ok: false, error: "That code is for Team." });
    expect(checkPromo(row({}), { ...ctx, redeemed: true })).toMatchObject({ ok: false });
    expect(checkPromo(row({ newOnly: true }), { ...ctx, everPaid: true })).toMatchObject({ ok: false, error: "That code is for new customers." });
    expect(checkPromo(row({}), ctx)).toMatchObject({ ok: true, kind: "days", days: 30 });
    expect(checkPromo(row({ kind: "percent", days: null, percentOff: 50 }), ctx)).toMatchObject({ ok: true, kind: "percent", discountedUsd: 14.5 });
  });

  it("free days extend the same plan, start a new one, upgrade with credit, and never downgrade", () => {
    expect(promoPeriod({ current: "free", currentUntil: null, next: "pro", days: 30, now: NOW })).toEqual({ ok: true, until: NOW + 30 * DAY });
    expect(promoPeriod({ current: "pro", currentUntil: NOW + 10 * DAY, next: "pro", days: 30, now: NOW })).toEqual({ ok: true, until: NOW + 40 * DAY });
    const up = promoPeriod({ current: "pro", currentUntil: NOW + 10 * DAY, next: "team", days: 30, now: NOW, prices: { pro: 29, team: 149 } });
    expect(up.ok && up.until).toBe(NOW + 30 * DAY + Math.floor((10 * DAY * 29) / 149));
    expect(promoPeriod({ current: "team", currentUntil: NOW + 10 * DAY, next: "pro", days: 30, now: NOW })).toMatchObject({ ok: false });
  });
});

describe("redeeming free days", () => {
  it("puts a new founder on the plan for the days, charges nothing, and leaves renewal off", () => {
    code({ code: "RISE30", kind: "days", days: 30, maxUses: 100 });
    const r = redeemPromoDays(F1, "rise30", "pro", NOW);
    expect(r).toMatchObject({ ok: true, plan: "pro", until: NOW + 30 * DAY, days: 30 });
    const ws = wsOf(F1)!;
    expect(ws).toMatchObject({ plan: "pro", planUntil: NOW + 30 * DAY, autoRenew: false });
    expect(db.select().from(workspacePayments).all()).toHaveLength(0);
    expect(db.select().from(promoCodes).where(eq(promoCodes.code, "RISE30")).get()?.uses).toBe(1);
  });

  it("once per workspace, and never past its last use", () => {
    code({ code: "ONE", kind: "days", days: 7, maxUses: 1 });
    expect(redeemPromoDays(F1, "ONE", "pro", NOW)).toMatchObject({ ok: true });
    expect(redeemPromoDays(F1, "ONE", "pro", NOW)).toMatchObject({ ok: false });
    expect(redeemPromoDays(F2, "ONE", "pro", NOW)).toMatchObject({ ok: false, error: "That code has been used up." });
    expect(db.select().from(promoRedemptions).all()).toHaveLength(1);
  });

  it("a paying customer keeps their renewal as it was, with the free days on top", () => {
    const ws = createWorkspace({ name: "Paid", ownerKey: founderStorageKey(F1), ownerAddress: F1 });
    setWorkspacePlan(ws.id, "pro", NOW + 5 * DAY);
    recordPlanPayment({ txHash: `0x${"c".repeat(64)}`, workspaceId: ws.id, chainId: 1088, payer: F1, amountBase: BigInt(29_000_000), planUntil: NOW + 5 * DAY, plan: "pro" });
    code({ code: "THANKS", kind: "days", days: 30 });
    expect(redeemPromoDays(F1, "THANKS", "pro", NOW)).toMatchObject({ ok: true, until: NOW + 35 * DAY });
    expect(wsOf(F1)).toMatchObject({ autoRenew: true });
  });

  it("a new-customers code is refused to a workspace that has paid", () => {
    const ws = createWorkspace({ name: "Paid", ownerKey: founderStorageKey(F1), ownerAddress: F1 });
    recordPlanPayment({ txHash: `0x${"d".repeat(64)}`, workspaceId: ws.id, chainId: 1088, payer: F1, amountBase: BigInt(29_000_000), planUntil: NOW + DAY, plan: "pro" });
    code({ code: "NEWBIE", kind: "days", days: 14, newOnly: true });
    expect(promoFor(F1, "NEWBIE", "pro", NOW)).toMatchObject({ ok: false, error: "That code is for new customers." });
  });
});

describe("a percent code on a payment", () => {
  it("prices the payment from the code, and is redeemed with the payment, once", () => {
    code({ code: "LAUNCH50", kind: "percent", percentOff: 50 });
    const promo = paymentPromo(F1, "launch50", "pro");
    expect(promo).toMatchObject({ ok: true });
    const q = quotePlan(F1, "pro", NOW, promo.ok ? promo.promo : null);
    expect(q.ok && q.priceUsd).toBe(14.5);
    expect(q.ok && q.priceBase).toBe(BigInt(14_500_000));
    if (!q.ok) throw new Error(q.error);
    recordPlanPayment({ txHash: `0x${"e".repeat(64)}`, workspaceId: q.workspace.id, chainId: 1088, payer: F1, amountBase: q.priceBase, planUntil: q.until, plan: "pro", promo: { code: "LAUNCH50", percentOff: 50, founder: F1 } });
    expect(db.select().from(promoRedemptions).all()).toEqual([expect.objectContaining({ code: "LAUNCH50", kind: "percent", txHash: `0x${"e".repeat(64)}` })]);
    expect(db.select().from(promoCodes).where(eq(promoCodes.code, "LAUNCH50")).get()?.uses).toBe(1);
    // the same workspace can't use it again
    expect(paymentPromo(F1, "LAUNCH50", "pro")).toMatchObject({ ok: false });
  });

  it("a free-days code can't be paid with, and a percent code can't be redeemed for free", () => {
    code({ code: "FREE7", kind: "days", days: 7 });
    code({ code: "HALF", kind: "percent", percentOff: 50 });
    expect(paymentPromo(F1, "FREE7", "pro")).toMatchObject({ ok: false });
    expect(redeemPromoDays(F1, "HALF", "pro", NOW)).toMatchObject({ ok: false });
    expect(paymentPromo(F1, undefined, "pro")).toEqual({ ok: true, promo: null });
  });
});
