import { DEFAULT_EVM_LAUNCH_CHAIN } from "@/lib/deputy/networks";
import { missionTitleFrom } from "@/lib/launch/mission-title";

/**
 * THE PAY-FOR-WORK COMPOSER, AS DATA (28 Oct 2026). The composer's lines used to become the
 * direct-campaign body inside the component, where nothing but a click could exercise it. It lives here
 * now so the ready jobs (ready-jobs.ts) are tested through the exact body the composer sends, into the
 * same schema and compiler the server runs. Moved, not changed: the money rules below are the composer's.
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
  const title = `Pay ${who}`.slice(0, 80);
  const milestones = tranches.map((t, i) => {
    const d = t.deliverable.trim().replace(/\.+$/, "");
    const cap = d.charAt(0).toUpperCase() + d.slice(1);
    const evidence =
      t.verify === "page"
        ? { kind: "public_url", expectedText: [t.expectedText.trim()] }
        : t.verify === "onchain"
          ? { kind: "onchain_tx", chainId: t.txChain ?? DEFAULT_EVM_LAUNCH_CHAIN, to: t.toAddr.trim() }
          : { kind: "artifact_url", allowedHosts: [], markerKind: "wallet" };
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
    const drafted = (t.criteria ?? []).map((c) => c.trim()).filter((c) => c.length >= 4);
    const autoCriterion =
      t.verify === "link"
        ? MARKER_CRITERION
        : t.verify === "page"
          ? `The page contains: "${t.expectedText.trim()}"`
          : "The transaction was sent by the submitting wallet";
    const criteria = drafted.length > 0 ? [...drafted.slice(0, 7), ...(drafted.includes(autoCriterion) ? [] : [autoCriterion])] : [cap, autoCriterion];
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
