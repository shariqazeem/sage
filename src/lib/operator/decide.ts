import "server-only";
import { llmCompleteJson } from "@/lib/llm/complete";
import type { CampaignObservation } from "./policy";
import { surfaceScale, usd, type OperatorPolicy } from "./policy";

/**
 * WHAT to buy next — the only part of the standing mandate a model touches.
 *
 * The mandate has already decided IF and HOW MUCH before this runs. This picks the position: which
 * surface the founder named, what kind of work, and the goal to hand the mission brain. Three
 * boundaries make a wrong answer harmless rather than expensive:
 *
 * - **The surface is a closed set.** A model may only choose among surfaces the founder declared or
 *   that Sage has already run work against. An invented URL would point a founder's money at a page
 *   nobody vouched for, so an unknown surface is refused, not sanitised.
 * - **No amount survives the boundary.** A proposal naming money is rejected outright and the
 *   deterministic choice is used instead. The budget compiler is the only thing that prices work.
 * - **There is always an answer without a model.** With no LLM configured, or a refused proposal,
 *   `chooseWithoutModel` decides from the observations alone. The loop degrades, it never stalls.
 *
 * Runs on the MISSION lane, so mission design and this decision share one provider and one budget.
 */

export type WorkKind = "testing" | "gig" | "grant";
const KINDS: WorkKind[] = ["testing", "gig", "grant"];

export interface Position {
  surface: string;
  kind: WorkKind;
  /** the intent handed to the mission brain, in the founder's own terms. */
  goal: string;
  /** why this position, now — recorded before any money moves. */
  reason: string;
  decidedBy: "llm" | "rules";
}

export interface DecisionInput {
  productUrl: string | null;
  founderGoal: string | null;
  /** surfaces the agent may choose among — the founder's own, plus anywhere it has already worked. */
  allowedSurfaces: string[];
  observations: CampaignObservation[];
  policy: OperatorPolicy;
  budgetBase: number;
}

const MONEY = /(\$\s?\d)|(\d+(\.\d+)?\s?(usdc|usd|dollars?))|(\busd\b\s?\d)/i;
const clean = (s: unknown, max: number): string | null => {
  if (typeof s !== "string") return null;
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length < 3 || t.length > max) return null;
  return MONEY.test(t) ? null : t;
};

/** How a surface has actually performed, in the words the model and the founder both read. */
export function surfaceReport(surfaces: string[], obs: CampaignObservation[], policy: OperatorPolicy): string {
  if (surfaces.length === 0) return "no surface has been worked yet.";
  return surfaces
    .map((s) => {
      const mine = obs.filter((o) => o.surface === s);
      if (mine.length === 0) return `- ${s}: never worked.`;
      const claimed = mine.reduce((n, o) => n + o.paid, 0);
      const offered = mine.reduce((n, o) => n + o.slots, 0);
      const quiet = mine.filter((o) => o.submissions === 0).length;
      // What was ALREADY BOUGHT here, and whether it worked. Without this line the model cannot
      // know a testing run already filled, and asks for another one.
      const history = mine
        .map((o) => `${o.kind}${o.slots > 0 ? ` ${o.paid}/${o.slots} claimed` : ""}${o.submissions === 0 ? " (nobody came)" : ""}`)
        .join("; ");
      const { why } = surfaceScale(s, obs, policy);
      return `- ${s}: ${mine.length} campaign(s) — ${history}. ${claimed}/${offered} slots claimed overall, ${quiet} went unclaimed. ${why}.`;
    })
    .join("\n");
}

const SYSTEM = `You choose the next piece of paid work an autonomous agent should buy for a founder.

You are given the founder's product and goal, the surfaces you may choose among, and how past work on each surface actually performed. Decide ONE position.

Rules you cannot break:
- Choose "surface" ONLY from the allowed list, copied exactly. Never invent a URL or host.
- "kind" is one of: testing (real people use the product and report what they saw), gig (a specific deliverable is produced and published), grant (a milestone a small business proves it reached).
- NEVER state, imply or compute any amount of money. The budget is decided elsewhere. A money figure makes your answer invalid.
- "goal" is one sentence of intent for the mission designer, in the founder's terms, describing what should be learned or produced. No prices, no slot counts.
- "reason" is one sentence saying why this position now, referring to what the past results show.

Prefer a surface with evidence that work gets claimed.

Move the work FORWARD rather than repeating it:
- A kind that already FILLED on a surface has been answered. Buying it again learns the same thing twice. Go to a harder or different kind of work there — a testing run that filled is followed by a deliverable, not another read.
- A kind that went UNCLAIMED on a surface is not worth repeating there either.
- Complement what is running right now instead of duplicating it.

Answer with JSON only: {"surface":"...","kind":"...","goal":"...","reason":"..."}`;

const SCHEMA = {
  name: "operator_position",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["surface", "kind", "goal", "reason"],
    properties: {
      surface: { type: "string" },
      kind: { type: "string", enum: KINDS },
      goal: { type: "string" },
      reason: { type: "string" },
    },
  },
} as const;

/**
 * The choice with no model in it: the founder's own surface first, then whatever has proven it gets
 * claimed, and a kind that has not already gone quiet there.
 */
export function chooseWithoutModel(input: DecisionInput): Position | null {
  const ranked = [...input.allowedSurfaces].sort((a, b) => surfaceScale(b, input.observations, input.policy).scale - surfaceScale(a, input.observations, input.policy).scale);
  const surface = ranked.find((s) => surfaceScale(s, input.observations, input.policy).scale > 0);
  if (!surface) return null;
  const here = input.observations.filter((o) => o.surface === surface);
  const testedWell = here.some((o) => o.slots > 0 && o.paid / o.slots >= 0.6);
  const kind: WorkKind = here.length === 0 ? "testing" : testedWell ? "gig" : "testing";
  const goal =
    kind === "testing"
      ? `Have real people use ${surface} and report exactly what they saw${input.founderGoal ? `, focused on: ${input.founderGoal}` : ""}.`
      : `Have people produce and publish a deliverable about ${surface}${input.founderGoal ? `, focused on: ${input.founderGoal}` : ""}.`;
  const reason = here.length === 0
    ? `nothing has been run against ${surface} yet — start with a probe`
    : testedWell
      ? `work on ${surface} has been getting claimed, so the next step is a deliverable rather than another read`
      : `${surface} is the founder's own product and the only surface with any history`;
  return { surface, kind, goal: goal.slice(0, 300), reason, decidedBy: "rules" };
}

/** Choose the next position. Falls back to the deterministic choice on any model failure. */
export async function choosePosition(input: DecisionInput): Promise<Position | null> {
  const fallback = chooseWithoutModel(input);
  if (input.allowedSurfaces.length === 0) return null;
  const user = [
    `Founder product: ${input.productUrl ?? "not stated"}`,
    `Founder goal: ${input.founderGoal ?? "not stated"}`,
    ``,
    `Surfaces you may choose among (copy one exactly):`,
    ...input.allowedSurfaces.map((s) => `- ${s}`),
    ``,
    `How past work performed:`,
    surfaceReport(input.allowedSurfaces, input.observations, input.policy),
    ``,
    `Currently running: ${input.observations.filter((o) => o.status === "live").map((o) => `${o.surface} (${o.paid}/${o.slots} claimed)`).join(", ") || "nothing"}`,
  ].join("\n");
  try {
    const r = await llmCompleteJson({ system: SYSTEM, user, lane: "MISSION", maxTokens: 400, temperature: 0.3, responseSchema: SCHEMA });
    const raw = r.json as Record<string, unknown> | null;
    if (!raw) return fallback;
    const surface = typeof raw.surface === "string" ? raw.surface.trim() : "";
    const kind = typeof raw.kind === "string" ? (raw.kind.trim().toLowerCase() as WorkKind) : ("" as WorkKind);
    const goal = clean(raw.goal, 300);
    const reason = clean(raw.reason, 240);
    // a surface outside the founder's own set is refused, never repaired
    if (!input.allowedSurfaces.includes(surface) || !KINDS.includes(kind) || !goal || !reason) return fallback;
    if (surfaceScale(surface, input.observations, input.policy).scale === 0) return fallback;
    return { surface, kind, goal, reason, decidedBy: "llm" };
  } catch {
    return fallback;
  }
}

/** The sentence a founder reads on the proposal, before the money moves. */
export function proposalLine(p: Position, budgetBase: number): string {
  const what = p.kind === "testing" ? "testing run" : p.kind === "gig" ? "gig" : "milestone grant";
  return `${usd(budgetBase)} ${what} on ${p.surface} — ${p.reason}`;
}
