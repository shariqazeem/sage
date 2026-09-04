import "server-only";
import { inArray, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { walletLinks } from "@/lib/db/schema";
import { countDecidedSubmissionsByWallet, getCampaign } from "@/lib/db/campaigns";
import { computeCreditSignals, type CreditSignals } from "./credit";
import { buildWalletRecord, type WalletRecord } from "./record";

/**
 * ONE BUSINESS, MANY RAILS.
 *
 * The brief's core ask is to aggregate fragmented data into one coherent business profile. Sage's
 * record was per wallet, and a wallet is per rail — so a seller paid on GOAT by one funder and on
 * Starknet by another had two half-records, and a lender underwrote half a business. A link is made
 * only between wallets the SAME viewer is signed in with at the same time (EVM sign-in + Starknet
 * sign-in — each already proves control of its wallet); nothing is claimed, everything is proven
 * by the sessions that exist. The combined record is the union of receipt-anchored entries with the
 * same published formulas run over it. Nothing here scores anybody.
 */

/**
 * ONE WALLET, EVERY SPELLING. A Starknet felt arrives padded from the chain (`0x0270…`, 64 hex
 * digits) and unpadded from a submission (`0x270f…`); an EVM address arrives in any case. The first
 * links were written in the chain's padded form and read back with the submission's form, and the
 * two never met — `linkedWalletsOf(submission.wallet)` was empty, so the recorded farm cluster held
 * no one. Rows keep the spelling they were written in; every lookup matches all spellings of a
 * wallet, and the closure is keyed by the wallet's minimal form so one wallet is one node.
 */
const norm = (w: string) => w.trim().toLowerCase();
const key = (w: string) => `0x${norm(w).replace(/^0x/, "").replace(/^0+/, "") || "0"}`;
const forms = (w: string): string[] => {
  const h = norm(w).replace(/^0x/, "");
  const min = h.replace(/^0+/, "");
  return [...new Set([norm(w), key(w), `0x${min.padStart(40, "0")}`, `0x${min.padStart(64, "0")}`])];
};
const canonical = (a: string, b: string): [string, string] => (norm(a) < norm(b) ? [norm(a), norm(b)] : [norm(b), norm(a)]);

/**
 * WHY A LINK EXISTS. `discovered` is the consolidation watch's inference from on-chain behaviour —
 * evidence of wallet rotation. `declared` is a person proving control of both wallets and asking to
 * join them; `personhood` is the same verified nullifier turning up on a second wallet. Only the
 * first is an accusation. See the column's note in schema.ts.
 */
export type LinkOrigin = "discovered" | "declared" | "personhood";

export function linkWallets(
  a: string,
  b: string,
  now = Math.floor(Date.now() / 1000),
  origin: LinkOrigin = "discovered",
): { linked: boolean } {
  const [x, y] = canonical(a, b);
  if (key(x) === key(y)) return { linked: false };
  const exists = db.select().from(walletLinks).where(or(inArray(walletLinks.walletA, forms(x)), inArray(walletLinks.walletB, forms(x)))).all()
    .some((r) => [r.walletA, r.walletB].some((w) => key(w) === key(y)));
  /*
    A DECLARATION NEVER OVERWRITES A DISCOVERY.
    Otherwise the flag is worthless: whoever rotated the wallets controls all of them, so they could
    sign in with any two and "declare" their way out of what the watch found. The row keeps the
    origin it was written with, and a second call of any kind is a no-op.
  */
  if (exists) return { linked: false };
  db.insert(walletLinks).values({ walletA: x, walletB: y, createdAt: now, origin }).run();
  return { linked: true };
}

/**
 * The links that count AGAINST this wallet — which is not the same as the links it has.
 *
 * `discovered` counts: the consolidation watch inferred a cluster from on-chain behaviour, and that
 * is the wallet rotation the tier gate exists to stop.
 *
 * `personhood` counts too, and deliberately: the same verified nullifier reaching a second wallet is
 * one human standing up a second worker, which is the exact thing a personhood proof is for
 * catching. Both wallets drop, or verifying twice would be free.
 *
 * `declared` never counts. A person proving control of both wallets and asking for them to be
 * joined is disclosing, not hiding — and it gains them nothing to weigh against, because standing is
 * computed PER WALLET (`standingOf` reads only that wallet's paid submissions). Declaring a cluster
 * therefore neither merges standing nor multiplies it; the only thing the flag was doing to an
 * honest binder was denying them every tier, for using a feature Sage tells them to use.
 */
export function flaggingLinksOf(wallet: string): string[] {
  const rows = db
    .select()
    .from(walletLinks)
    .where(or(inArray(walletLinks.walletA, forms(wallet)), inArray(walletLinks.walletB, forms(wallet))))
    .all()
    .filter((r) => r.origin !== "declared");
  const me = key(wallet);
  const out = new Map<string, string>();
  for (const r of rows) for (const other of [r.walletA, r.walletB]) if (key(other) !== me && !out.has(key(other))) out.set(key(other), other);
  return [...out.values()].sort();
}

/** Wallets this one is joined to BY DECLARATION — the person said so and proved both. */
export function declaredLinksOf(wallet: string): string[] {
  const rows = db
    .select()
    .from(walletLinks)
    .where(or(inArray(walletLinks.walletA, forms(wallet)), inArray(walletLinks.walletB, forms(wallet))))
    .all()
    .filter((r) => r.origin === "declared");
  const me = key(wallet);
  const out = new Map<string, string>();
  for (const r of rows) for (const other of [r.walletA, r.walletB]) if (key(other) !== me && !out.has(key(other))) out.set(key(other), other);
  return [...out.values()].sort();
}

/** Every wallet reachable from `wallet` through links, including itself — the business. */
/** The wallets linked DIRECTLY to this one — the rows the watch recorded, not their closure. */
export function directLinksOf(wallet: string): string[] {
  const rows = db.select().from(walletLinks).where(or(inArray(walletLinks.walletA, forms(wallet)), inArray(walletLinks.walletB, forms(wallet)))).all();
  const me = key(wallet);
  const out = new Map<string, string>();
  for (const r of rows) for (const other of [r.walletA, r.walletB]) if (key(other) !== me && !out.has(key(other))) out.set(key(other), other);
  return [...out.values()].sort();
}

export function linkedWalletsOf(wallet: string): string[] {
  const start = norm(wallet);
  const seen = new Map<string, string>([[key(start), start]]);
  const queue = [start];
  while (queue.length > 0) {
    const w = queue.shift() as string;
    const rows = db.select().from(walletLinks).where(or(inArray(walletLinks.walletA, forms(w)), inArray(walletLinks.walletB, forms(w)))).all();
    for (const r of rows) {
      for (const other of [r.walletA, r.walletB]) {
        if (!seen.has(key(other))) { seen.set(key(other), other); queue.push(other); }
      }
    }
  }
  return [...seen.values()].sort();
}

export interface LinkedRecord {
  /** every wallet in the business, sorted; length 1 means "no links" */
  wallets: string[];
  record: WalletRecord;
  signals: CreditSignals;
  decided: { paid: number; rejected: number };
}

/** The union of the linked wallets' records, with the published formulas run over the union. */
export function buildLinkedRecord(wallet: string, nowSec = Math.floor(Date.now() / 1000)): LinkedRecord | null {
  const wallets = linkedWalletsOf(wallet);
  const records = wallets.map((w) => buildWalletRecord(w)).filter((r): r is WalletRecord => r !== null);
  if (records.length === 0) return null;
  const entries = records.flatMap((r) => r.entries).sort((a, b) => b.at - a.at);
  const merged: WalletRecord = {
    wallet: norm(wallet),
    totalUsd: records.reduce((s, r) => s + r.totalUsd, 0),
    completions: records.reduce((s, r) => s + r.completions, 0),
    distinctCampaigns: new Set(entries.map((e) => e.campaignId)).size,
    firstAt: entries.length ? Math.min(...entries.map((e) => e.at)) : null,
    lastAt: entries.length ? Math.max(...entries.map((e) => e.at)) : null,
    entries,
  };
  const decided = wallets
    .map((w) => countDecidedSubmissionsByWallet(w))
    .reduce((acc, d) => ({ paid: acc.paid + d.paid, rejected: acc.rejected + d.rejected }), { paid: 0, rejected: 0 });
  const signals = computeCreditSignals(merged, decided, (id) => getCampaign(id)?.posterWallet ?? null, nowSec);
  return { wallets, record: merged, signals, decided };
}

/**
 * ONE KEY PER PERSON for counting: the lowest wallet in the recorded cluster, else the wallet itself.
 * The marketplace publishes people-not-wallets with this; every other surface that says "people"
 * must count the same way, or two pages disagree about how many humans were paid.
 */
export function clusterKeyOf(wallet: string): string {
  if (!wallet) return "";
  const linked = linkedWalletsOf(wallet).map((w) => w.toLowerCase());
  return linked.length > 0 ? linked.slice().sort()[0]! : wallet.toLowerCase();
}
