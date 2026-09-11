/**
 * A PAGE ON THE PRODUCT, as distinct from a proof the tester made.
 *
 * Two guards key on the evidence link: the submit-time replay index (one link per campaign, across
 * wallets) and the judge's choice of capture (plain fetch or a real browser). Both need the same
 * distinction. A link a tester MADE — a gist carrying their wallet, a page they published — is theirs
 * alone, so a second wallet arriving with it is the Sybil shape the index exists for. A link on the
 * product under test — its pricing page, its live demo — is where every honest tester on an "open it
 * and report" mission lands, so the same link from a second wallet is agreement, not replay.
 *
 * MEASURED 2026-09-11 on plausible.io: the mission "Open the live demo and report what a shop owner
 * would see" carried the homepage as its target surface (the page its instructions START on) and sent
 * testers to /plausible.io. The first tester was paid; the second was refused at the door — "That
 * evidence link was already submitted" — for opening the same demo. The target-surface exemption
 * cannot cover this on its own: the mission brain names the page it saw, and it had visited the
 * button that leads to the demo, never the demo.
 *
 * The contract is the tie-breaker. The direct (composer) path attaches a verification contract to
 * every deliverable mission — `artifact_url`, `public_url` — and those say, structurally, "the tester
 * made this link". The inspection planner attaches none, and its url-verifiable missions ask testers
 * to OPEN a page and answer questions about it. A campaign that came from no inspection has no
 * product to be on, so every link on it is treated as the tester's own.
 *
 * What still bounds a replay of a product page: the per-person slot on public work (World ID), the
 * near-duplicate watch on the notes, the wallet-cluster signals, and the judge reading each note
 * against the page on its own. Pure module — no server imports — so both callers share one answer.
 */

/** Contracts whose evidence link is a thing the tester published — theirs alone, so it stays unique. */
export const TESTER_MADE_CONTRACTS: ReadonlySet<string> = new Set(["artifact_url", "public_url"]);

export function isTesterMadeContract(kind: string | null | undefined): boolean {
  return !!kind && TESTER_MADE_CONTRACTS.has(kind);
}

export function urlOrigin(u: string | null | undefined): string | null {
  if (!u) return null;
  try {
    return new URL(u.trim()).origin.toLowerCase();
  } catch {
    return null;
  }
}

/** Both parse as URLs and share scheme + host + port. An unparseable side never matches. */
export function sameOrigin(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = urlOrigin(a);
  const y = urlOrigin(b);
  return x !== null && y !== null && x === y;
}

export interface ProductPageContext {
  /** the inspected product's URL (the inspection job's), or null when the campaign came from no inspection */
  productUrl: string | null | undefined;
  /** the mission's verification contract kind, or null when it carries none */
  contractKind: string | null | undefined;
}

/**
 * Is this evidence link a page on the product — the inspected product's own origin — rather than a
 * proof the tester made?
 */
export function isProductPage(evidenceUrl: string | null | undefined, ctx: ProductPageContext): boolean {
  if (!evidenceUrl?.trim()) return false;
  if (isTesterMadeContract(ctx.contractKind)) return false;
  return sameOrigin(evidenceUrl, ctx.productUrl);
}
