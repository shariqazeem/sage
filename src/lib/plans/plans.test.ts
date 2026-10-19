import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { campaigns, inspectionJobs, walletLinks, workspaceMembers, workspaces } from "@/lib/db/schema";
import { addMember, createWorkspace, setWorkspacePlan, walletMemberKey } from "@/lib/db/workspaces";
import { createInspectionJob } from "@/lib/db/inspection";
import { linkWallets } from "@/lib/campaigns/wallet-links";
import { cheapestWith, hasFeature, monthlyLabel, PERIOD_SECONDS, PLAN_ORDER, PLANS, planInForce, SELF_SERVE, WORKER_TERMS } from "./catalog";
import { checkLaunch } from "./limits";
import { nextPeriod, planPriceUsd, usdToBase } from "./billing-math";
import { founderPlan, founderUsage, launchAllowed } from "./founder-plan";

/**
 * SAGE IS PAID (19 Oct 2026). What these hold:
 * - the pricing table and the server enforce ONE list (the catalog), never two that drift;
 * - Free can post real work and pay real people (one live job, $50 a month);
 * - limits gate LAUNCHES at every door, before money moves, and never touch a payout;
 * - a payment buys exactly what it says: same plan extends, upgrades credit unused days, a
 *   downgrade while a higher plan runs is refused rather than taken.
 */
const FOUNDER = "0x1111111111111111111111111111111111111111";
const LINKED = "0x2222222222222222222222222222222222222222";
const OTHER = "0x3333333333333333333333333333333333333333";
const NOW = 1_800_000_000;
const DAY = 86_400;
const usd = (n: number) => usdToBase(n);
const src = (f: string) => readFileSync(join(process.cwd(), f), "utf8");

let seq = 0;
function job(opts: { by?: string; status?: string; usdc: number; chainId?: number; sandbox?: boolean; at?: number }) {
  const id = `job-${++seq}`;
  db.insert(campaigns)
    .values({
      id,
      title: `Job ${seq}`,
      rewardAmount: Number(usd(opts.usdc)),
      maxRecipients: 1,
      vaultAddress: `0x${String(seq).padStart(40, "0")}`,
      posterWallet: opts.by ?? FOUNDER,
      chainId: opts.chainId ?? 2345,
      status: opts.status ?? "live",
      sandbox: opts.sandbox ?? false,
      createdAt: opts.at ?? NOW - DAY,
    })
    .run();
  return id;
}

beforeEach(() => {
  db.delete(campaigns).run();
  db.delete(inspectionJobs).run();
  db.delete(workspaceMembers).run();
  db.delete(workspaces).run();
  db.delete(walletLinks).run();
});
afterEach(() => vi.unstubAllEnvs());

describe("the catalog is the one list", () => {
  it("every plan's own lines state its own numbers", () => {
    for (const p of PLAN_ORDER) {
      const lines = PLANS[p].highlights.join(" ");
      if (Number.isFinite(PLANS[p].monthlyUsd)) expect(lines, p).toContain(monthlyLabel(p));
    }
    expect(PLANS.free.liveJobs).toBe(1);
    expect(PLANS.free.highlights[0]).toMatch(/One live job/);
  });

  it("plans only ever add: each plan has every feature of the one below it", () => {
    for (let i = 1; i < PLAN_ORDER.length; i++) {
      for (const f of PLANS[PLAN_ORDER[i - 1]].features) expect(hasFeature(PLAN_ORDER[i], f), `${PLAN_ORDER[i]} has ${f}`).toBe(true);
      expect(PLANS[PLAN_ORDER[i]].monthlyUsd).toBeGreaterThanOrEqual(PLANS[PLAN_ORDER[i - 1]].monthlyUsd);
    }
  });

  it("the self-serve plans have a price; workers have terms and no plan", () => {
    for (const p of SELF_SERVE) expect(planPriceUsd(p, {})).toBeGreaterThan(0);
    expect(planPriceUsd("free", {})).toBe(0);
    expect(planPriceUsd("programs", {})).toBeNull();
    expect(WORKER_TERMS.length).toBeGreaterThan(0);
    expect(cheapestWith("autopilot")).toBe("pro");
    expect(cheapestWith("roles")).toBe("team");
  });

  it("a price can be tuned by env without a deploy of code", () => {
    expect(planPriceUsd("pro", { SAGE_PRO_PRICE_USD: "39" })).toBe(39);
    expect(planPriceUsd("team", { SAGE_TEAM_PRICE_USD: "nonsense" })).toBe(149);
  });

  it("a lapsed paid plan is Free again, never an error", () => {
    expect(planInForce({ plan: "team", planUntil: NOW + 10 }, NOW)).toBe("team");
    expect(planInForce({ plan: "team", planUntil: NOW - 10 }, NOW)).toBe("free");
    expect(planInForce({ plan: "pro", planUntil: null }, NOW)).toBe("free");
    expect(planInForce({ plan: "gold", planUntil: NOW + 10 }, NOW)).toBe("free");
  });
});

describe("the launch check", () => {
  it("Free: a first real job goes through", () => {
    expect(checkLaunch("free", { liveJobs: 0, launchedBase: BigInt(0) }, usd(5))).toEqual({ ok: true });
  });

  it("Free: a second live job is refused, in words, naming the plan that lifts it", () => {
    const r = checkLaunch("free", { liveJobs: 1, launchedBase: usd(5) }, usd(5));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("live_jobs");
    expect(r.upgradeTo).toBe("pro");
    expect(r.message).toMatch(/one live job/);
  });

  it("Free: the $50 month is a ceiling on what launches, with the room left stated", () => {
    const r = checkLaunch("free", { liveJobs: 0, launchedBase: usd(45) }, usd(10));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("monthly_volume");
    expect(r.message).toContain("$5 is left");
    expect(checkLaunch("free", { liveJobs: 0, launchedBase: usd(45) }, usd(5)).ok).toBe(true); // exactly at the line
  });

  it("Pro past $5,000 is offered Team; Programs has no ceiling", () => {
    const r = checkLaunch("pro", { liveJobs: 9, launchedBase: usd(4_990) }, usd(20));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.upgradeTo).toBe("team");
    expect(checkLaunch("programs", { liveJobs: 500, launchedBase: usd(10_000_000) }, usd(1_000_000)).ok).toBe(true);
  });
});

describe("what a payment buys", () => {
  const prices = { pro: 29, team: 149 };
  it("the same plan again extends from the later of now and the current end", () => {
    expect(nextPeriod({ current: "free", currentUntil: null, next: "pro", now: NOW, prices })).toEqual({ ok: true, until: NOW + PERIOD_SECONDS });
    expect(nextPeriod({ current: "pro", currentUntil: NOW + 5 * DAY, next: "pro", now: NOW, prices })).toEqual({ ok: true, until: NOW + 5 * DAY + PERIOD_SECONDS });
  });

  it("an upgrade starts now and credits the unused days at their price", () => {
    const r = nextPeriod({ current: "pro", currentUntil: NOW + 20 * DAY, next: "team", now: NOW, prices });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const creditDays = (r.until - NOW - PERIOD_SECONDS) / DAY;
    expect(creditDays).toBeCloseTo((20 * 29) / 149, 2); // ≈ 3.89 days of Team
  });

  it("a downgrade while the higher plan runs is refused, not charged", () => {
    const r = nextPeriod({ current: "team", currentUntil: NOW + 10 * DAY, next: "pro", now: NOW, prices });
    expect(r.ok).toBe(false);
    // once it has lapsed, the lower plan is simply bought
    expect(nextPeriod({ current: "team", currentUntil: NOW - 1, next: "pro", now: NOW, prices }).ok).toBe(true);
  });

  it("Programs is never bought by a transfer", () => {
    expect(nextPeriod({ current: "free", currentUntil: null, next: "programs", now: NOW }).ok).toBe(false);
  });
});

describe("which plan a founder is on, and what they have live", () => {
  it("no workspace is Free; usage counts live real-money jobs only", () => {
    job({ usdc: 5 });
    job({ usdc: 7, status: "completed" });
    job({ usdc: 3, sandbox: true });
    job({ usdc: 4, chainId: 59902 }); // a testnet job never counts against anyone
    job({ usdc: 9, by: OTHER });
    expect(founderPlan(FOUNDER, NOW).plan).toBe("free");
    const u = founderUsage(FOUNDER, NOW);
    expect(u.liveJobs).toBe(1);
    expect(u.launchedBase).toBe(usd(12)); // 5 live + 7 completed, both this period
  });

  it("a job launched from the founder's ACCOUNT counts as theirs (the email door's usual path)", () => {
    // The account's wallet posts the vault, so the campaign's poster is not the founder; the plan
    // that launched it is. Every launch door starts from a founder-owned plan.
    const ACCOUNT = "0x9999999999999999999999999999999999999999";
    const id = job({ usdc: 6, by: ACCOUNT });
    createInspectionJob({ founderWallet: FOUNDER, publicCampaignId: id, productUrl: "https://acme.io", goal: "g", targetUsers: "", totalBudgetBase: usd(6), tokenDecimals: 6, planningRequestId: "req-account-launch" });
    const u = founderUsage(FOUNDER, NOW);
    expect(u.liveJobs).toBe(1);
    expect(u.launchedBase).toBe(usd(6));
    expect(founderUsage(ACCOUNT, NOW).liveJobs).toBe(1); // the account's own view, unchanged
  });

  it("only the last 30 days count toward the month", () => {
    job({ usdc: 40, status: "completed", at: NOW - 31 * DAY });
    job({ usdc: 2, status: "completed", at: NOW - 2 * DAY });
    expect(founderUsage(FOUNDER, NOW).launchedBase).toBe(usd(2));
  });

  it("a paid workspace is the plan; a lapsed one is Free", () => {
    const ws = createWorkspace({ name: "Acme", ownerKey: walletMemberKey(FOUNDER), ownerAddress: FOUNDER });
    setWorkspacePlan(ws.id, "pro", NOW + DAY);
    expect(founderPlan(FOUNDER, NOW).plan).toBe("pro");
    setWorkspacePlan(ws.id, "pro", NOW - 1);
    expect(founderPlan(FOUNDER, NOW).plan).toBe("free");
  });

  it("the plan follows the person: a declared wallet's workspace, or a seat as admin", () => {
    const ws = createWorkspace({ name: "Linked Co", ownerKey: walletMemberKey(LINKED), ownerAddress: LINKED });
    setWorkspacePlan(ws.id, "team", NOW + DAY);
    expect(founderPlan(FOUNDER, NOW).plan).toBe("free");
    linkWallets(FOUNDER, LINKED, NOW, "declared");
    expect(founderPlan(FOUNDER, NOW).plan).toBe("team");

    const other = createWorkspace({ name: "DAO", ownerKey: walletMemberKey(OTHER), ownerAddress: OTHER });
    setWorkspacePlan(other.id, "programs", NOW + DAY);
    const admin = "0x4444444444444444444444444444444444444444";
    addMember({ workspaceId: other.id, memberKey: walletMemberKey(admin), address: admin, role: "member" });
    expect(founderPlan(admin, NOW).plan).toBe("free"); // a plain member is not billed into it
    addMember({ workspaceId: "x", memberKey: "y", address: null }); // unrelated row, ignored
    db.update(workspaceMembers).set({ role: "admin" }).run();
    expect(founderPlan(admin, NOW).plan).toBe("programs");
  });

  it("a discovered link (the farm watch's finding) never hands anyone a plan", () => {
    const ws = createWorkspace({ name: "Farm", ownerKey: walletMemberKey(LINKED), ownerAddress: LINKED });
    setWorkspacePlan(ws.id, "team", NOW + DAY);
    linkWallets(FOUNDER, LINKED, NOW, "discovered");
    expect(founderPlan(FOUNDER, NOW).plan).toBe("free");
  });

  it("launchAllowed: Free refuses the second live job; the emergency switch lets it through", () => {
    job({ usdc: 5 });
    expect(launchAllowed(FOUNDER, usd(5), NOW).ok).toBe(false);
    vi.stubEnv("SAGE_PLAN_LIMITS", "off");
    expect(launchAllowed(FOUNDER, usd(5), NOW).ok).toBe(true);
  });
});

describe("every launch door asks, and nothing that pays asks", () => {
  it("the account launch, Telegram, the wallet claim and the Starknet deploy check the plan before money moves", () => {
    expect(src("src/lib/treasury/launch.ts")).toMatch(/launchAllowed\(founderAddress, budget\)[\s\S]*deployCampaignViaPrivy/);
    expect(src("src/lib/telegram/agent-wallet-tools.ts")).toMatch(/launchAllowed\(b\.founderAddress, budget\)[\s\S]*deployCampaignViaPrivy\(chatId, inspectionId\)/);
    expect(src("src/app/api/launch/[id]/claim/route.ts")).toMatch(/launchAllowed\(session, budget\)[\s\S]*createDeployment/);
    const sn = src("src/app/api/launch/[id]/starknet/route.ts");
    const get = sn.slice(sn.indexOf("export async function GET"), sn.indexOf("export async function POST"));
    expect(get).toContain("launchAllowed(owner, totalBase)");
  });

  it("the paid features are gated where they are used", () => {
    expect(src("src/app/api/workspaces/invites/route.ts")).toContain('"membersOnly"');
    expect(src("src/app/api/operator/route.ts")).toContain('"autopilot"');
    expect(src("src/lib/operator/tick.ts")).toContain('"autopilot"');
    expect(src("src/app/api/workspaces/members/route.ts")).toContain('"roles"');
    const exp = src("src/app/api/workspaces/export/route.ts");
    expect(exp).toContain('"exports"');
    expect(exp).toContain('"fraudReports"');
  });

  it("no settlement path reads a plan: a live job keeps paying its workers whatever the plan does", () => {
    for (const f of ["src/lib/campaigns/settle-flow.ts", "src/lib/campaigns/settle-starknet.ts", "src/lib/campaigns/settle-dispatch.ts", "src/lib/deputy/pipeline.ts", "src/app/api/campaigns/[id]/submit/route.ts"]) {
      expect(src(f), f).not.toMatch(/@\/lib\/plans\//);
    }
  });
});
