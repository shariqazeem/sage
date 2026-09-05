import "server-only";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaigns, decisions, missions, submissions } from "@/lib/db/schema";
import { chainConfig } from "@/lib/deputy/networks";
import { latestLaunch } from "@/lib/db/operator";
import { chooseWithoutModel } from "@/lib/operator/decide";
import { rehearse } from "@/lib/operator/rehearsal";

/**
 * THE SHOWCASE — a real mission and the real verdict that paid it, for the landing's
 * "how it works" chapters. The page used to illustrate the mechanism with a drawn browser;
 * the mechanism has run hundreds of times on mainnet, so it shows one real run instead.
 *
 * Chosen deterministically: the most recent PAID, receipt-anchored submission on a mainnet
 * campaign whose decision carries at least one verbatim quote (the quote is what makes the
 * verdict legible — "met, 0.95, because the page says …"). Only public material: the mission
 * text (public on its board), the campaign's target host, and the decision's criteria with
 * their quotes (already public on /proof/<tx>). Never a wallet, never a submitter's note.
 * Nothing is shown when nothing real exists — the caller falls back to its illustration.
 */
export interface ShowcaseCriterion {
  criterion: string;
  met: boolean;
  confidence: number;
  quote: string | null;
}

export interface Showcase {
  campaignTitle: string;
  targetHost: string;
  railLabel: string;
  mission: {
    title: string;
    criteria: string[];
    rewardBase: number;
    verifiabilityClass: string;
  };
  decision: {
    recommendation: string;
    confidence: number;
    criteria: ShowcaseCriterion[];
  };
  txHash: string;
}

const hostOf = (u: string): string => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
};

/**
 * THE MOVE — chapter four, "then it decides what to buy next". A real recorded move when the
 * operator has made one (any founder; the row carries its reason, price and state), else the
 * rehearsal for the showcase campaign's founder, sized by the policy and chosen by rules — no
 * model, nothing recorded, and labelled as such. Before this, chapter four re-showed chapter
 * three's verdict, so the flagship claim had no artifact behind it. Never a wallet.
 */
export interface ShowcaseMove {
  source: "real" | "rehearsal";
  surface: string;
  kind: "testing" | "gig" | "grant";
  budgetUsd: number;
  goal: string;
  reason: string;
  decidedBy: "llm" | "rules";
  state: string | null;
  /** the treasury the rehearsal imagined; null for a real move */
  assumesFundingUsd: number | null;
}

export async function loadShowcaseMove(): Promise<ShowcaseMove | null> {
  const real = latestLaunch();
  if (real && real.surface) {
    return {
      source: "real",
      surface: real.surface,
      kind: real.kind,
      budgetUsd: real.budgetBase / 1_000_000,
      goal: real.goal,
      reason: real.reason,
      decidedBy: real.decidedBy,
      state: real.state,
      assumesFundingUsd: null,
    };
  }
  const founder = pickShowcase()?.founder ?? null;
  if (!founder) return null;
  const r = await rehearse(founder, { choose: async (i) => chooseWithoutModel(i) });
  if (!r || r.because || !r.surface) return null;
  return {
    source: "rehearsal",
    surface: r.surface,
    kind: r.kind,
    budgetUsd: r.budgetBase / 1_000_000,
    goal: r.goal,
    reason: r.reason,
    decidedBy: "rules",
    state: null,
    assumesFundingUsd: r.assumesFundingBase / 1_000_000,
  };
}

export function loadShowcase(): Showcase | null {
  return pickShowcase()?.showcase ?? null;
}

/** The showcase and, kept server-side, the wallet that funded it. */
function pickShowcase(): { showcase: Showcase; founder: string } | null {
  const mainnet = db
    .select({ id: campaigns.id, title: campaigns.title, chainId: campaigns.chainId, posterWallet: campaigns.posterWallet })
    .from(campaigns)
    .where(eq(campaigns.sandbox, false))
    .all()
    .filter((c) => chainConfig(c.chainId).isMainnet);
  if (mainnet.length === 0) return null;
  const byId = new Map(mainnet.map((c) => [c.id, c]));

  const paid = db
    .select({
      id: submissions.id,
      campaignId: submissions.campaignId,
      missionIdHash: submissions.missionIdHash,
      payoutTx: submissions.payoutTx,
      decidedAt: submissions.decidedAt,
    })
    .from(submissions)
    .where(
      and(
        eq(submissions.status, "paid"),
        isNotNull(submissions.payoutTx),
        isNotNull(submissions.missionIdHash),
        inArray(submissions.campaignId, [...byId.keys()]),
      ),
    )
    .orderBy(desc(submissions.decidedAt))
    .limit(40)
    .all();

  for (const s of paid) {
    const d = db.select().from(decisions).where(eq(decisions.submissionId, s.id)).get();
    const crits = d?.brief?.criteria ?? [];
    if (!d || crits.length === 0 || !crits.some((c) => typeof c.quote === "string" && c.quote.trim().length > 0)) continue;
    const m = db
      .select()
      .from(missions)
      .where(and(eq(missions.campaignId, s.campaignId), eq(missions.missionIdHash, s.missionIdHash as string)))
      .get();
    if (!m) continue;
    const c = byId.get(s.campaignId)!;
    return { founder: c.posterWallet, showcase: {
      campaignTitle: c.title,
      targetHost: hostOf(m.targetSurface),
      railLabel: chainConfig(c.chainId).chipLabel,
      mission: {
        title: m.title,
        criteria: (m.criteria ?? []).slice(0, 4),
        rewardBase: m.rewardAmount,
        verifiabilityClass: m.verifiabilityClass,
      },
      decision: {
        recommendation: d.brief.recommendation,
        confidence: d.brief.confidence,
        criteria: crits.slice(0, 4).map((x) => ({
          criterion: x.criterion,
          met: x.met,
          confidence: x.confidence,
          quote: typeof x.quote === "string" && x.quote.trim() ? x.quote : null,
        })),
      },
      txHash: s.payoutTx as string,
    } };
  }
  return null;
}
