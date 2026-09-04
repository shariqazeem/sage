import { findCopiedArtifact, findNearDuplicate, type DedupCandidate } from "./dedup";

/**
 * THE FINALIZATION WINDOW — what replaces a person on an open campaign.
 *
 * On a members-only campaign the people are known and the agent pays at once. On an open campaign
 * the same agent approves at once and settles after a short window it uses to watch: reports that
 * arrive later and match this one, an artifact that turns out to be a copy, a wallet that the
 * consolidation watch links to another submitter in the meantime. A hit revokes the payout with the
 * reason written out; silence finalizes it. No dashboard, no reviewer, no queue — a clock and a
 * watch. Measured need: ten rotating wallets took a whole gig in two hours while every single
 * payout looked fine at the moment it was judged; most of the evidence arrived minutes later.
 */
export const DEFAULT_FINALIZE_MINUTES = 30;

export function windowSecondsFor(visibility: "listed" | "unlisted" | null | undefined, env: Record<string, string | undefined> = process.env): number {
  if (visibility === "unlisted") return 0; // members-only: known people, pay now
  const raw = env.AUTOPAY_FINALIZE_MINUTES?.trim();
  if (raw === undefined || raw === "") return DEFAULT_FINALIZE_MINUTES * 60;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 60) : DEFAULT_FINALIZE_MINUTES * 60;
}

export function matured(approvedAt: number, windowSec: number, nowSec: number): boolean {
  return nowSec >= approvedAt + windowSec;
}

export interface RevocationInput {
  me: DedupCandidate;
  /** every OTHER submission on the campaign, including ones that arrived after this one */
  others: DedupCandidate[];
  /** wallets linked to this one by the consolidation watch */
  linkedWallets: string[];
  /** the other submitters' wallets on this campaign */
  peerWallets: string[];
  /**
   * wallets that are THIS PERSON by a personhood proof (same nullifier) — a subset of
   * `linkedWallets` in practice. Optional: a caller that does not know says nothing, and the
   * reason falls back to the on-chain wording.
   */
  personWallets?: string[];
}

const bare = (w: string) => w.trim().toLowerCase().replace(/^0x/, "").replace(/^0+/, "");

/** What each of the three checks reads RIGHT NOW. Pure; the lane shows these lights, the sweep acts on them. */
export interface WatchReadings {
  nearDup: string | null;
  copied: string | null;
  cluster: string | null;
}

export function watchReadings(input: RevocationInput): WatchReadings {
  const near = findNearDuplicate(input.me, input.others);
  const copied = findCopiedArtifact(input.me, input.others);
  const peers = new Set(input.peerWallets.map(bare));
  const hit = input.linkedWallets.map(bare).filter((w) => peers.has(w));
  // Say what the link IS. A personhood link means the provider stated these wallets are one human;
  // reading that as "a payout was forwarded on-chain" would accuse someone of a thing that did not
  // happen, on the one line they are shown.
  const person = new Set((input.personWallets ?? []).map(bare));
  const samePerson = hit.filter((w) => person.has(w)).length;
  const cluster =
    hit.length === 0
      ? null
      : samePerson > 0
        ? `the same verified person already submitted to this campaign from ${samePerson} other wallet${samePerson === 1 ? "" : "s"} — one slot per person on public work`
        : `this wallet is linked on-chain to ${hit.length} other submitter${hit.length === 1 ? "" : "s"} of this campaign (a payout was forwarded between them)`;
  return {
    nearDup: near ? near.reason : null,
    copied: copied ? copied.reason : null,
    cluster,
  };
}

/** The reason to revoke an approved payout, or null to finalize it. Pure. */
export function revocationReason(input: RevocationInput): string | null {
  const r = watchReadings(input);
  const first = r.nearDup ?? r.copied ?? r.cluster;
  return first ? `revoked in the finalization window — ${first}` : null;
}

export const minutesLabel = (sec: number) => (sec % 3600 === 0 ? `${sec / 3600}h` : `${Math.round(sec / 60)}m`);
