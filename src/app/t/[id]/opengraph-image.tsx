import { ImageResponse } from "next/og";
import { getCampaign } from "@/lib/db/campaigns";
import { getInspectionJob } from "@/lib/db/inspection";
import { hasMissionPlan } from "@/lib/campaigns/vault-kind";
import { liveView } from "@/lib/test-page/live";
import { siteUrl } from "@/lib/site";
import { hostOf } from "@/lib/site/when";
import { COPY, INK, MARK, PAPER, PENCIL, RULE, SEAL } from "@/lib/brand/stop";
import { ogFonts } from "@/lib/brand/og-fonts";

// It reads the test from the database, so it runs on Node.
export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "A test on Sage: real people try a product, and each one is paid for an honest try";

const XC = "Fira Sans Extra Condensed";
const ID = /^[A-Za-z0-9_-]{1,80}$/;
const usd = (base: number): string => `$${(base / 1_000_000).toFixed(2)}`;
const domain = () => siteUrl().replace(/^https?:\/\//, "");

/** A card says one thing: what a stranger can do with this link, or what people found. */
interface Card {
  label: string;
  headline: string;
  sub: string;
  /** places as ticks: ink for a person paid, grey for a place being checked, an outline for a place still open */
  places: { total: number; paid: number; taken: number } | null;
  /** a paid person's exact words (only where the test's own public page shows them), with "4 of 10 people" */
  quote: { text: string; who: string } | null;
}

/**
 * WHAT A SHARED TEST LINK LOOKS LIKE (27 Nov 2026): on X, Telegram, WhatsApp or anywhere a link unfurls.
 *
 * It is drawn from the page's own PUBLIC view (`liveView(campaign, null)`), so the card can never say more
 * than a stranger may read on the page: no frames, no notes of Sage's, no findings while places are open or
 * when the builder keeps them private (NO CORPUS ORACLE, CLAUDE.md). A plan nobody has paid for shows only
 * that Sage tried the product. Anything unreadable draws the plain Sage card: a share image is never broken.
 */
function cardFor(id: string): Card | null {
  if (!ID.test(id)) return null;
  const campaign = getCampaign(id);
  if (campaign && hasMissionPlan(campaign.vaultKind) && campaign.status !== "draft") {
    const view = liveView(campaign, null);
    const host = view.host ?? view.title;
    const each = view.missions[0]?.rewardBase ?? campaign.rewardAmount;
    const paid = view.findings?.paid.people ?? view.places.paid;
    if (view.phase === "live") {
      return {
        label: `A TEST · ${view.network.toUpperCase()}`,
        headline: `Try ${host}.`,
        sub: `Get paid ${usd(each)} in USDC for an honest try. ${view.places.left} of ${view.places.total} places left.`,
        places: { total: view.places.total, paid: view.places.paid, taken: view.places.checking },
        quote: null,
      };
    }
    const top = view.findings?.findings[0];
    const first = top?.quotes[0];
    return {
      label: paid > 0 ? "WHAT PEOPLE FOUND" : "A TEST",
      headline: paid > 0 ? `${paid} ${paid === 1 ? "person" : "people"} tried ${host}.` : `The test of ${host} has ended.`,
      sub: paid > 0 ? `Each one was checked and paid on ${view.network}, with a public receipt.` : "Nobody was paid on this test.",
      places: { total: view.places.total, paid: view.places.paid, taken: 0 },
      quote: first && top ? { text: first.text, who: top.people.length > 1 ? `${top.people.length} of ${paid} people` : "one person" } : null,
    };
  }
  const job = getInspectionJob(id);
  if (job) {
    const host = hostOf(job.productUrl) ?? "a product";
    return {
      label: "A TEST BEING SET UP",
      headline: `Sage tried ${host}.`,
      sub: "In a real browser, the way a stranger would. Real people try it next, each one paid for an honest try.",
      places: null,
      quote: null,
    };
  }
  return null;
}

/** A long domain still fits on one line: the headline steps down as it grows. */
function headlineSize(text: string): number {
  if (text.length <= 18) return 132;
  if (text.length <= 26) return 108;
  if (text.length <= 34) return 88;
  return 72;
}

function Places({ total, paid, taken }: { total: number; paid: number; taken: number }) {
  const ticks = Math.min(total, 24);
  const scale = ticks / Math.max(1, total);
  const filled = Math.min(ticks, paid > 0 ? Math.max(1, Math.round(paid * scale)) : 0);
  const held = Math.min(ticks - filled, taken > 0 ? Math.max(1, Math.round(taken * scale)) : 0);
  return (
    <div style={{ display: "flex", gap: 8 }}>
      {Array.from({ length: ticks }, (_, i) => (
        <div key={i} style={{ display: "flex", width: 30, height: 14, background: i < filled ? INK : i < filled + held ? COPY : PAPER, border: `2px solid ${i < filled + held ? INK : RULE}` }} />
      ))}
    </div>
  );
}

export default async function OG({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let card: Card | null = null;
  try {
    card = cardFor(id);
  } catch (e) {
    // the plain card is drawn instead, and the reason is left where the operator reads it
    console.error(`[og:test] ${id}: ${e instanceof Error ? e.message : String(e)}`);
    card = null;
  }
  const fonts = await ogFonts();
  const k = 34 / MARK.wall.h;
  const headline = card?.headline ?? "Real people try what you built.";

  return new ImageResponse(
    (
      <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", background: PAPER, color: INK, padding: "56px 64px", justifyContent: "space-between", fontFamily: "Fira Sans" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ display: "flex", alignItems: "center", height: 34 }}>
              <div style={{ width: MARK.path.w * k, height: MARK.path.h * k, background: INK }} />
              <div style={{ width: MARK.wall.w * k, height: 34, background: SEAL }} />
            </div>
            <div style={{ fontFamily: XC, fontWeight: 800, fontSize: 40, letterSpacing: 2.6 }}>SAGE</div>
          </div>
          <div style={{ display: "flex", fontFamily: "Fira Mono", fontSize: 22, letterSpacing: 2, color: PENCIL }}>{card?.label ?? "PROOF OF WORK, FOR PEOPLE"}</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div style={{ display: "flex", fontFamily: XC, fontWeight: 800, fontSize: headlineSize(headline), lineHeight: 0.95, color: INK }}>{headline}</div>
          {card?.quote ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, borderLeft: `6px solid ${SEAL}`, paddingLeft: 22 }}>
              <div style={{ display: "flex", fontSize: 34, lineHeight: 1.25, color: INK }}>“{card.quote.text.length > 120 ? `${card.quote.text.slice(0, 117).trimEnd()}…` : card.quote.text}”</div>
              <div style={{ display: "flex", fontFamily: "Fira Mono", fontSize: 22, color: PENCIL }}>{card.quote.who}</div>
            </div>
          ) : (
            <div style={{ display: "flex", fontSize: 34, lineHeight: 1.3, color: INK, maxWidth: 1000 }}>{card?.sub ?? "Paste your link. Sage tries it first, brings real people to try it, and pays each one for an honest try."}</div>
          )}
          {card?.places && card.places.total > 0 ? <Places total={card.places.total} paid={card.places.paid} taken={card.places.taken} /> : null}
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontFamily: "Fira Mono", fontSize: 24, color: PENCIL }}>
          <span>{domain()}/t/{ID.test(id) ? id : ""}</span>
          <span>{card?.quote ? card.sub.replace(/, with a public receipt\.$/, ".") : "Paid in USDC, with a receipt"}</span>
        </div>
      </div>
    ),
    { ...size, fonts },
  );
}
