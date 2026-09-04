import { statedAmounts } from "./stated-terms";
import type { GigDraft } from "./gig-draft";

/**
 * WHEN THE MODEL CONCLUDES CORRECTLY AND DOES NOT ACT.
 *
 * P-DIRECT, 2026-09-05, 75 rows: every remaining failure is one shape. The founder names a job and a
 * price, the model reasons its way to the right lane — sometimes saying so in the draft it writes —
 * and then emits prose instead of the tool call. Five rows, five languages and spec densities, one
 * cause. A corrective round with a narrowed tool set recovers most of them; `tool_choice: "required"`
 * cannot help, because MiniMax-M3 ignores it (probed directly).
 *
 * So when the conversational model will not act, the work is handed to the model that has only one
 * job: the gig drafter, which writes a brief and is structurally forbidden from writing money. The
 * amount then comes from the FOUNDER'S OWN WORDS, read deterministically — this path authors
 * nothing, and it refuses rather than guesses the moment their words are open to more than one
 * reading:
 *
 *   · exactly ONE amount stated, or there is no unambiguous price to transcribe;
 *   · exactly ONE deliverable in the draft, because mapping one amount onto several tranches is a
 *     decision about how to split money, and nothing here is allowed to make it;
 *   · recipients are the wallets the founder wrote, so "pay MY designer, her wallet is 0x…" stays a
 *     named allowlist instead of becoming an open bounty anyone can claim.
 *
 * Everything downstream is unchanged: the same tool, the same compiler, the same budget invariant,
 * the same lint, and a plan that still moves no money until the founder funds it.
 */

/** A wallet the founder wrote down. EVM or a Starknet felt — the compiler's own recipient shape. */
const WALLET_RE = /\b0x[0-9a-fA-F]{1,64}\b/g;

export interface FallbackArgs {
  kind: "gig";
  title: string;
  whyItMatters?: string;
  milestones: {
    title: string;
    instructions: string;
    criteria: string[];
    evidence: Record<string, unknown>;
    rewardUsd: number;
    slots: number;
    effortMinutes?: number;
  }[];
  recipients?: string[];
}

/**
 * The tool arguments for an unambiguous single-deliverable gig, or null when the founder's words do
 * not settle it. Pure: no I/O, no model, no arithmetic beyond reading their own number.
 */
export function unambiguousGigArgs(founderWords: string, draft: GigDraft): FallbackArgs | null {
  const amounts = statedAmounts(founderWords);
  if (amounts.length !== 1) return null;
  const rewardUsd = amounts[0]!;
  if (!(rewardUsd > 0)) return null;
  if (draft.milestones.length !== 1) return null;

  const m = draft.milestones[0]!;
  const slots = Number.isFinite(draft.slots) && draft.slots >= 1 ? Math.floor(draft.slots) : 1;
  // The compiler's own allowlist cap is 100; a founder who wrote more addresses than that into one
  // message is not the case this path is for.
  const recipients = [...new Set((founderWords.match(WALLET_RE) ?? []).map((w) => w.toLowerCase()))];
  if (recipients.length > 100) return null;

  return {
    kind: "gig",
    title: draft.title,
    ...(draft.whyItMatters ? { whyItMatters: draft.whyItMatters } : {}),
    milestones: [
      {
        title: m.title,
        instructions: m.instructions,
        criteria: m.criteria,
        evidence: m.evidence as unknown as Record<string, unknown>,
        rewardUsd,
        slots,
        ...(typeof m.effortMinutes === "number" ? { effortMinutes: m.effortMinutes } : {}),
      },
    ],
    ...(recipients.length > 0 ? { recipients } : {}),
  };
}
