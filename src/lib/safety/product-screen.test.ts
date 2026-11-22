// @vitest-environment node
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractObservation } from "@/lib/launch/extract";
import { detectProductKind } from "@/lib/launch/product-kind";
import type { FieldTestSummary } from "@/lib/launch/schemas";
import { registrable } from "./brands";
import {
  builderSafetyLine,
  compilePhishingList,
  lookalikeOfHandle,
  lookalikeOfHost,
  phishingVerdict,
  safetyOfMap,
  screenProduct,
  screenSubject,
  withReview,
  type PhishingConfig,
  type ProductSafetyRecord,
} from "./product-screen";

/**
 * THE PRODUCT SAFETY SCREEN, on saved pages. No network, no model: each page is read by production's own
 * extractor and kind detector, then screened. The harmful pages must be held or refused for the right
 * reason; the legitimate ones must come out clear (a false refusal is a failure too).
 */
const PAGES = path.join(process.cwd(), "tests", "model-zoo", "pages");
const LIST = compilePhishingList(JSON.parse(readFileSync(path.join(process.cwd(), "src", "lib", "safety", "__fixtures__", "phishing-config.json"), "utf8")) as PhishingConfig, 1);

function screenPage(url: string, page: string | null, over: { fieldTest?: FieldTestSummary | null; phishing?: typeof LIST | null; safeBrowsing?: string[] | null; domainAgeDays?: number | null } = {}): ProductSafetyRecord {
  const observations = page ? [extractObservation({ url, status: 200, html: readFileSync(path.join(PAGES, `${page}.html`), "utf8") })] : [];
  const kind = detectProductKind({ url, observations, fieldTest: over.fieldTest ?? null }).kind;
  return screenProduct({ url, observations, fieldTest: over.fieldTest ?? null, kind, phishing: over.phishing === undefined ? LIST : over.phishing, safeBrowsing: over.safeBrowsing, domainAgeDays: over.domainAgeDays, now: 100 });
}
const ids = (r: ProductSafetyRecord): string[] => r.signals.map((s) => s.id).sort();

describe("harmful products", () => {
  it("REFUSES an address on the phishing list, whatever its page says", () => {
    const r = screenPage("https://app.zkdrop-claims.example/", "website");
    expect(r.outcome).toBe("refused");
    expect(ids(r)).toEqual(["phishing_list"]);
    expect(r.signals[0]!.reason).toBe("app.zkdrop-claims.example is on a public list of reported phishing addresses (MetaMask's)");
    expect(r.lists.phishing).toBe("checked");
  });

  it("refuses when the pasted address is clean but the page LANDS on a listed one", () => {
    const observations = [extractObservation({ url: "https://wallet-rectify.example/start", status: 200, html: "<title>Start</title><h1>Start</h1>" })];
    const r = screenProduct({ url: "https://short.example/x", observations, kind: "website", phishing: LIST });
    expect(r.outcome).toBe("refused");
    expect(r.hosts).toEqual(["short.example", "wallet-rectify.example"]);
  });

  it("the list's own whitelist wins over its blacklist", () => {
    expect(phishingVerdict("listed-by-mistake.example", LIST).verdict).toBe("allowed");
    expect(screenPage("https://listed-by-mistake.example/", "website").outcome).toBe("clear");
  });

  it("REFUSES a page with a recovery-phrase field", () => {
    const r = screenPage("https://dapp-fix-portal.xyz/", "harm-seed-form");
    expect(r.outcome).toBe("refused");
    expect(r.signals.find((s) => s.id === "secret_field")).toMatchObject({ severity: "refuse", seen: "seed-phrase" });
  });

  it("REFUSES a lookalike of a well-known brand that asks for a wallet", () => {
    const r = screenPage("https://app-uniswap-claim.xyz/", "harm-lookalike");
    expect(r.outcome).toBe("refused");
    expect(r.signals[0]).toMatchObject({ id: "lookalike", severity: "refuse" });
    expect(r.signals[0]!.reason).toContain("looks like Uniswap's name but is not one of Uniswap's addresses");
    expect(r.signals[0]!.reason).toContain("asks visitors to connect a wallet");
  });

  it("HOLDS the same lookalike when nothing asks for a wallet", () => {
    const r = screenPage("https://app-uniswap-claim.xyz/", "website");
    expect(r.outcome).toBe("hold");
    expect(r.signals[0]).toMatchObject({ id: "lookalike", severity: "hold" });
  });

  it("HOLDS a wallet dapp whose connect screen shows an airdrop and a countdown", () => {
    const r = screenPage("https://zkr-portal.xyz/", "harm-drainer");
    expect(r.outcome).toBe("hold");
    expect(ids(r)).toEqual(["drainer_words"]);
    expect(r.signals[0]!.reason).toMatch(/^the screen that asks to connect a wallet also shows /);
  });

  it("HOLDS a download kept on a file-sharing service, with a password and antivirus switched off", () => {
    const r = screenPage("https://turbo-fps-boost.xyz/", "harm-malware-download");
    expect(r.outcome).toBe("hold");
    expect(ids(r)).toEqual(["archive_password", "download_elsewhere", "safety_checks_off"]);
  });

  it("HOLDS an address named for a claim or an airdrop, when the page asks for a wallet", () => {
    const r = screenPage("https://claim.zkr-foundation.xyz/", "wallet-dapp");
    expect(r).toMatchObject({ outcome: "hold", signals: [{ id: "bait_address", reason: "the address claim.zkr-foundation.xyz is named for a claim, and the page asks visitors to connect a wallet" }] });
    // the same address with nothing asking for a wallet says nothing
    expect(screenPage("https://claim.zkr-foundation.xyz/", "website").outcome).toBe("clear");
    // "reclaim" and "exclaimer" are words, not bait
    expect(screenPage("https://reclaim-protocol.xyz/", "wallet-dapp").outcome).toBe("clear");
  });

  it("holds an installer served from a host that is not the product's", () => {
    const observations = [extractObservation({ url: "https://neatpdf.app/", status: 200, html: '<title>NeatPDF</title><h1>Download NeatPDF</h1><a href="https://files-cdn-77.top/NeatPDF.exe">Download for Windows</a>' })];
    const r = screenProduct({ url: "https://neatpdf.app/", observations, kind: "desktop_app", phishing: LIST });
    expect(r.outcome).toBe("hold");
    expect(r.signals[0]).toMatchObject({ id: "download_elsewhere", reason: "the installer comes from files-cdn-77.top, which is not the product's own address" });
  });

  it("what the BROWSER saw counts too: a field the plain read never met", () => {
    const fieldTest = { ran: true, startUrl: "https://node-sync.xyz/", mode: "interactive", pages: [], classification: null, limitation: null, durationMs: 1, states: [
      { trigger: 'clicked "Connect Wallet"', screenshot: null, visibleTextExcerpt: "Connect Wallet\nImport", pixelDeltaPct: 50, url: "https://node-sync.xyz/", notableElements: [{ tag: "textarea", text: "Secret Recovery Phrase", role: "textbox" }] },
    ] } as unknown as FieldTestSummary;
    const r = screenProduct({ url: "https://node-sync.xyz/", observations: [], fieldTest, kind: "wallet_dapp", phishing: LIST });
    expect(r.outcome).toBe("refused");
    expect(r.signals[0]!.id).toBe("secret_field");
  });

  it("Google Safe Browsing refuses phishing and malware, and holds the softer kinds", () => {
    expect(screenPage("https://plain.example/", "website", { safeBrowsing: ["SOCIAL_ENGINEERING"] }).outcome).toBe("refused");
    expect(screenPage("https://plain.example/", "website", { safeBrowsing: ["UNWANTED_SOFTWARE"] }).outcome).toBe("hold");
    expect(screenPage("https://plain.example/", "website", { safeBrowsing: [] })).toMatchObject({ outcome: "clear", lists: { safeBrowsing: "checked" } });
    expect(screenPage("https://plain.example/", "website", { safeBrowsing: null }).lists.safeBrowsing).toBe("unavailable");
    expect(screenPage("https://plain.example/", "website").lists.safeBrowsing).toBe("off");
  });

  it("a brand-new domain holds only when it asks for a wallet or an install", () => {
    expect(screenPage("https://app.riverswap.xyz/", "legit-dapp", { domainAgeDays: 3 })).toMatchObject({ outcome: "hold", signals: [{ id: "new_domain", reason: "app.riverswap.xyz was registered 3 days ago and asks visitors to connect a wallet" }] });
    expect(screenPage("https://getdrops.app/", "website", { domainAgeDays: 3 }).outcome).toBe("clear");
    expect(screenPage("https://app.riverswap.xyz/", "legit-dapp", { domainAgeDays: 400 }).outcome).toBe("clear");
  });
});

describe("legitimate products come out clear", () => {
  const CLEAR: [string, string, string][] = [
    ["a real dapp: Connect wallet, Claim rewards, a vote that ends in 3 hours, and a warning about seed phrases", "https://app.riverswap.xyz/", "legit-dapp"],
    ["the zoo's dapp behind Connect wallet", "https://app.hummusvault.xyz/", "wallet-dapp"],
    ["a desktop app: installers on its own site, GitHub and S3, a SmartScreen note, a link to Node's installer", "https://quillnotes.app/download", "legit-desktop-download"],
    ["the zoo's desktop app", "https://notchnotes.app/", "desktop-app"],
    ["an App Store listing", "https://apps.apple.com/us/app/tidepool-habits/id1234567890", "mobile-app"],
    ["a browser extension's store listing", "https://chromewebstore.google.com/detail/tabtidy/abcdefghijklmnopabcdefghijklmnop", "browser-extension"],
    ["an ordinary site", "https://getdrops.app/", "website"],
    ["an API's page (it talks about keys)", "https://api.weathergrid.dev/", "api"],
    ["a repository", "https://github.com/acme/quickqueue", "code-repo"],
  ];
  it.each(CLEAR)("%s", (_name, url, page) => {
    const r = screenPage(url, page);
    expect(r.signals, JSON.stringify(r.signals)).toEqual([]);
    expect(r.outcome).toBe("clear");
  });

  it("a WARNING about a scam is not the scam", () => {
    const html = "<title>Security</title><h1>Stay safe</h1><p>We will never ask you to enter your seed phrase. Do not paste your private key anywhere. Scammers may ask you to enter your recovery phrase on a fake site.</p><button>Connect wallet</button>";
    const r = screenProduct({ url: "https://docs.riverswap.xyz/security", observations: [extractObservation({ url: "https://docs.riverswap.xyz/security", status: 200, html })], kind: "wallet_dapp", phishing: LIST });
    expect(r.signals).toEqual([]);
  });

  it("words that ASK for one are held, with no field to be seen", () => {
    const html = "<title>Restore</title><h1>Restore access</h1><p>To continue, enter your 12-word recovery phrase below.</p><button>Connect wallet</button>";
    const r = screenProduct({ url: "https://restore-portal.xyz/", observations: [extractObservation({ url: "https://restore-portal.xyz/", status: 200, html })], kind: "wallet_dapp", phishing: LIST });
    expect(r).toMatchObject({ outcome: "hold", signals: [{ id: "asks_for_secret" }] });
  });

  // Read from every stored plan (22 Nov 2026): one help-centre heading held a well-known exchange's own app on 17
  // of its 24 inspections, the only product of 57 the screen stopped. A title that explains is not an ask.
  it("the title of a help article about importing a phrase is not an ask", () => {
    const html = "<title>Riverswap</title><h1>Swap anything</h1><h3>How to import a recovery phrase into the Riverswap Wallet</h3><p>Follow step-by-step instructions for adding an existing wallet.</p><h3>Learn how to import your private key safely</h3><button>Connect wallet</button>";
    const r = screenProduct({ url: "https://app.riverswap.xyz/", observations: [extractObservation({ url: "https://app.riverswap.xyz/", status: 200, html })], kind: "wallet_dapp", phishing: LIST });
    expect(r.signals).toEqual([]);
  });

  it("...but the same words as an instruction are still held", () => {
    const html = "<title>Riverswap</title><h1>Restore</h1><p>How to continue: import your recovery phrase below.</p><button>Connect wallet</button>";
    const r = screenProduct({ url: "https://riverswap-restore.xyz/", observations: [extractObservation({ url: "https://riverswap-restore.xyz/", status: 200, html })], kind: "wallet_dapp", phishing: LIST });
    expect(r).toMatchObject({ outcome: "hold", signals: [{ id: "asks_for_secret" }] });
  });

  it('a field called "seed" on a page that is not about wallets is not a recovery phrase', () => {
    const html = '<title>World generator</title><h1>Make a world</h1><form><input name="seed"><button>Generate</button></form>';
    expect(screenProduct({ url: "https://worldgen.games/", observations: [extractObservation({ url: "https://worldgen.games/", status: 200, html })], kind: "website", phishing: LIST }).outcome).toBe("clear");
  });

  it("a private-key field off a wallet page is a person's to look at, not a refusal", () => {
    const html = '<title>Push settings</title><h1>Web push keys</h1><form><input name="vapid_private_key"><button>Save</button></form>';
    const r = screenProduct({ url: "https://pushpanel.dev/", observations: [extractObservation({ url: "https://pushpanel.dev/", status: 200, html })], kind: "website", phishing: LIST });
    expect(r).toMatchObject({ outcome: "hold", signals: [{ id: "secret_field", severity: "hold" }] });
  });

  it("with no list at all the screen says so, and still screens what Sage saw", () => {
    expect(screenPage("https://getdrops.app/", "website", { phishing: null })).toMatchObject({ outcome: "clear", lists: { phishing: "unavailable" } });
    expect(screenPage("https://dapp-fix-portal.xyz/", "harm-seed-form", { phishing: null }).outcome).toBe("refused");
  });
});

describe("lookalikes of well-known brands", () => {
  const STRONG: [string, string, string][] = [
    ["xn--mtamask-2xa.io", "metamask", "other_alphabet"], // mètamask
    ["xn--tamask-2of9c.io", "metamask", "other_alphabet"], // the first two letters are Cyrillic
    ["xn--unswap-q9a.org", "uniswap", "other_alphabet"], // unıswap, a dotless i
    ["m3tamask.io", "metamask", "digits_for_letters"],
    ["un1swap.org", "uniswap", "digits_for_letters"],
    ["paypa1.com", "paypal", "digits_for_letters"],
    ["0pensea.io", "opensea", "digits_for_letters"],
    ["rnetamask.io", "metamask", "digits_for_letters"],
    ["uniswap-claim.xyz", "uniswap", "brand_with_bait"],
    ["metamasksupport.com", "metamask", "brand_with_bait"],
    ["claim.opensea-airdrop.io", "opensea", "brand_with_bait"],
    ["phantom-wallet.app", "phantom", "brand_with_bait"],
    ["paypal-refund-support.com", "paypal", "brand_with_bait"],
    ["metamask-connect.vercel.app", "metamask", "brand_with_bait"],
    ["metamask.io.secure-session.xyz", "metamask", "brands_domain_inside"],
    ["metamask-io.xyz", "metamask", "brands_domain_inside"],
  ];
  it.each(STRONG)("%s imitates %s (%s)", (host, brand, how) => {
    expect(lookalikeOfHost(host)).toMatchObject({ brand: { name: brand }, how, strong: true });
  });

  const WEAK: [string, string, string][] = [
    ["metamsak.io", "metamask", "near_miss"],
    ["coinbasse.com", "coinbase", "near_miss"],
    ["metamask.app", "metamask", "brand_on_other_ending"],
    ["uniswap.vercel.app", "uniswap", "brand_on_other_ending"],
  ];
  it.each(WEAK)("%s is a weak lookalike of %s (%s): it holds, never refuses", (host, brand, how) => {
    expect(lookalikeOfHost(host)).toMatchObject({ brand: { name: brand }, how, strong: false });
    const r = screenProduct({ url: `https://${host}/`, observations: [], kind: "wallet_dapp", phishing: null });
    expect(r).toMatchObject({ outcome: "hold", signals: [{ id: "near_miss_name", severity: "hold" }] });
  });

  const NOT: string[] = [
    // the brands' own addresses, and what sits under them
    "metamask.io", "portfolio.metamask.io", "app.uniswap.org", "opensea.io", "phantom.app", "walletconnect.com", "accounts.google.com", "appleid.apple.com",
    "login.microsoftonline.com", "connect.stripe.com", "dashboard.stripe.com", "support.discord.com", "docs.github.com", "www.paypal.com", "wallet.coinbase.com",
    // products ABOUT a brand, with no bait beside the name
    "uniswap-analytics.xyz", "metamask-snaps-directory.dev", "discordbots.gg", "githubstatus.com", "telegram-stats.io",
    // honest things builders call their projects on shared hosts
    "stripe-connect-demo.vercel.app", "discord-auth-example.netlify.app", "telegram-wallet-tracker.vercel.app", "google-drive-clone.vercel.app", "amazon-clone-ten.vercel.app",
    // ordinary words that contain or sit near a brand
    "openseal.ch", "opensee.io", "telegraf.rs", "twister.app", "metatask.io", "pineapple.shop", "finance.yahoo.com", "myfinance.app", "hedger.xyz", "discard.app", "snapple.com", "stripes.design", "phantoms.gg", "applewood.co", "krakenrum.com", "lidocaine.info",
    // names with digits that are just names
    "web3.storage", "1password.com", "auth0.com", "4chan.org", "base44.app", "v0.app", "365datascience.com",
    // plain products
    "sagepays.xyz", "plausible.io", "excalidraw.com", "linear.app", "notion.so", "vercel.com", "tailwindcss.com", "app.hummusvault.xyz", "plotline-planner.vercel.app", "127.0.0.1",
  ];
  it.each(NOT)("%s imitates nothing", (host) => {
    expect(lookalikeOfHost(host)).toBeNull();
  });

  it("on a chat platform the HANDLE is read, and only a brand beside bait counts", () => {
    expect(lookalikeOfHandle("@Uniswap_Support_bot")).toMatchObject({ brand: { name: "uniswap" }, how: "brand_with_bait" });
    expect(lookalikeOfHandle("@metamask_airdrop_claim_bot")).toMatchObject({ brand: { name: "metamask" } });
    expect(lookalikeOfHandle("@pricewatch_bot")).toBeNull();
    expect(lookalikeOfHandle("@uniswap_stats_bot")).toBeNull();
    const r = screenProduct({ url: "https://t.me/Uniswap_Support_bot", observations: [], kind: "telegram_bot", phishing: LIST });
    expect(r).toMatchObject({ outcome: "hold", subject: "t.me/uniswap_support_bot" });
    // Telegram itself is never the lookalike, and a plain bot is clear
    expect(screenProduct({ url: "https://t.me/pricewatch_bot", observations: [], kind: "telegram_bot", phishing: LIST }).outcome).toBe("clear");
  });

  it("MetaMask's own fuzzylist holds a near miss of a name on it", () => {
    expect(phishingVerdict("etherscam.io", LIST)).toEqual({ verdict: "near", match: "etherscan" });
    expect(phishingVerdict("etherscan.io", LIST).verdict).toBe("allowed");
    expect(phishingVerdict("example.org", LIST).verdict).toBe("none");
  });
});

describe("the record", () => {
  it("a review is about the host, or on a shared platform the product's own page there", () => {
    expect(screenSubject("https://www.Example.com/pricing?x=1")).toBe("example.com");
    expect(screenSubject("https://t.me/Pricewatch_bot")).toBe("t.me/pricewatch_bot");
    expect(screenSubject("https://github.com/acme/quickqueue/issues")).toBe("github.com/acme/quickqueue");
    expect(screenSubject("not an address")).toBe("");
  });

  it("the registrable part of a host, with no list of suffixes shipped", () => {
    expect(registrable("a.b.example.co.uk")).toMatchObject({ domain: "example.co.uk", own: ["a", "b", "example"] });
    expect(registrable("my-app.vercel.app")).toMatchObject({ domain: "my-app.vercel.app", suffix: "vercel.app", own: ["my-app"] });
    expect(registrable("www.example.com").domain).toBe("example.com");
  });

  it("a person's decision replaces the screen's outcome and keeps what it noticed", () => {
    const held = screenPage("https://zkr-portal.xyz/", "harm-drainer");
    const cleared = withReview(held, "cleared", 500);
    expect(cleared).toMatchObject({ outcome: "clear", reviewed: { decision: "cleared", at: 500 } });
    expect(cleared.signals).toEqual(held.signals);
    expect(withReview(held, "refused", 500).outcome).toBe("refused");
    expect(withReview(held, null, 500)).toBe(held);
  });

  it("the builder's line says what Sage noticed and what happens next, and accuses nobody", () => {
    const held = builderSafetyLine(screenPage("https://zkr-portal.xyz/", "harm-drainer"));
    expect(held).toMatch(/^Sage noticed that the screen that asks to connect a wallet also shows /);
    expect(held).toMatch(/People you invite can still take part; public testers wait until a person at Sage has looked\.$/);
    const refused = builderSafetyLine(screenPage("https://dapp-fix-portal.xyz/", "harm-seed-form"));
    expect(refused).toBe("Sage can't run a test here: the page has a field that asks for a recovery phrase. Sage does not send testers to an address like that. If this is a mistake, tell us and a person at Sage will look.");
    for (const line of [held, refused]) expect(line).not.toMatch(/\b(?:scam|fraud|phish(?:er|ing site)|malware|drainer|criminal|you are|your site is)\b/i);
    expect(builderSafetyLine(screenPage("https://getdrops.app/", "website"))).toBe("");
    expect(builderSafetyLine(null)).toBe("");
  });

  it("is read back from a stored map defensively", () => {
    const r = screenPage("https://zkr-portal.xyz/", "harm-drainer");
    expect(safetyOfMap({ safety: JSON.parse(JSON.stringify(r)) })).toEqual({ ...r, reviewed: null });
    expect(safetyOfMap({})).toBeNull();
    expect(safetyOfMap({ safety: { outcome: "banana" } })).toBeNull();
    expect(safetyOfMap(null)).toBeNull();
  });

  it("is deterministic", () => {
    expect(screenPage("https://turbo-fps-boost.xyz/", "harm-malware-download")).toEqual(screenPage("https://turbo-fps-boost.xyz/", "harm-malware-download"));
  });
});
