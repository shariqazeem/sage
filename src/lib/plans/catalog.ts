/**
 * SAGE'S PLANS (19 Oct 2026: Sage is paid). The pricing page, Settings, the billing API and every
 * launch door read this one file, so what a plan promises and what the server enforces can never be
 * two lists that drift.
 *
 * Rules that shape it:
 * - FREE MUST DELIVER A FIRST REAL PAYOUT. A person who has seen Sage pay someone is the only person
 *   who buys, so Free can post real work and pay real people: one live job at a time.
 * - WORKERS ARE ALWAYS FREE. Nothing here ever gates finding work, being paid or owning a record.
 * - EVERY LINE IS ENFORCED OR REAL. A highlight below names something the product does today; the
 *   numbers are checked on the server at every launch door (`limits.ts`), never by the UI alone.
 * - LIMITS GATE LAUNCHES, NEVER PAYOUTS. A job that is live keeps paying its workers whatever happens
 *   to the plan: stranding someone who already did the work is the one thing a plan must never do.
 */
export type PlanId = "free" | "pro" | "team" | "programs";

export const PLAN_ORDER: readonly PlanId[] = ["free", "pro", "team", "programs"];

/** Capabilities a plan unlocks beyond its numbers. */
export type Feature =
  /** work only invited people can see and claim (workspace invite links) */
  | "membersOnly"
  /** the standing mandate: Sage decides what work to buy, inside the founder's ceilings */
  | "autopilot"
  /** CSV export of every payout and refusal, with receipts */
  | "exports"
  /** admins beside the owner */
  | "roles"
  /** a per-job fraud report: linked wallets and refused work, with the reasons */
  | "fraudReports";

export interface PlanSpec {
  id: PlanId;
  name: string;
  /** Monthly price in USD, paid in USDC. Null: priced per programme ("talk to us"). */
  priceUsd: number | null;
  /** One line under the name. */
  blurb: string;
  /** Jobs live at the same time. */
  liveJobs: number;
  /** Total budget launched in any 30 days, in USD. */
  monthlyUsd: number;
  /** AI agents the owner can connect at once (live keys), enforced where keys are minted. */
  agentKeys: number;
  features: readonly Feature[];
  /** The pricing table's lines, in order. Only things that exist. */
  highlights: readonly string[];
}

const UNLIMITED = Number.POSITIVE_INFINITY;

export const PLANS: Record<PlanId, PlanSpec> = {
  free: {
    id: "free",
    name: "Free",
    priceUsd: 0,
    blurb: "Try Sage on real work, with real money. No card, no trial clock.",
    liveJobs: 1,
    monthlyUsd: 50,
    agentKeys: 1,
    features: [],
    highlights: [
      "One live job at a time, up to $50 of work a month",
      "Sage's AI agent on every job: it writes the tasks, checks each submission and pays the real ones",
      "Product testing, gigs and milestone grants",
      "Farm and fraud checks on every submission",
      "A public receipt for every payout, and a reason for every refusal",
      "Talk to Sage on the web or in Telegram",
      "Connect your own AI agent (Claude, Cursor or your code) with a key you can revoke",
    ],
  },
  pro: {
    id: "pro",
    name: "Pro",
    priceUsd: 29,
    blurb: "For founders and small teams who pay people every week.",
    liveJobs: UNLIMITED,
    monthlyUsd: 5_000,
    agentKeys: 5,
    features: ["membersOnly", "autopilot", "exports"],
    highlights: [
      "Everything in Free",
      "Unlimited live jobs, up to $5,000 of work a month",
      "Autopilot: fund once, and Sage's agent decides what work to buy next, inside limits you set",
      "Private work for your own people, by invite link",
      "Every payout exported for your books (CSV)",
      "Up to 5 AI agents connected, each with its own permissions",
    ],
  },
  team: {
    id: "team",
    name: "Team",
    priceUsd: 149,
    blurb: "For programmes and DAOs that pay many contributors.",
    liveJobs: UNLIMITED,
    monthlyUsd: 50_000,
    agentKeys: 25,
    features: ["membersOnly", "autopilot", "exports", "roles", "fraudReports"],
    highlights: [
      "Everything in Pro",
      "Up to $50,000 of work a month",
      "Admins who run jobs beside you",
      "A fraud report for every job: linked wallets and refused work, with the reasons",
      "Up to 25 AI agents connected",
    ],
  },
  programs: {
    id: "programs",
    name: "Programs",
    priceUsd: null,
    blurb: "For ecosystems, grant-makers and lenders.",
    liveJobs: UNLIMITED,
    monthlyUsd: UNLIMITED,
    agentKeys: 100,
    features: ["membersOnly", "autopilot", "exports", "roles", "fraudReports"],
    highlights: [
      "Everything in Team, with no monthly ceiling",
      "Set up with you, to your programme's rules",
      "Credit records your lenders can read",
      "A named contact and a response time",
    ],
  },
};

/** What a worker gets, on every plan, always. */
export const WORKER_TERMS: readonly string[] = [
  "Find paid work and claim it",
  "Get paid in USDC to your own wallet",
  "Own your record of verified work",
];

export const PERIOD_DAYS = 30;
export const PERIOD_SECONDS = PERIOD_DAYS * 24 * 3600;

/** Plans someone can buy themselves (Programs is arranged with us). */
export const SELF_SERVE: readonly PlanId[] = ["pro", "team"];

export function isPlanId(v: unknown): v is PlanId {
  return typeof v === "string" && (PLAN_ORDER as readonly string[]).includes(v);
}

/** The plan a workspace is on NOW. A paid plan that has lapsed is Free again, never an error. */
export function planInForce(ws: { plan: string; planUntil: number | null }, nowSec = Math.floor(Date.now() / 1000)): PlanId {
  if (!isPlanId(ws.plan) || ws.plan === "free") return "free";
  return (ws.planUntil ?? 0) > nowSec ? ws.plan : "free";
}

export function hasFeature(plan: PlanId, feature: Feature): boolean {
  return PLANS[plan].features.includes(feature);
}

/** The cheapest plan that has a feature: what to offer when a door is closed. */
export function cheapestWith(feature: Feature): PlanId {
  return PLAN_ORDER.find((p) => hasFeature(p, feature)) ?? "programs";
}

/** "$5,000" / "No ceiling". */
export function monthlyLabel(plan: PlanId): string {
  const n = PLANS[plan].monthlyUsd;
  return Number.isFinite(n) ? `$${n.toLocaleString("en-US")}` : "No ceiling";
}
