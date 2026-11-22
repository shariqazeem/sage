// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { extractObservation } from "@/lib/launch/extract";
import { detectProductKind } from "@/lib/launch/product-kind";
import type { FieldTestSummary } from "@/lib/launch/schemas";
import { compilePhishingList, screenProduct, type PhishingConfig, type ProductSafetyRecord } from "./product-screen";

/**
 * THE FALSE-ALARM RATE, MEASURED. A screen that refuses or holds an honest product has failed too.
 *
 * Every legitimate product Sage has saved or names is screened here, and none may be held or refused:
 *   - every saved page of the model zoo (one per kind of product, at the address its row uses), with the
 *     two recorded browser runs;
 *   - every address of the P-GEN battery (read from the script, so a new category is measured the day it
 *     is added), screened as an address, since their pages are live;
 *   - a list of well-known and awkward honest addresses: brands' own domains and sub-domains, products
 *     named after a brand, builders' apps on shared hosts.
 *
 * `SAFETY_TABLE=1 npx vitest run false-alarms` prints the table. The harmful fixtures are counted beside it,
 * so a rule loosened until nothing is flagged fails here as well.
 */
const ROOT = process.cwd();
const PAGES = path.join(ROOT, "tests", "model-zoo", "pages");
const LIST = compilePhishingList(JSON.parse(readFileSync(path.join(ROOT, "src", "lib", "safety", "__fixtures__", "phishing-config.json"), "utf8")) as PhishingConfig, 1);

/** the address each saved page is served at in the zoo (tests/model-zoo/product-kinds.test.ts) */
const ZOO: Record<string, string> = {
  "ai-chat": "https://askfern.ai/",
  api: "https://api.weathergrid.dev/",
  "api-docs": "https://api.weathergrid.dev/docs",
  "browser-extension": "https://chromewebstore.google.com/detail/tabtidy/abcdefghijklmnopabcdefghijklmnop",
  "code-repo": "https://github.com/acme/quickqueue",
  "code-repo-issues": "https://github.com/acme/quickqueue/issues",
  community: "https://discord.gg/metisbuilders",
  "design-prototype": "https://www.figma.com/proto/AbC123/Checkout-flow",
  "desktop-app": "https://notchnotes.app/",
  "desktop-app-changelog": "https://notchnotes.app/changelog",
  "discord-bot": "https://top.gg/bot/771234567890123456",
  "mobile-app": "https://apps.apple.com/us/app/tidepool-habits/id1234567890",
  package: "https://pypi.org/project/tinytable/",
  "single-page-app": "https://plotline-planner.vercel.app/",
  "telegram-bot": "https://t.me/pricewatch_bot",
  "telegram-mini-app": "https://t.me/tapgarden_bot/play",
  "video-demo": "https://www.loom.com/share/0281766fa2d04bb788eaf19e65135184",
  waitlist: "https://orbitmail.xyz/",
  "wallet-dapp": "https://app.hummusvault.xyz/",
  "wallet-dapp-docs": "https://app.hummusvault.xyz/docs",
  website: "https://getdrops.app/",
  "website-new": "https://getdrops.app/new",
  "legit-dapp": "https://app.riverswap.xyz/",
  "legit-desktop-download": "https://quillnotes.app/download",
  // the six listings as the live battery met them (tests/model-zoo/listings.test.ts), a bot check among them
  "listing-telegram": "https://t.me/ledgerlarkbot",
  "listing-repo": "https://github.com/harborworks/tidewatch",
  "listing-repo-issues": "https://github.com/harborworks/tidewatch/issues",
  "listing-bot-check": "https://pypi.org/project/slatecsv/",
  "listing-app-store": "https://apps.apple.com/us/app/lanternly-night-reader/id1234567891",
  "listing-extension": "https://chromewebstore.google.com/detail/pagepebble/abcdefghijklmnopabcdefghijklmnoq",
  "listing-discord": "https://discord.com/invite/kilnclub",
};
const HARM: Record<string, { url: string; outcome: "hold" | "refused" }> = {
  "harm-drainer": { url: "https://zkr-portal.xyz/", outcome: "hold" },
  "harm-lookalike": { url: "https://app-uniswap-claim.xyz/", outcome: "refused" },
  "harm-seed-form": { url: "https://dapp-fix-portal.xyz/", outcome: "refused" },
  "harm-malware-download": { url: "https://turbo-fps-boost.xyz/", outcome: "hold" },
};

const HONEST_ADDRESSES = [
  // the brands themselves
  "https://metamask.io/", "https://portfolio.metamask.io/", "https://app.uniswap.org/", "https://opensea.io/", "https://phantom.app/", "https://walletconnect.com/",
  "https://www.coinbase.com/wallet", "https://wallet.coinbase.com/", "https://www.binance.com/en", "https://etherscan.io/", "https://app.aave.com/", "https://stake.lido.fi/",
  "https://pancakeswap.finance/", "https://www.sushi.com/swap", "https://app.1inch.io/", "https://magiceden.io/", "https://polymarket.com/", "https://app.hyperliquid.xyz/trade",
  "https://bridge.arbitrum.io/", "https://portal.zksync.io/", "https://www.paypal.com/signin", "https://accounts.google.com/", "https://appleid.apple.com/", "https://login.microsoftonline.com/",
  "https://dashboard.stripe.com/login", "https://connect.stripe.com/", "https://discord.com/login", "https://web.telegram.org/", "https://github.com/login", "https://www.linkedin.com/login",
  // products named after a brand, with nothing that reads as bait
  "https://uniswap-analytics.xyz/", "https://dune.com/hagaetc/uniswap-metrics", "https://discordbots.gg/", "https://www.githubstatus.com/", "https://metamask-snaps-directory.dev/", "https://telegram-stats.io/",
  // builders' apps on shared hosts
  "https://stripe-connect-demo.vercel.app/", "https://discord-auth-example.netlify.app/", "https://telegram-wallet-tracker.vercel.app/", "https://google-drive-clone.vercel.app/", "https://my-nft-gallery.pages.dev/",
  "https://todo-app-9f3a.lovable.app/", "https://habit-garden.replit.app/", "https://acme.github.io/quickqueue/", "https://myshop.myshopify.com/", "https://hf.space/acme/demo",
  // Sage and its neighbours
  "https://sagepays.xyz/", "https://www.metis.io/", "https://andromeda-explorer.metis.io/", "https://netswap.io/", "https://clawup.org/", "https://parallaxpay.xyz/",
  // ordinary products
  "https://linear.app/", "https://www.notion.so/", "https://vercel.com/", "https://supabase.com/", "https://cal.com/", "https://posthog.com/", "https://resend.com/", "https://www.figma.com/", "https://slack.com/",
  "https://openai.com/", "https://claude.ai/", "https://cursor.com/", "https://railway.app/", "https://www.shopify.com/", "https://finance.yahoo.com/", "https://1password.com/", "https://auth0.com/", "https://web3.storage/",
];

interface Row { set: string; name: string; url: string; record: ProductSafetyRecord }
const rows: Row[] = [];

function screenAddress(url: string): ProductSafetyRecord {
  const kind = detectProductKind({ url, observations: [] }).kind;
  return screenProduct({ url, observations: [], kind, phishing: LIST });
}
function screenSaved(url: string, page: string, fieldTest: FieldTestSummary | null = null): ProductSafetyRecord {
  const observations = [extractObservation({ url, status: 200, html: readFileSync(path.join(PAGES, `${page}.html`), "utf8") })];
  return screenProduct({ url, observations, fieldTest, kind: detectProductKind({ url, observations, fieldTest }).kind, phishing: LIST });
}

/** The P-GEN battery's addresses, read from the script itself. */
function pgenUrls(): string[] {
  const src = readFileSync(path.join(ROOT, "scripts", "mission-eval-matrix.mjs"), "utf8");
  return [...src.matchAll(/\{\s*cat:\s*"[^"]+",\s*url:\s*"(https?:\/\/[^"]+)"/g)].map((m) => m[1]!);
}

describe("honest products are never held or refused", () => {
  it("every saved page of the model zoo, at its own address", () => {
    const saved = readdirSync(PAGES).filter((f) => f.endsWith(".html")).map((f) => f.replace(/\.html$/, ""));
    // every saved page is accounted for: a new one must be named honest or harmful
    expect(saved.filter((n) => !ZOO[n] && !HARM[n])).toEqual([]);
    for (const [page, url] of Object.entries(ZOO)) rows.push({ set: "zoo page", name: page, url, record: screenSaved(url, page) });
  });

  it("the recorded browser runs (the states Sage's browser really saw on a live product)", () => {
    const dir = path.join(ROOT, "src", "lib", "launch", "__fixtures__");
    const runs = readdirSync(dir).filter((x) => x.endsWith("-run.json"));
    expect(runs.length).toBeGreaterThanOrEqual(2);
    for (const f of runs) {
      const raw = JSON.parse(readFileSync(path.join(dir, f), "utf8")) as { states: FieldTestSummary["states"] };
      const url = raw.states[0]?.url || "https://yara.garden/";
      const fieldTest = { ran: true, startUrl: url, mode: "interactive", pages: [], states: raw.states, classification: null, limitation: null, durationMs: 0 } as FieldTestSummary;
      rows.push({ set: "browser run", name: f, url, record: screenProduct({ url, observations: [], fieldTest, kind: detectProductKind({ url, observations: [], fieldTest }).kind, phishing: LIST }) });
    }
  });

  it("every address of the P-GEN battery", () => {
    const urls = pgenUrls();
    expect(urls.length).toBeGreaterThanOrEqual(15);
    for (const url of urls) rows.push({ set: "P-GEN address", name: url, url, record: screenAddress(url) });
  });

  it("well-known and awkward honest addresses", () => {
    for (const url of HONEST_ADDRESSES) rows.push({ set: "honest address", name: url, url, record: screenAddress(url) });
  });

  it("THE RATE: nothing honest is held or refused", () => {
    const alarms = rows.filter((r) => r.record.outcome !== "clear");
    expect(rows.length).toBeGreaterThanOrEqual(110);
    expect(alarms.map((r) => `${r.set} ${r.name}: ${r.record.outcome} (${r.record.signals.map((s) => s.id).join(", ")})`)).toEqual([]);
  });
});

describe("and the harmful fixtures are still caught", () => {
  it.each(Object.entries(HARM))("%s", (page, want) => {
    expect(screenSaved(want.url, page).outcome).toBe(want.outcome);
  });
});

afterAll(() => {
  if (!process.env.SAFETY_TABLE) return;
  const sets = [...new Set(rows.map((r) => r.set))];
  const lines = sets.map((s) => {
    const of = rows.filter((r) => r.set === s);
    return `${s}: ${of.length} screened, ${of.filter((r) => r.record.outcome === "hold").length} held, ${of.filter((r) => r.record.outcome === "refused").length} refused`;
  });
  const alarms = rows.filter((r) => r.record.outcome !== "clear").length;
  console.log([...lines, `TOTAL: ${rows.length} honest products, ${alarms} false alarms (${((100 * alarms) / Math.max(1, rows.length)).toFixed(1)}%)`].join("\n"));
});
