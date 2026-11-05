import { DEFAULT_EVM_LAUNCH_CHAIN } from "@/lib/deputy/networks";
import { verifiableChainList } from "@/lib/verify/chains";
import { missionTitleFrom } from "@/lib/launch/mission-title";
import { prefillSlots } from "@/lib/launch/direct-fallback";
import { prefillMoneyFromWords } from "@/lib/launch/prefill-money";

/**
 * THE PAY-FOR-WORK COMPOSER, AS DATA (28 Oct 2026). The composer's lines used to become the
 * direct-campaign body inside the component, where nothing but a click could exercise it. It lives here
 * now so a job Sage drafted is tested through the exact body the composer sends, into the same schema
 * and compiler the server runs. Moved, not changed: the money rules below are the composer's.
 */

/** One payment line the founder composes — a tranche of a grant, or the whole of a gig. */
export type Tranche = {
  amount: string;
  deliverable: string;
  verify: string;
  expectedText: string;
  toAddr: string;
  /** The network the worker's transaction is on (a contract deployed on Metis is checked on Metis). */
  txChain?: number;
  title?: string;
  /** Drafted by Sage from the founder's sentence (the gig brain) — the steps, the acceptance
   *  criteria with an effort bar, the word floor. Absent when the founder composed by hand. */
  instructions?: string;
  criteria?: string[];
  minWords?: number;
  effortMinutes?: number;
  /**
   * What Sage drafted that the founder never has to type (5 Nov 2026). The composer used to drop all of it,
   * so "deploy a contract" work could not be posted at all: the deploy flag was lost and a target address
   * was demanded for a contract that does not exist yet. Required phrases and allowed hosts were lost
   * along with it.
   */
  deploysContract?: boolean;
  allowedHosts?: string[];
  mustContain?: string[];
  /** expected texts after the first, for a page check that must show several things. */
  extraExpected?: string[];
  /** platform proofs Sage drafted (verify/contract.ts): checked on the work's own platform before it pays. */
  repo?: string;
  prMerged?: boolean;
  minRows?: number;
  minDurationSeconds?: number;
  postedAfterStart?: boolean;
};

export const blankTranche = (verify = "link"): Tranche => ({ amount: "", deliverable: "", verify, expectedText: "", toAddr: "", title: "" });

export const MARKER_CRITERION = "The page carries the submitting wallet address";

/** Everything the composer holds when the founder presses the button. */
export interface ComposerState {
  who: string;
  slots: string;
  tranches: Tranche[];
  /** "" = each tranche priced by the founder; a number = ONE stated total, split exactly by Sage. */
  splitTotal: string;
  currency: string;
  inviteOnly: boolean;
  /** the drafted "why it matters", when Sage drafted the brief */
  why: string;
  /** the job's own name, when Sage drafted it ("Fix the crash on PDF uploads"); else "Pay <who>" */
  title?: string;
}

/**
 * THE SENTENCES COMPILE DIRECTLY — no chat, no model. The rows the founder composed become the
 * exact `DirectCampaignInput` the deterministic compiler takes; multi-tranche is a grant, one
 * line is a gig, and a stated total rides `splitTotalUsd` so Sage does the division in base
 * units. Errors come back as the compiler's own words, under the form.
 */
export function composeDirectBody(s: ComposerState) {
  const { tranches, splitTotal, currency } = s;
  const splitting = tranches.length > 1 && splitTotal.trim() !== "";
  const isLocal = currency !== "USD";
  const isGrant = tranches.length > 1;
  const who = s.who.trim();
  const slots = isGrant ? 1 : Math.max(1, Math.min(50, Math.round(Number(s.slots) || 1)));
  const named = (s.title ?? "").trim();
  const title = (named.length >= 4 ? named : `Pay ${who}`).slice(0, 80);
  const milestones = tranches.map((t, i) => {
    const d = t.deliverable.trim().replace(/\.+$/, "");
    const cap = d.charAt(0).toUpperCase() + d.slice(1);
    const to = t.toAddr.trim();
    const evidence =
      t.verify === "page"
        ? { kind: "public_url", expectedText: [t.expectedText.trim(), ...(t.extraExpected ?? []).map((x) => x.trim())].filter((x, k, all) => x.length >= 3 && all.indexOf(x) === k).slice(0, 5) }
        : t.verify === "onchain"
          ? {
              kind: "onchain_tx",
              chainId: t.txChain ?? DEFAULT_EVM_LAUNCH_CHAIN,
              // a deployment names no address (the contract doesn't exist yet); a named one still binds it
              ...(/^0x[0-9a-fA-F]{40}$/.test(to) ? { to } : {}),
              ...(t.deploysContract ? { deploysContract: true } : {}),
            }
          : {
              kind: "artifact_url",
              allowedHosts: (t.allowedHosts ?? []).slice(0, 5),
              markerKind: "wallet",
              ...(t.mustContain && t.mustContain.length > 0 ? { mustContain: t.mustContain.slice(0, 5) } : {}),
              ...(t.repo ? { repo: t.repo } : {}),
              ...(t.prMerged ? { prMerged: true } : {}),
              ...(t.minRows ? { minRows: t.minRows } : {}),
              ...(t.minDurationSeconds ? { minDurationSeconds: t.minDurationSeconds } : {}),
              ...(t.postedAfterStart ? { postedAfterStart: true } : {}),
            };
    const proofLine =
      t.verify === "page"
        ? "Submit the public page showing the required text."
        : t.verify === "onchain"
          ? "Submit the transaction hash, sent from your own submitting wallet."
          : "Submit the public link to what you made — it must visibly carry your own wallet address.";
    // The founder's sentence is the CRITERION; the card title is its first clause (or the title they
    // typed). "You are paid when …" only read for a state sentence ("the page is live") and broke
    // for an instruction ("Read …, then write …") — "What must be true:" reads for both.
    const typedTitle = (t.title ?? "").trim();
    // Drafted criteria are the founder-approved brief; the automatic check is appended so the
    // judge's rubric and the deterministic gate never disagree about the marker.
    const drafted = [...new Map((t.criteria ?? []).map((c) => c.trim()).filter((c) => c.length >= 4).map((c) => [c.replace(/\s+/g, " ").toLowerCase(), c] as const)).values()];
    const autoCriterion =
      t.verify === "link"
        ? MARKER_CRITERION
        : t.verify === "page"
          ? `The page contains: "${t.expectedText.trim()}"`
          : t.deploysContract && !/^0x[0-9a-fA-F]{40}$/.test(to)
            ? "The submitting wallet deployed the contract"
            : "The transaction was sent by the submitting wallet";
    const sameAs = (a: string, b: string) => a.replace(/\s+/g, " ").trim().toLowerCase() === b.replace(/\s+/g, " ").trim().toLowerCase();
    const criteria = drafted.length > 0 ? [...drafted.slice(0, 7), ...(drafted.some((c) => sameAs(c, autoCriterion)) ? [] : [autoCriterion])] : [cap, autoCriterion];
    const draftedSteps = (t.instructions ?? "").trim();
    return {
      title: (typedTitle.length >= 4 ? typedTitle : missionTitleFrom(d, i)).slice(0, 80),
      instructions: draftedSteps.length >= 10 ? draftedSteps.slice(0, 2000) : `What must be true: ${cap}. ${proofLine}`,
      ...(splitting ? {} : isLocal ? { rewardLocal: Number(t.amount) } : {}),
      criteria,
      evidence: t.verify === "link" && t.minWords ? { ...evidence, minWords: t.minWords } : evidence,
      slots,
      ...(t.effortMinutes ? { effortMinutes: t.effortMinutes } : {}),
      ...(splitting || isLocal ? {} : { rewardUsd: Number(t.amount) }),
    };
  });
  return {
    kind: isGrant ? "grant" : "gig",
    title: title.length >= 4 ? title : "Pay for work",
    milestones,
    ...(s.why.trim().length >= 10 ? { whyItMatters: s.why.trim().slice(0, 600) } : {}),
    ...(isLocal ? { currency } : {}),
    ...(splitting
      ? isLocal
        ? { splitTotalLocal: Number(splitTotal) }
        : { splitTotalUsd: Number(splitTotal) }
      : {}),
    ...(s.inviteOnly ? { visibility: "unlisted" as const } : {}),
  };
}

/** The total the composer shows and the button names: what the vault will hold, in the founder's units. */
export function composerTotal(s: Pick<ComposerState, "tranches" | "slots" | "splitTotal">): number {
  const splitting = s.tranches.length > 1 && s.splitTotal.trim() !== "";
  if (splitting) return Number(s.splitTotal || 0);
  return s.tranches.reduce((a, t) => a + (Number(t.amount) || 0), 0) * (s.tranches.length === 1 ? Number(s.slots) || 1 : 1);
}

/**
 * The chains a drafted on-chain check may name: Sage's own network, then every chain a proof can be READ
 * on (verify/chains.ts). Sage pays on Metis; the work may happen on Base, Arbitrum, Ethereum or a testnet.
 */
export const TX_CHAINS: readonly number[] = verifiableChainList().map((c) => c.chainId);

/**
 * THE FOUNDER'S HEADCOUNT IS NEVER ROUNDED. "8 people" once snapped to the nearest preset (10) and the
 * bounty silently grew by a quarter — the same invented-number defect the direct door's stated-terms
 * check refuses. The number in the sentence wins; the model's guess is clamped, never snapped.
 */
export const clampSlots = (n: number): string => String(Math.min(50, Math.max(1, Math.round(Number.isFinite(n) ? n : 1))));

/** A drafted milestone, as the draft route returns it. */
export type DraftMilestone = {
  title: string;
  deliverable: string;
  instructions: string;
  criteria: string[];
  evidence:
    | { kind: "artifact_url"; allowedHosts: string[]; minWords?: number; mustContain?: string[]; repo?: string; prMerged?: boolean; minRows?: number; minDurationSeconds?: number; postedAfterStart?: boolean }
    | { kind: "public_url"; expectedText: string[] }
    | { kind: "onchain_tx"; chainId?: number; to?: string; deploysContract?: boolean };
  effortMinutes?: number;
};
export type Draft = { kind: "grant" | "gig"; title: string; who: string; slots: number; whyItMatters?: string; milestones: DraftMilestone[] };

export interface ComposedFromDraft {
  pay: { who: string; slots: string };
  currency: string;
  splitTotal: string;
  tranches: Tranche[];
  why: string;
  title: string;
  inviteOnly: boolean;
}

/**
 * A DRAFT BECOMES THE CARD, ONE WAY ONLY (moved out of the launch form, 5 Nov 2026, so the bench measures
 * the card a founder actually sees). The founder's words are the money: currency, the total to split, or
 * the price per person, read from their sentence deterministically, never from the model or the page.
 */
export function composerFromDraft(d: Draft, words: string): ComposedFromDraft {
  const money = prefillMoneyFromWords(words, d.milestones.length);
  return {
    pay: { who: d.who, slots: clampSlots(prefillSlots(words, d.milestones.length)) },
    currency: money.currency ?? "USD",
    splitTotal: money.splitTotal != null ? String(money.splitTotal) : "",
    tranches: d.milestones.map((m, i) => ({
      amount: i === 0 && money.perUnit != null ? String(money.perUnit) : "",
      title: m.title,
      deliverable: m.deliverable,
      verify: m.evidence.kind === "public_url" ? "page" : m.evidence.kind === "onchain_tx" ? "onchain" : "link",
      expectedText: m.evidence.kind === "public_url" ? (m.evidence.expectedText[0] ?? "") : "",
      toAddr: m.evidence.kind === "onchain_tx" ? (m.evidence.to ?? "") : "",
      ...(m.evidence.kind === "onchain_tx" && m.evidence.chainId && TX_CHAINS.includes(m.evidence.chainId) ? { txChain: m.evidence.chainId } : {}),
      instructions: m.instructions,
      criteria: m.criteria,
      ...(m.evidence.kind === "artifact_url" && m.evidence.minWords ? { minWords: m.evidence.minWords } : {}),
      ...(m.effortMinutes ? { effortMinutes: m.effortMinutes } : {}),
      // everything else Sage drafted rides along, so the founder never re-types it (or can't)
      ...(m.evidence.kind === "onchain_tx" && m.evidence.deploysContract ? { deploysContract: true } : {}),
      ...(m.evidence.kind === "artifact_url" && m.evidence.allowedHosts.length > 0 ? { allowedHosts: m.evidence.allowedHosts } : {}),
      ...(m.evidence.kind === "artifact_url" && m.evidence.mustContain?.length ? { mustContain: m.evidence.mustContain } : {}),
      ...(m.evidence.kind === "public_url" && m.evidence.expectedText.length > 1 ? { extraExpected: m.evidence.expectedText.slice(1) } : {}),
      ...(m.evidence.kind === "artifact_url" && m.evidence.repo ? { repo: m.evidence.repo } : {}),
      ...(m.evidence.kind === "artifact_url" && m.evidence.prMerged ? { prMerged: true } : {}),
      ...(m.evidence.kind === "artifact_url" && m.evidence.minRows ? { minRows: m.evidence.minRows } : {}),
      ...(m.evidence.kind === "artifact_url" && m.evidence.minDurationSeconds ? { minDurationSeconds: m.evidence.minDurationSeconds } : {}),
      ...(m.evidence.kind === "artifact_url" && m.evidence.postedAfterStart ? { postedAfterStart: true } : {}),
    })),
    why: d.whyItMatters ?? "",
    title: d.title,
    // work for someone the founder names ("my designer", "our translator") is theirs to invite
    inviteOnly: /^(my|our)\b/i.test(d.who.trim()),
  };
}
