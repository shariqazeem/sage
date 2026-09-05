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
 *   · the slot count is the founder's, never the draft's. P-DIRECT 3 (2026-09-05): "Pay $25 for
 *     this: a comparison page…" became a $75 plan, because the drafter — told to guess 3 for "anyone"
 *     — chose the slots and reward × slots is money. One price with no per-person marker is the
 *     whole job: one slot. A per-person price ("$4 each") needs a count the founder stated ("the
 *     first 5 people"), or there is nothing unambiguous to transcribe;
 *   · recipients are the wallets the founder wrote, so "pay MY designer, her wallet is 0x…" stays a
 *     named allowlist instead of becoming an open bounty anyone can claim.
 *
 * Everything downstream is unchanged: the same tool, the same compiler, the same budget invariant,
 * the same lint, and a plan that still moves no money until the founder funds it.
 */

/** A wallet the founder wrote down. EVM or a Starknet felt — the compiler's own recipient shape. */
const WALLET_RE = /\b0x[0-9a-fA-F]{1,64}\b/g;

/** "$4 each", "per person", "a cada uno", "chacun" — the price is per head, not for the job. */
const PER_UNIT_RE =
  /\b(?:each|apiece|per\s+(?:person|head|tester|worker|writer|seller|user|participant|submission|entry|page|post|review|video|walkthrough|article)|(?:a\s+)?cada\s+(?:uno|una|persona)|por\s+(?:persona|cabeza|pessoa)|chacune?|par\s+personne|pro\s+(?:person|kopf))\b/i;

const COUNT_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, dix: 10,
};
const NUM = `(\\d{1,3}|${Object.keys(COUNT_WORDS).join("|")})`;
const PEOPLE =
  "(?:people|persons?|folks|testers?|workers?|writers?|sellers?|users?|participants?|developers?|devs|designers?|translators?|reviewers?|creators?|students?|volunteers?|entries|submissions|personas?|vendedor(?:es|as)?|personnes?|leute|personen)";
/** "the first 5 people", "up to 3", "three testers", "5 personas" — a headcount the founder said. */
const HEADCOUNT_RE = new RegExp(
  `\\b(?:(?:the\\s+)?first|up\\s+to|at\\s+most|max(?:imum)?(?:\\s+of)?|no\\s+more\\s+than|los\\s+primer[oa]s|las\\s+primeras|hasta|die\\s+ersten|bis\\s+zu)\\s+${NUM}\\b|\\b${NUM}\\s+${PEOPLE}\\b`,
  "gi",
);

/** The one headcount the founder stated, or null when they stated none — or more than one. */
export function statedHeadcount(text: string): number | null {
  const counts = new Set<number>();
  for (const m of text.matchAll(HEADCOUNT_RE)) {
    const raw = (m[1] ?? m[2] ?? "").toLowerCase();
    const n = /^\d+$/.test(raw) ? Number(raw) : COUNT_WORDS[raw];
    if (Number.isFinite(n) && n >= 1) counts.add(n);
  }
  return counts.size === 1 ? [...counts][0]! : null;
}

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
  // Reward × slots is the money. One price with no per-person marker is the whole job; a per-person
  // price takes the count the founder stated and nothing else — the draft's guess is never money.
  const perUnit = PER_UNIT_RE.test(founderWords);
  const headcount = perUnit ? statedHeadcount(founderWords) : null;
  if (perUnit && headcount === null) return null;
  const slots = perUnit ? (headcount as number) : 1;
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
