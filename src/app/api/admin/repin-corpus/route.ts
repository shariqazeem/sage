import { NextResponse, after, type NextRequest } from "next/server";

import { getCampaign, listMissions, setCampaignCorpus } from "@/lib/db/campaigns";
import { inspectProduct, rankPrimaryLinks } from "@/lib/launch/inspect";
import { fieldTestEnabled, runFieldTest, explorationCounts } from "@/lib/launch/field-test";
import { describeStatesWithVision } from "@/lib/launch/vision";
import { distillPrivateKey } from "@/lib/deputy/observation-verify";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * P21 operator backstop — RE-PIN a live observation campaign's private corpus with the CURRENT
 * (deep-exploration) field test. The two self-test campaigns (yara, excalidraw) were pinned before
 * P21, so their keys are thin/generic; re-running the deeper explorer and re-distilling replaces them
 * with a richer key so genuine testers clear the ≥3-distinct bar. Judge-only data: this never touches
 * money, the vault, the on-chain identity, or the mission plan — only `private_corpus*`.
 *
 * Gated on SAGE_ADMIN_SECRET (header x-sage-admin-secret); fail-closed (404) when unset, exactly like
 * the held-review backstop. The field test can take minutes, so the work runs in `after()` and this
 * returns 202 immediately with the BEFORE counts — poll the campaign's corpus digest for completion.
 */
function authorized(req: NextRequest): boolean {
  const secret = process.env.SAGE_ADMIN_SECRET?.trim();
  if (!secret) return false;
  const header = req.headers.get("x-sage-admin-secret")?.trim();
  return !!header && header === secret;
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!fieldTestEnabled()) {
    return NextResponse.json({ error: "FIELD_TEST_ENABLED is off — the browser explorer is required to re-pin." }, { status: 409 });
  }

  let body: { campaignId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const campaign = getCampaign(body.campaignId ?? "");
  if (!campaign) return NextResponse.json({ error: "campaign not found" }, { status: 404 });
  if (campaign.vaultKind !== "campaign_v2") {
    return NextResponse.json({ error: "re-pin applies to V2 (mission) campaigns only" }, { status: 409 });
  }

  const campaignId = campaign.id;
  const missions = listMissions(campaignId);
  // The product URL is the mission surface Sage designed against — the most common non-empty targetSurface.
  const productUrl = mostCommon(missions.map((m) => m.targetSurface).filter((s): s is string => !!s));
  if (!productUrl) {
    return NextResponse.json({ error: "no mission target surface to re-explore" }, { status: 409 });
  }

  const before = { sources: campaign.privateCorpusSources, digest: campaign.privateCorpusDigest };

  // The public strings to EXCLUDE — every string a tester could read off a mission card (identical set to
  // the attach-time distill), so the re-pinned key preserves the structural parrot-zero guarantee.
  const publicStrings = missions.flatMap((m) => [
    m.title,
    m.objective,
    m.instructions,
    m.targetSurface,
    ...(m.criteria ?? []),
    ...(m.evidenceRequirements ? [m.evidenceRequirements] : []),
    ...(m.evidenceList ?? []),
  ]);

  const inspectionId = `repin-${campaignId}-${Date.now()}`;
  after(async () => {
    try {
      console.log(`[repin] ${campaignId}: re-exploring ${productUrl} (before: ${before.sources} sources)`);
      const inspection = await inspectProduct(productUrl, {}, 0);
      const fieldTest = await runFieldTest({
        inspectionId,
        startUrl: inspection.startUrl,
        host: inspection.host,
        candidateLinks: rankPrimaryLinks(inspection.observations, inspection.host, inspection.startUrl, 5),
      });
      // LOOK at the richest states with vision (same cost-guard as the launch pipeline) so the corpus
      // carries the firsthand scene/text/element detail, not just DOM text.
      if (fieldTest.states.length > 1) {
        try {
          const artifactDir = path.join(process.cwd(), "public", "field-tests", inspectionId);
          const vision = await describeStatesWithVision(fieldTest.states, artifactDir, { log: (m) => console.log(m) });
          if (vision.length > 0) fieldTest.visionObservations = vision;
        } catch {
          /* vision degraded — distill from the DOM states alone */
        }
      }
      const key = distillPrivateKey(fieldTest, publicStrings);
      const explored = explorationCounts(fieldTest); // P23 — refresh the board's exploration breadth too
      setCampaignCorpus(campaignId, {
        observations: key.observations,
        digest: key.digest,
        sources: key.distinctSources,
        exploredScreens: explored.screens,
        exploredElements: explored.elements,
      });
      console.log(
        `[repin] ${campaignId}: DONE — ${before.sources} → ${key.distinctSources} distinct sources, ` +
          `${key.observations.length} observations, explored ${explored.screens} screens/${explored.elements} elements, ` +
          `digest ${key.digest.slice(0, 10)} (was ${(before.digest ?? "none").slice(0, 10)})`,
      );
    } catch (err) {
      console.error(`[repin] ${campaignId}: FAILED —`, err);
    }
  });

  return NextResponse.json({ ok: true, started: true, campaignId, productUrl, before }, { status: 202 });
}

/** The most frequent string in a list (first-seen breaks ties), or null if empty. */
function mostCommon(xs: string[]): string | null {
  const count = new Map<string, number>();
  for (const x of xs) count.set(x, (count.get(x) ?? 0) + 1);
  let best: string | null = null;
  let bestN = 0;
  for (const [x, n] of count) if (n > bestN) { best = x; bestN = n; }
  return best;
}
