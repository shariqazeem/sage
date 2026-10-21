import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { inArray } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { campaigns, events, submissions } from "@/lib/db/schema";
import { recordEvent } from "@/lib/db/campaigns";
import { decidedOnMainnet, mainnetSettled, refusedOnMainnet } from "@/lib/campaigns/settled-ledger";
import { marketplace, payoutWait } from "@/lib/campaigns/marketplace";
import { liveProof } from "./live-proof";
import { LEDGER_REDIRECTS } from "./redirects-ledger";
import { LEDGER_PAGE_SIZE, ledgerHref, ledgerOutcomes, lookupTarget, parseLedgerQuery, readLedger, type LedgerQuery } from "./ledger";
import { publicReadings } from "./readings";

/**
 * THE LEDGER ADDS UP TO THE HOME PAGE. /explorer and /outcomes folded into /ledger on 19 Oct 2026,
 * and the one thing the new page may not do is grow a fifth arithmetic for "how much was paid" or
 * "how many were refused" (four surfaces once showed four refusal shares on the same day). So the
 * totals are held equal to `mainnetSettled()` and `decidedOnMainnet()` on seeded rows that include
 * every trap: a testnet payout, a sandbox payout, Sage paying itself, held work, an empty primary
 * network, and a second rail.
 */

const NOW = 1_800_000_000;
const OPERATOR = "0xdf70f6e8e656e5bb714ff0e8ca176d76f26890e3"; // one of Sage's own wallets (settled-ledger.ts)
const wallet = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
const tx = (label: string) => `0x${Buffer.from(label).toString("hex").padStart(64, "0")}`;
const ALL: LedgerQuery = { show: "all", network: null, page: 1 };

let seq = 0;
function job(id: string, chainId: number, sandbox = false) {
  db.insert(campaigns)
    .values({
      id,
      title: `Job ${id}`,
      rewardAmount: 500_000,
      maxRecipients: 10,
      vaultAddress: wallet(9_000 + ++seq),
      posterWallet: wallet(1),
      chainId,
      status: "live",
      sandbox,
      createdAt: NOW - 10_000,
    })
    .run();
}

function submission(campaignId: string, who: string, status: string, at: number, payoutTx: string | null = null): string {
  const id = `sub-${++seq}`;
  db.insert(submissions)
    .values({ id, campaignId, wallet: who, dedupeKey: `dedupe-${id}`, status, payoutTx, decidedAt: at, createdAt: at - 60 })
    .run();
  return id;
}

/** A settled payout, journaled the way the settle flow journals one. */
function paid(campaignId: string, who: string, label: string, amount: number, at: number, kind: "settled" | "autopay_settled" = "settled") {
  const id = submission(campaignId, who, "paid", at, tx(label));
  recordEvent({ campaignId, submissionId: id, kind, txHash: tx(label), amount, createdAt: at });
}

const refused = (campaignId: string, who: string, at: number) => submission(campaignId, who, "rejected", at);

function seed() {
  job("goat", 2345);
  job("metis", 1088);
  job("arc", 5042);
  job("stark", 900_001);
  job("sepolia", 59902); // retired testnet: never money
  job("arc-test", 5042002); // Arc testnet: never money
  job("sand", 2345, true); // the red-team sandbox: never settles

  paid("goat", wallet(11), "g1", 500_000, NOW - 100);
  paid("goat", wallet(12), "g2", 1_250_000, NOW - 90);
  paid("goat", OPERATOR, "op", 1_000_000, NOW - 80); // Sage paying itself: real money, not a person
  paid("stark", wallet(13), "s1", 500_000, NOW - 70, "autopay_settled");
  paid("arc", wallet(14), "a1", 2_000_000, NOW - 60);
  paid("sepolia", wallet(11), "t1", 9_000_000, NOW - 55);
  paid("arc-test", wallet(15), "t2", 7_000_000, NOW - 54);
  paid("sand", wallet(16), "x1", 5_000_000, NOW - 53);

  refused("goat", wallet(21), NOW - 50);
  refused("goat", wallet(22), NOW - 40);
  refused("stark", wallet(23), NOW - 30);
  refused("sepolia", wallet(24), NOW - 20);
  refused("sand", wallet(25), NOW - 10);
  submission("goat", wallet(26), "pending", NOW - 5); // held work is not a verdict
}

beforeEach(() => {
  db.delete(events).run();
  db.delete(submissions).run();
  db.delete(campaigns).run();
});

describe("the ledger's totals are the home page's totals", () => {
  it("paid, payouts and refused equal mainnetSettled() and decidedOnMainnet(), and liveProof() on the home page", () => {
    seed();
    const l = readLedger(ALL);
    const money = mainnetSettled();
    expect(l.totals.paidUsd).toBe(money.usdcSettled);
    expect(l.totals.payouts).toBe(money.payouts);
    expect(l.totals.refused).toBe(decidedOnMainnet().refused);
    // the seeded truth, so a wrong derivation cannot pass by agreeing with itself
    expect(l.totals.paidUsd).toBe(5.25);
    expect(l.totals.payouts).toBe(5);
    expect(l.totals.refused).toBe(3);

    const home = liveProof();
    expect([home.paidUsd, home.payouts, home.refused]).toEqual([l.totals.paidUsd, l.totals.payouts, l.totals.refused]);
  });

  it("the refusal list is the refusal count: one predicate, never a second query's answer", () => {
    seed();
    expect(refusedOnMainnet()).toHaveLength(decidedOnMainnet().refused);
    expect(readLedger({ ...ALL, show: "refused" }).counts.refused).toBe(decidedOnMainnet().refused);
  });

  it("the list adds up to the totals: every payout and every refusal, nothing else", () => {
    seed();
    const l = readLedger(ALL);
    expect(l.counts).toEqual({ all: 8, paid: 5, refused: 3 });
    const paidBase = l.entries.filter((e) => e.kind === "paid").reduce((s, e) => s + (e.amountBase ?? 0), 0);
    expect(paidBase / 1e6).toBe(l.totals.paidUsd);
    const shown = JSON.stringify(l.entries);
    for (const gone of ["t1", "t2", "x1"]) expect(shown).not.toContain(tx(gone)); // testnets and the sandbox
  });

  it("is empty, not broken, before the first payout", () => {
    const l = readLedger(ALL);
    expect(l.totals).toEqual({ paidUsd: 0, payouts: 0, refused: 0 });
    expect(l.entries).toEqual([]);
    expect(l.pages).toBe(1);
  });
});

describe("the outcomes and Caribbean pages read the same numbers (20 Oct 2026)", () => {
  it("money, payouts, refusals, people, the wait and the networks are the ledger's own", () => {
    seed();
    const r = publicReadings();
    const l = readLedger(ALL);
    const jobs = ledgerOutcomes();
    expect([r.paidUsd, r.payouts, r.refused]).toEqual([l.totals.paidUsd, l.totals.payouts, l.totals.refused]);
    expect(r.refusedSharePct).toBe(decidedOnMainnet().sharePct);
    expect([r.people, r.medianWaitSeconds, r.measuredWaits]).toEqual([jobs.people, jobs.medianWaitSeconds, jobs.measured]);
    // only networks that have paid someone, in the ledger's order, adding up to the ledger's total
    expect(r.networks.map((n) => n.name)).toEqual(l.networks.filter((n) => n.payouts > 0).map((n) => n.name));
    expect(r.networks.reduce((s, n) => s + n.payouts, 0)).toBe(l.totals.payouts);
    // and the home page agrees with all of it
    const home = liveProof();
    expect([home.paidUsd, home.payouts, home.refused]).toEqual([r.paidUsd, r.payouts, r.refused]);
  });

  it("counts funders and local-currency payouts over the same settled rows as the payouts", () => {
    seed();
    // the Starknet job priced in Jamaican dollars; the testnet one too, which must never count
    db.update(campaigns).set({ currency: "JMD" }).where(inArray(campaigns.id, ["stark", "sepolia"])).run();
    const r = publicReadings();
    expect(r.funders).toBe(1); // every seeded job is funded by one wallet
    expect(r.funders).toBeLessThanOrEqual(r.payouts);
    expect(r.denominated).toEqual({ payouts: 1, usd: 0.5, currencies: ["JMD"] });
  });
});

describe("by network", () => {
  it("primary networks first (shown before their first payout), then the others that have moved money", () => {
    seed();
    const l = readLedger(ALL);
    // Metis is the one primary network since 21 Oct 2026 (shown before its first payout); GOAT, paused
    // for new money, keeps its history under the secondary networks that have moved money.
    expect(l.networks.map((n) => [n.key, n.tier])).toEqual([
      ["metis-andromeda", "primary"],
      ["arc", "secondary"],
      ["starknet", "secondary"],
      ["goat", "secondary"],
    ]);
    const by = Object.fromEntries(l.networks.map((n) => [n.key, n]));
    expect([by.goat.paidUsd, by.goat.payouts, by.goat.refused]).toEqual([2.75, 3, 2]);
    expect([by["metis-andromeda"].payouts, by["metis-andromeda"].refused]).toEqual([0, 0]);
    expect([by.starknet.paidUsd, by.starknet.payouts, by.starknet.refused]).toEqual([0.5, 1, 1]);
  });

  it("the networks add up to the totals, and no testnet is a network here", () => {
    seed();
    const l = readLedger(ALL);
    const sum = (k: "paidUsd" | "payouts" | "refused") => l.networks.reduce((s, n) => s + n[k], 0);
    expect(Math.round(sum("paidUsd") * 1e6)).toBe(Math.round(l.totals.paidUsd * 1e6));
    expect(sum("payouts")).toBe(l.totals.payouts);
    expect(sum("refused")).toBe(l.totals.refused);
    expect(l.networks.map((n) => n.chainId)).not.toContain(59902);
    expect(l.networks.map((n) => n.chainId)).not.toContain(5042002);
  });
});

describe("the lines", () => {
  it("newest first, each payout carrying its receipt, each refusal naming no one", () => {
    seed();
    const l = readLedger(ALL);
    expect(l.entries.map((e) => e.kind)).toEqual(["refused", "refused", "refused", "paid", "paid", "paid", "paid", "paid"]);
    for (const e of l.entries.filter((x) => x.kind === "paid")) {
      expect(e.txHash).toMatch(/^0x[0-9a-f]{64}$/);
      expect(e.amountBase).toBeGreaterThan(0);
      expect(e.job).toMatch(/^Job /);
    }
    for (const e of l.entries.filter((x) => x.kind === "refused")) {
      expect(e.recipient).toBeNull();
      expect(e.txHash).toBeNull(); // refusing moved nothing, so there is nothing to open
    }
    const shown = JSON.stringify(l.entries);
    for (const n of [21, 22, 23]) expect(shown).not.toContain(wallet(n)); // refused wallets never published
  });

  it("names Sage's own wallet instead of passing it off as a person", () => {
    seed();
    const l = readLedger({ ...ALL, show: "paid" });
    const own = l.entries.filter((e) => e.ownWallet);
    expect(own).toHaveLength(1);
    expect(own[0].txHash).toBe(tx("op"));
    expect(l.hasOwnWallet).toBe(true);
  });

  it("filters by what and where, on the server, with counts inside the chosen network", () => {
    seed();
    const goat = readLedger({ show: "refused", network: "goat", page: 1 });
    expect(goat.counts).toEqual({ all: 5, paid: 3, refused: 2 });
    expect(goat.entries.map((e) => e.kind)).toEqual(["refused", "refused"]);
    expect(goat.entries.every((e) => e.chainId === 2345 && e.network === "GOAT Network")).toBe(true);
    expect(readLedger({ show: "all", network: "metis-andromeda", page: 1 }).entries).toEqual([]);
  });

  it("pages fifty at a time, and a page past the end shows the last one", () => {
    job("goat", 2345);
    for (let i = 0; i < LEDGER_PAGE_SIZE + 10; i++) paid("goat", wallet(100 + i), `p${i}`, 100_000, NOW - i);
    const one = readLedger(ALL);
    expect(one.pages).toBe(2);
    expect(one.entries).toHaveLength(LEDGER_PAGE_SIZE);
    const two = readLedger({ ...ALL, page: 2 });
    expect(two.entries).toHaveLength(10);
    expect(new Set([...one.entries, ...two.entries].map((e) => e.id)).size).toBe(LEDGER_PAGE_SIZE + 10);
    const past = readLedger({ ...ALL, page: 9 });
    expect([past.page, past.query.page, past.entries.length]).toEqual([2, 2, 10]);
  });
});

describe("what the jobs got", () => {
  it("is the board's own people count and wait, and the one refusal share", () => {
    seed();
    const o = ledgerOutcomes();
    expect(o.people).toBe(marketplace().paidToDate.people);
    expect(o.medianWaitSeconds).toBe(payoutWait().medianSeconds);
    expect(o.measured).toBe(payoutWait().measured);
    expect(o.refusedSharePct).toBe(decidedOnMainnet().sharePct);
    expect(o.people).toBe(4); // four testers; Sage paying itself is not a person
  });
});

describe("the address bar", () => {
  it("reads only what it knows, and falls back to everything on page one", () => {
    expect(parseLedgerQuery({})).toEqual(ALL);
    expect(parseLedgerQuery({ show: "Refused", network: "GOAT", page: "3" })).toEqual({ show: "refused", network: "goat", page: 3 });
    expect(parseLedgerQuery({ show: ["paid", "refused"] }).show).toBe("paid");
    expect(parseLedgerQuery({ show: "everything", network: "metis-sepolia", page: "-2" })).toEqual(ALL); // a testnet is no filter
    expect(parseLedgerQuery({ network: "nowhere", page: "two" })).toEqual(ALL);
  });

  it("writes plain addresses, leaving the defaults out", () => {
    expect(ledgerHref({})).toBe("/ledger#activity");
    expect(ledgerHref({ show: "all", network: null, page: 1 }, null)).toBe("/ledger");
    expect(ledgerHref({ show: "paid", network: "goat", page: 2 })).toBe("/ledger?show=paid&network=goat&page=2#activity");
  });

  it("looks up a transaction or a wallet, and says no to anything else", () => {
    job("stark", 900_001);
    submission("stark", wallet(30), "paid", NOW, "0x5a3f"); // a payout hash written without its leading zeros
    expect(lookupTarget(` ${tx("g1").toUpperCase().replace("0X", "0x")} `)).toBe(`/proof/${tx("g1")}`);
    expect(lookupTarget(wallet(11))).toBe(`/record/${wallet(11)}`);
    expect(lookupTarget("0x5A3F")).toBe("/proof/0x5a3f");
    for (const bad of ["", "hello", "0x", "0xzz", `0x${"a".repeat(65)}`, "javascript:alert(1)"]) expect(lookupTarget(bad)).toBeNull();
  });
});

describe("the old addresses", () => {
  it("/explorer lands on the ledger for good; /outcomes is its own page again (20 Oct 2026)", () => {
    expect(LEDGER_REDIRECTS).toEqual([{ source: "/explorer", destination: "/ledger", permanent: true }]);
    const root = process.cwd();
    expect(existsSync(join(root, "src/app/explorer"))).toBe(false);
    expect(existsSync(join(root, "src/app/outcomes/page.tsx"))).toBe(true);
    expect(readFileSync(join(root, "next.config.ts"), "utf8")).toContain("...LEDGER_REDIRECTS");
  });

  it("the page keeps the site's rules: tokens only, no inline styles, no utility classes", () => {
    const root = process.cwd();
    const page = readFileSync(join(root, "src/app/ledger/page.tsx"), "utf8");
    const css = readFileSync(join(root, "src/styles/ledger.css"), "utf8");
    expect(page).toMatch(/export const dynamic = "force-dynamic"/);
    expect(page).toMatch(/<SiteFrame active="\/ledger">/);
    expect(page).not.toMatch(/style=\{/);
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i); // colours come from tokens.css
  });
});
