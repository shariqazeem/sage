import { onHost, SIGHT, STORAGE_OR_APP_HOSTS } from "@/lib/verify/what-sage-sees";
import type { CandidateMission, FieldTestSummary, ProductObservation } from "./schemas";

/**
 * EVERY KIND OF PRODUCT (22 Nov 2026, the founder: "strong and smart from every perspective, and for every
 * kind of product").
 *
 * A builder can paste anything: a site, a repository, a package, a store listing, a Telegram bot, a browser
 * extension, a download, a waitlist, a chat product, a prototype, a recorded demo, a dapp behind "Connect
 * wallet". Sage does the best honest thing with each: it tries what it can try, designs the first try that
 * fits, checks only what it can check, and says plainly what it could not do.
 *
 * This file is the one place that says, per kind:
 *   - how the kind is recognised (the address first, then what Sage saw; no model);
 *   - what Sage itself looks at, and what it cannot do, in one plain line a builder reads;
 *   - the fixed words of the first-try mission (core-mission.ts builds the mission from them);
 *   - what a mission of that kind may ask as proof (`kindProofIssue`): never a thing Sage cannot read.
 *
 * Pure: no I/O, no `server-only`. The category (`inferCategory`) is untouched; the kind sits beside it.
 */

export const PRODUCT_KINDS = [
  /** a site Sage can open and use in its browser: everything that worked before, unchanged */
  "website",
  /** a single-page app, usually from an AI app builder; tried in the browser like a site */
  "single_page_app",
  /** a dapp whose product sits behind "Connect wallet" */
  "wallet_dapp",
  "telegram_bot",
  "telegram_mini_app",
  "discord_bot",
  /** a Discord server or a Telegram channel or group */
  "community",
  "code_repo",
  "package",
  "api",
  "mobile_app",
  "browser_extension",
  "desktop_app",
  "waitlist",
  "ai_chat",
  "design_prototype",
  "video_demo",
] as const;
export type ProductKind = (typeof PRODUCT_KINDS)[number];

export interface ProductKindRecord {
  kind: ProductKind;
  /** the fact that decided it, in plain words */
  because: string;
  /** verbatim text from the page Sage read (title, headings, buttons): the first-try mission's anchors */
  seen: string[];
}

/** How far Sage's own reading reaches on a shared platform: the pasted page, or everything under one path. */
export interface PlatformScope {
  /** only pages whose path is this or sits under it belong to the product */
  pathPrefix: string;
  /** read the pasted page only */
  onlyThisPage: boolean;
}

interface UrlKind {
  kind: ProductKind;
  because: string;
  scope: PlatformScope | null;
  /** the product's name as the address gives it, when it does */
  name: string | null;
}

const hostOf = (u: URL): string => u.hostname.toLowerCase().replace(/^www\./, "");
const segs = (u: URL): string[] => u.pathname.split("/").filter(Boolean);
const under = (u: URL, n: number): string => `/${segs(u).slice(0, n).join("/")}`;
const exact = (u: URL): PlatformScope => ({ pathPrefix: u.pathname.replace(/\/+$/, "") || "/", onlyThisPage: true });

const GITHUB_NOT_OWNERS = new Set(["orgs", "settings", "marketplace", "topics", "sponsors", "features", "about", "apps", "login", "pricing", "explore", "collections", "trending", "enterprise", "solutions", "resources", "customer-stories", "security", "readme", "search", "notifications", "pulls", "issues"]);
const TELEGRAM_NOT_NAMES = new Set(["s", "joinchat", "addstickers", "share", "proxy", "login", "iv", "c", "addemoji", "setlanguage", "addtheme", "boost", "m"]);
const INSTALLER = /\.(?:dmg|exe|msi|appimage|deb|rpm|pkg)$/i;

/**
 * The kind an address alone decides. Null for an ordinary site, where what Sage saw decides instead.
 * Each rule names a place where the product is LISTED or HOSTED by someone else, so the page Sage can read
 * is that listing and nothing more.
 */
export function kindFromUrl(raw: string): UrlKind | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  const h = hostOf(u);
  const s = segs(u);
  const is = (...hosts: string[]) => hosts.some((x) => h === x || h.endsWith(`.${x}`));

  if (is("t.me", "telegram.me", "telegram.dog")) {
    const name = s[0] ?? "";
    if (!name || TELEGRAM_NOT_NAMES.has(name.toLowerCase()) || name.startsWith("+")) {
      return name.startsWith("+") || name.toLowerCase() === "joinchat"
        ? { kind: "community", because: "a Telegram invite address", scope: exact(u), name: null }
        : null;
    }
    const bot = /bot$/i.test(name);
    if (bot && (s.length >= 2 || u.searchParams.has("startapp")))
      return { kind: "telegram_mini_app", because: "a Telegram address that opens an app inside a bot", scope: { pathPrefix: `/${name}`, onlyThisPage: false }, name: `@${name}` };
    if (bot) return { kind: "telegram_bot", because: "a Telegram address whose name ends in bot", scope: { pathPrefix: `/${name}`, onlyThisPage: false }, name: `@${name}` };
    return { kind: "community", because: "a Telegram address of a channel or group", scope: { pathPrefix: `/${name}`, onlyThisPage: false }, name: `@${name}` };
  }
  if (is("discord.gg") || (is("discord.com", "discordapp.com") && s[0] === "invite"))
    return { kind: "community", because: "a Discord invite address", scope: exact(u), name: null };
  if ((is("discord.com", "discordapp.com") && (s[0] === "oauth2" || s[0] === "application-directory" || (s[0] === "api" && s[1] === "oauth2"))) || (is("top.gg") && s[0] === "bot"))
    return { kind: "discord_bot", because: "an address that adds a bot to a Discord server", scope: exact(u), name: null };

  if (is("github.com") && h === "github.com" && s.length >= 2 && !GITHUB_NOT_OWNERS.has(s[0]!.toLowerCase()))
    return { kind: "code_repo", because: "a GitHub repository address", scope: { pathPrefix: under(u, 2), onlyThisPage: false }, name: s[1]!.replace(/\.git$/i, "") };
  if ((is("gitlab.com") || is("codeberg.org") || is("bitbucket.org")) && s.length >= 2)
    return { kind: "code_repo", because: "a code repository address", scope: { pathPrefix: under(u, 2), onlyThisPage: false }, name: s[1]! };

  if (is("npmjs.com") && s[0] === "package" && s[1]) {
    const scoped = s[1].startsWith("@") && s[2];
    return { kind: "package", because: "an npm package address", scope: { pathPrefix: under(u, scoped ? 3 : 2), onlyThisPage: false }, name: scoped ? `${s[1]}/${s[2]}` : s[1] };
  }
  if (is("pypi.org") && s[0] === "project" && s[1]) return { kind: "package", because: "a PyPI package address", scope: { pathPrefix: under(u, 2), onlyThisPage: false }, name: s[1] };
  if (is("crates.io") && s[0] === "crates" && s[1]) return { kind: "package", because: "a crates.io package address", scope: { pathPrefix: under(u, 2), onlyThisPage: false }, name: s[1] };
  if (is("rubygems.org") && s[0] === "gems" && s[1]) return { kind: "package", because: "a RubyGems package address", scope: { pathPrefix: under(u, 2), onlyThisPage: false }, name: s[1] };
  if (is("pkg.go.dev") && s.length >= 1) return { kind: "package", because: "a Go package address", scope: exact(u), name: s[s.length - 1]! };
  if (is("hub.docker.com") && (s[0] === "r" || s[0] === "_") && s[1]) return { kind: "package", because: "a Docker Hub image address", scope: exact(u), name: s[s.length - 1]! };

  if (is("apps.apple.com", "itunes.apple.com")) return { kind: "mobile_app", because: "an App Store listing address", scope: exact(u), name: null };
  if (is("testflight.apple.com")) return { kind: "mobile_app", because: "a TestFlight invite address", scope: exact(u), name: null };
  if (is("play.google.com") && s[0] === "store" && s[1] === "apps") return { kind: "mobile_app", because: "a Google Play listing address", scope: exact(u), name: null };
  if (is("f-droid.org") && s.includes("packages")) return { kind: "mobile_app", because: "an F-Droid listing address", scope: exact(u), name: null };
  if (/\.apk$/i.test(u.pathname)) return { kind: "mobile_app", because: "an address that downloads an Android app file", scope: exact(u), name: null };

  if (is("chromewebstore.google.com") || (is("chrome.google.com") && s[0] === "webstore") || (is("addons.mozilla.org") && s.includes("addon")) || (is("microsoftedge.microsoft.com") && s[0] === "addons"))
    return { kind: "browser_extension", because: "a browser extension store address", scope: exact(u), name: null };

  if (is("figma.com") && ["proto", "file", "design", "board", "make", "deck"].includes(s[0] ?? ""))
    return { kind: "design_prototype", because: "a Figma address", scope: exact(u), name: null };

  if ((is("loom.com") && (s[0] === "share" || s[0] === "embed")) || (is("youtube.com") && (s[0] === "watch" || s[0] === "shorts" || s[0] === "live")) || is("youtu.be") || (is("vimeo.com") && /^\d+$/.test(s[0] ?? "")) || is("tella.tv"))
    return { kind: "video_demo", because: "an address of a recorded demo", scope: exact(u), name: null };

  if (INSTALLER.test(u.pathname)) return { kind: "desktop_app", because: "an address that downloads an installer", scope: exact(u), name: null };
  return null;
}

/** Hosts where an AI app builder or a one-click host publishes a builder's app, almost always a single-page app. */
const APP_BUILDER_HOSTS = [
  "vercel.app", "netlify.app", "lovable.app", "lovable.dev", "bolt.new", "bolt.host", "replit.app", "replit.dev", "repl.co", "pages.dev",
  "web.app", "firebaseapp.com", "onrender.com", "railway.app", "up.railway.app", "fly.dev", "github.io", "surge.sh", "glitch.me", "v0.app",
  "base44.app", "createxyz.app", "created.app", "same-app.com", "emergent.sh", "rork.app", "framer.app", "webflow.io", "bubbleapps.io", "streamlit.app", "hf.space",
];

const WALLET_CTA = /\bconnect(?:\s+(?:a|your|to|to\s+a|to\s+your))?\s+wallet\b|\bconnect metamask\b|\bwallet\s?connect\b|\b(?:launch|enter|open) dapp\b/i;
const WALLET_WALL = /connect-wallet required|connect\s+(?:a\s+|your\s+)?wallet\s+to\s+(?:continue|access|view|start|use|get started|launch|create)/i;
const WAITLIST = /\bjoin (?:the |our )?wait(?:ing)?[\s-]?list\b|\bwait(?:ing)?[\s-]?list\b|\bcoming soon\b|\blaunching soon\b|\bget early access\b|\brequest (?:early )?access\b|\bsign up for early access\b|\bnotify me\b|\bbe the first to (?:know|try)\b|\bearly access\b/i;
const HAS_A_PRODUCT = /\b(?:log ?in|sign ?in|sign ?up|dashboard|open (?:the )?app|launch (?:the )?app|pricing|add to cart|download|start free|get started|try (?:it )?(?:now|free)|connect wallet|docs|documentation)\b/i;
const CHAT = /\bhow can i help\b|\bwhat can i help\b|\bask (?:me )?anything\b|\bmessage [\p{L}\d]{2,20}(?:…|\.\.\.)|\btype (?:a|your) (?:message|question|prompt)\b|\bchat with (?:our |an? |the )?(?:ai|assistant|bot|model)\b|\bwhat(?:'|’)s on your mind\b/iu;
const DESKTOP = /\bdownload for (?:mac|macos|windows|linux)\b|\bdownload (?:the )?(?:mac|macos|windows|linux|desktop) (?:app|version|installer)\b|\b(?:mac|macos|windows|linux) (?:app|installer|download)\b|\.(?:dmg|exe|msi|appimage)\b/i;
const STORE_BADGE = /\bdownload on the app store\b|\bget it on google play\b|\bavailable on (?:the )?(?:app store|google play)\b/i;
/**
 * "Get the app" alone is a line in many a footer. It makes a product a phone app only when Sage's browser found
 * next to nothing to use: measured on a stored job, a social profile page where the browser walked 14 screens
 * was called a phone app for those three words, and its first try would have told people to install something.
 */
const STORE_HINT = /\bget the app\b|\bdownload the app\b/i;
const API_KEY = /\bapi keys?\b|\bget (?:an |your )?(?:api )?key\b|\baccess tokens?\b/i;
const API_SHAPE = /\bapi reference\b|\brest api\b|\bgraphql api\b|\bendpoints?\b|\bcurl\b|\bsdks?\b|\bwebhooks?\b|\brate limits?\b/i;

/** The first screen, in three strengths: its headline, its controls (buttons, links, form fields), and all its text. */
function firstScreenText(observations: readonly ProductObservation[], ft: FieldTestSummary | null | undefined): { head: string; controls: string; text: string } {
  const o = observations[0];
  const page = ft?.pages?.[0];
  const state = ft?.states?.[0];
  const join = (parts: (string | null | undefined)[]) => parts.filter(Boolean).join(" • ");
  const controls = join([...(o?.ctas ?? []), ...(o?.forms ?? []).flatMap((f) => [f.label, ...f.fields]), ...(page?.ctas ?? []), ...(state?.notableElements ?? []).map((e) => e.text)]);
  const head = join([o?.title, ...(o?.headings ?? []).slice(0, 3), page?.title, page?.h1]);
  const text = join([head, ...(o?.headings ?? []), ...(o?.claims ?? []), ...(o?.snippets ?? []), ...(o?.states ?? []), page?.visibleTextExcerpt, state?.visibleTextExcerpt, controls]);
  return { head, controls, text };
}

/** Verbatim strings from the page Sage read, for the first-try mission to anchor on when no browser ran. */
function seenOn(observations: readonly ProductObservation[]): string[] {
  const o = observations[0];
  if (!o) return [];
  const out: string[] = [];
  for (const raw of [...o.headings.slice(0, 4), o.title, ...o.ctas.slice(0, 3), ...o.snippets.slice(0, 2)]) {
    const s = (raw ?? "").replace(/\s+/g, " ").trim();
    if (s.length < 4 || s.length > 90 || out.some((x) => x.toLowerCase() === s.toLowerCase())) continue;
    out.push(s);
    if (out.length >= 6) break;
  }
  return out;
}

/**
 * The product's kind, decided once from the address and what Sage saw. Deterministic; no model.
 *
 * The address wins when it names a platform (a store, a repository host, Telegram): there is no doubt what
 * such a page is. Otherwise the first screen decides, most specific first, and anything that matches nothing
 * stays a "website", which is exactly how Sage treated every product before.
 */
export function detectProductKind(input: { url: string; observations: readonly ProductObservation[]; fieldTest?: FieldTestSummary | null }): ProductKindRecord {
  const seen = seenOn(input.observations);
  const fromUrl = kindFromUrl(input.url);
  if (fromUrl) {
    // A bot's username need not end in "bot" (the oldest ones do not). Telegram's own page says which it is:
    // its title reads "Launch @name" for a bot and "View", "Contact" or "Join" for a channel, a person or a group.
    if (fromUrl.kind === "community" && fromUrl.name && /^Telegram:\s+Launch\s+@/i.test(input.observations[0]?.title ?? ""))
      return { kind: "telegram_bot", because: "a Telegram page that launches a bot", seen };
    return { kind: fromUrl.kind, because: fromUrl.because, seen };
  }

  const ft = input.fieldTest ?? null;
  const { head, text, controls } = firstScreenText(input.observations, ft);
  const walls = [ft?.limitation ?? "", ...(ft?.docs ?? []).map((d) => JSON.stringify(d)), ...(ft?.states ?? []).map((s) => s.trigger ?? "")].join(" • ");
  let host = "";
  try {
    host = hostOf(new URL(input.url));
  } catch {
    /* no host: the page facts decide */
  }

  if (WALLET_WALL.test(`${walls} • ${text}`) || WALLET_CTA.test(controls)) return { kind: "wallet_dapp", because: "the first screen asks a visitor to connect a wallet", seen };

  const pagesRead = input.observations.length + (ft?.pages?.length ?? 0);
  const statesSeen = ft?.states?.length ?? 0;
  if (WAITLIST.test(text) && !HAS_A_PRODUCT.test(controls) && pagesRead <= 3 && statesSeen <= 2)
    return { kind: "waitlist", because: "the page asks for a sign-up before launch and offers nothing to use yet", seen };

  if (CHAT.test(`${head} • ${controls}`) || /^chat\./.test(host)) return { kind: "ai_chat", because: "the first screen is a box to ask a question in", seen };
  if (DESKTOP.test(`${head} • ${controls}`)) return { kind: "desktop_app", because: "the page offers a download for a computer", seen };
  if ((STORE_BADGE.test(text) || (STORE_HINT.test(text) && statesSeen <= 2)) && !/\b(?:log ?in|sign ?in|sign ?up|open (?:the )?app|launch (?:the )?app|dashboard)\b/i.test(controls))
    return { kind: "mobile_app", because: "the page sends visitors to an app store and offers nothing to use in the browser", seen };
  if ((/\bapis?\b/i.test(head) || /^(?:api|developers?)\./.test(host)) && API_KEY.test(text) && API_SHAPE.test(text)) return { kind: "api", because: "the page describes an API used with a key", seen };

  if (host && onHost(host, APP_BUILDER_HOSTS)) return { kind: "single_page_app", because: "it is published on an app builder's host", seen };
  // (a page that answered Sage's plain read with nothing is NOT taken for one: that is what a bot wall looks like)
  if (ft?.pages?.[0]?.jsOnly) return { kind: "single_page_app", because: "the page shows nothing until its scripts run", seen };
  return { kind: "website", because: "a site Sage can open in its browser", seen };
}

/** The product's name, when the platform's own page title would be a poor one ("Apps on Google Play"). */
const PLATFORM_WORDS = /\b(app store|google play|chrome web store|add-ons for firefox|youtube|loom|figma|telegram|npm|pypi|github|gitlab|crates\.io|discord|vimeo|testflight|microsoft edge)\b/i;
export function kindProductName(url: string, observations: readonly ProductObservation[]): string | null {
  const fromUrl = kindFromUrl(url);
  if (!fromUrl) return null;
  if (fromUrl.name) return fromUrl.name;
  const o = observations[0];
  const title = (o?.title ?? "").replace(/[\u200e\u200f]/g, "").trim();
  // the listing's own heading first (a store's h1 is the product's name), then the title's parts
  const candidates = [o?.headings[0] ?? "", ...title.split(/\s[|–—:·-]\s|\s+on the\s+(?=App Store)/i)]
    .map((part) =>
      part
        .replace(/^(?:join the|watch)\s+/i, "")
        .replace(/\s+discord server!?$/i, "")
        .replace(/\s+app$/i, "")
        .replace(/:\s.*$/, "")
        .trim(),
    )
    .filter((part) => part.length >= 2 && part.length <= 40 && !/[()]/.test(part) && !PLATFORM_WORDS.test(part));
  // with nothing usable, a plain noun for the kind: never the platform's name ("Try Loom for the first time")
  return candidates[0] ?? FALLBACK_NAME[fromUrl.kind] ?? null;
}
/** A plain noun for a product of this kind, for when its own name cannot be used in a mission. */
export const kindFallbackName = (kind: ProductKind): string => FALLBACK_NAME[kind] ?? "this product";
const FALLBACK_NAME: Partial<Record<ProductKind, string>> = {
  mobile_app: "this app", browser_extension: "this extension", design_prototype: "this prototype", video_demo: "this demo",
  community: "this community", discord_bot: "this bot", desktop_app: "this app", package: "this package",
  telegram_bot: "this bot", telegram_mini_app: "this mini app", code_repo: "this project", api: "this API", waitlist: "this product", ai_chat: "this assistant", wallet_dapp: "this dapp",
};

/* ───────────────────────────────────────────────────────── what each kind means ── */

export interface FirstTryWords {
  /** what Sage read and the tester reads first: "the App Store listing" */
  place: string;
  /** the rest of step 1, after "Open <address> and " */
  look: string;
  /** the main action when no model names a usable one, as it follows "try to" */
  defaultAction: string;
  /** step 3 up to its full stop: how a person tries this kind of product */
  how: (product: string, action: string, from: string) => string;
  /** the rest of step 3: what counts as an honest place to stop */
  stop: string;
  /** step 4, after "note ": what to remember about the end of the try */
  last: string;
  /** criterion 3's subject: "the screen or button inside the app" */
  where: string;
  conditions: string[];
  disallowed: string[];
  minutes: number;
}

export interface KindPlaybook {
  /** "a Telegram bot": the kind in a builder's words */
  label: string;
  /** what Sage itself looked at */
  sageRead: string;
  /** one plain line, shown to the builder: what Sage could and could not try, and who did the trying */
  honesty: string;
  /** true when Sage cannot use the product itself, so the first-try mission may be the whole plan */
  peopleDoTheTry: boolean;
  /** true when the only public page is a listing: quoting it proves reading, never trying */
  listingOnly: boolean;
  /** the short line the architect is told */
  architect: string;
  /** null for the kinds whose first try is the unchanged core mission */
  firstTry: FirstTryWords | null;
}

const NO_MONEY = ["Do not pay for anything", "Do not share a password or a recovery phrase"];
const OWN_WORDS = "judged as each tester's own account, in their own words, never by quoting a page: quoting the listing proves reading it, not trying the product";

export const KIND_PLAYBOOK: Record<ProductKind, KindPlaybook> = {
  website: { label: "a website", sageRead: "the site, in its own browser", honesty: "", peopleDoTheTry: false, listingOnly: false, architect: "", firstTry: null },
  single_page_app: {
    label: "a single-page app",
    sageRead: "the app, in its own browser",
    honesty: "",
    peopleDoTheTry: false,
    listingOnly: false,
    architect: "a single-page app (often made with an AI app builder): it has one address, so its flows are screens and states, not pages. Design from the observed states and controls.",
    firstTry: null,
  },
  wallet_dapp: {
    label: "a dapp behind Connect wallet",
    sageRead: "the screens before the wallet prompt, and the product's own documentation where it found any",
    honesty: "Sage has no wallet, so it stopped at Connect wallet: it saw the screens before it and read what the product says comes after. People with their own wallet went further.",
    peopleDoTheTry: false,
    listingOnly: false,
    architect: "a dapp behind Connect wallet. Sage has no wallet and saw only what comes before the prompt. A tester has their own wallet: a mission may ask them to connect it and go as far as the step that asks for a signature or for funds, and stop there. Never ask for a signature, an approval, a transfer or a transaction hash.",
    firstTry: {
      place: "the first screen",
      look: "look at the first screen for about ten seconds. Do not connect anything yet.",
      defaultAction: "connect a wallet and get as far as the step that asks for a signature",
      how: (product, action, from) => `Now try to ${action}${from}. Connecting a wallet only shows ${product} your public address. Use a wallet with nothing in it you would mind losing (a new, empty one is best), and never type a recovery phrase or a private key anywhere.`,
      stop: "Stop at the first request to confirm anything in your wallet, or to add funds: that counts as where you stopped.",
      last: "the name of the screen or the words on the last button you used",
      where: "the screen or button",
      conditions: ["A computer or phone with a wallet that holds nothing you would mind losing (a new, empty one is best)", "No funds needed"],
      disallowed: ["Do not confirm a signature or a transaction in your wallet", "Do not add or move funds", "Never type a recovery phrase or a private key anywhere"],
      minutes: 8,
    },
  },
  telegram_bot: {
    label: "a Telegram bot",
    sageRead: "the bot's public Telegram page: its name and description",
    honesty: "Sage can't talk to a Telegram bot: it read the bot's public page, and people started the bot and used it.",
    peopleDoTheTry: true,
    listingOnly: true,
    architect: `a Telegram bot. Sage read only its public t.me page and cannot chat with it. Design a mission only for a command or feature that page names, ${OWN_WORDS}. With nothing distinct to design, answer {"missions":[]}: Sage's own first-try mission covers starting the bot.`,
    firstTry: {
      place: "the bot's Telegram page",
      look: "read the bot's name and description. Do not start it yet.",
      defaultAction: "start it and use its main command",
      how: (product, action) => `Now open ${product} in Telegram, press Start, and try to ${action}.`,
      stop: "If it asks for money, your phone number, or a wallet, stop there: that counts as where you stopped.",
      last: "the last command or button you used and what the bot replied",
      where: "the command, button or reply in the chat",
      conditions: ["A Telegram account"],
      disallowed: NO_MONEY,
      minutes: 6,
    },
  },
  telegram_mini_app: {
    label: "a Telegram mini app",
    sageRead: "the bot's public Telegram page: its name and description",
    honesty: "Sage can't open a Telegram mini app: it read the bot's public page, and people opened the app inside Telegram and used it.",
    peopleDoTheTry: true,
    listingOnly: true,
    architect: `a Telegram mini app. Sage read only the bot's public t.me page and cannot open the app. Design a mission only for a feature that page names, ${OWN_WORDS}. With nothing distinct to design, answer {"missions":[]}: Sage's own first-try mission covers opening the app.`,
    firstTry: {
      place: "the bot's Telegram page",
      look: "read the name and description. Do not open the app yet.",
      defaultAction: "open the app and do the first thing it offers",
      how: (product, action) => `Now open ${product} in Telegram, open its app, and try to ${action}.`,
      stop: "If it asks for money, your phone number, or to confirm anything in a wallet, stop there: that counts as where you stopped.",
      last: "the name of the screen or the words on the last button you used",
      where: "the screen or button inside the app",
      conditions: ["A Telegram account on a phone or the desktop app"],
      disallowed: [...NO_MONEY, "Do not confirm a wallet request"],
      minutes: 7,
    },
  },
  discord_bot: {
    label: "a Discord bot",
    sageRead: "the bot's public page",
    honesty: "Sage can't add a bot to a Discord server or talk to it: it read the bot's public page, and people added it to a server of their own and used it.",
    peopleDoTheTry: true,
    listingOnly: true,
    architect: `a Discord bot. Sage read only its public page and cannot use Discord. Design a mission only for a command that page names, ${OWN_WORDS}. With nothing distinct to design, answer {"missions":[]}.`,
    firstTry: {
      place: "the bot's page",
      look: "read what the bot says it does and which permissions it asks for. Do not add it yet.",
      defaultAction: "add it to a test server and run its main command",
      how: (product, action) => `Now add ${product} to a Discord server you own (a new, empty one is fine) and try to ${action}.`,
      stop: "If it asks for permissions you would not give, or for money, stop there: that counts as where you stopped.",
      last: "the last command you ran and what the bot replied",
      where: "the command or reply",
      conditions: ["A Discord account", "A server where you may add a bot (your own test server is fine)"],
      disallowed: NO_MONEY,
      minutes: 8,
    },
  },
  community: {
    label: "a community (a Discord server or a Telegram channel or group)",
    sageRead: "the public invite page: its name and description",
    honesty: "Sage can't join a chat community: it read the public invite page, and people joined and looked around.",
    peopleDoTheTry: true,
    listingOnly: true,
    architect: `a chat community. Sage read only the public invite page and cannot join. Missions are ${OWN_WORDS}. With nothing distinct to design, answer {"missions":[]}.`,
    firstTry: {
      place: "the invite page",
      look: "read the name and description. Do not join yet.",
      defaultAction: "join and find where a newcomer is meant to start",
      how: (_product, action) => `Now try to ${action}.`,
      stop: "If joining asks for a payment or for more than your chat account, stop there: that counts as where you stopped.",
      last: "the name of the channel or the pinned message where you ended up",
      where: "the channel, message or step",
      conditions: ["A Discord or Telegram account, whichever the invite is for"],
      disallowed: NO_MONEY,
      minutes: 6,
    },
  },
  code_repo: {
    label: "a code repository",
    sageRead: SIGHT.github_repo.sees,
    honesty: "Sage does not run code from a repository: it read the README and the file list, and people followed the README on their own machines.",
    peopleDoTheTry: true,
    listingOnly: false,
    architect: `a code repository. Sage read ${SIGHT.github_repo.sees}; it does not clone, install or run anything. The flows are: following the README's quickstart to a working result, running an example the README names, finding how to do one named thing in it. A tester reports the commands they ran and what was printed, in their own words. Never ask for a recording or a file.`,
    firstTry: {
      place: "the repository's README",
      look: "read the README for about a minute. Do not install anything yet.",
      defaultAction: "follow the README's quickstart until it runs",
      how: (_product, action) => `Now, on your own computer, try to ${action}, using only what the README tells you, without administrator rights and without any real key or password of yours.`,
      stop: "If it needs a paid service, a secret you do not have, or an hour of setup, stop there: that counts as where you stopped.",
      last: "the last command you ran and the first line of what it printed",
      where: "the step of the README or the command",
      conditions: ["A computer where you can install developer tools", "Comfortable with a terminal"],
      disallowed: ["Do not run it with administrator rights unless the README says why", "Do not put a real key or token in your answer"],
      minutes: 15,
    },
  },
  package: {
    label: "a package",
    sageRead: "the package's public page: its description and README",
    honesty: "Sage does not install or run packages: it read the package page, and people installed it and ran its first example.",
    peopleDoTheTry: true,
    listingOnly: false,
    architect: "a package on a public registry. Sage read its page (description, README, install line); it does not install or run anything. The flows are: installing it and running the README's first example, and doing one named thing its README describes. A tester reports the commands they ran and what was printed, in their own words. Never ask for a recording or a file.",
    firstTry: {
      place: "the package page",
      look: "read its description and README for about a minute. Do not install anything yet.",
      defaultAction: "install it and run the first example in its README",
      how: (_product, action) => `Now, on your own computer, try to ${action}, using only what the page tells you, and without any real key or password of yours.`,
      stop: "If it needs a paid service or a secret you do not have, stop there: that counts as where you stopped.",
      last: "the last command you ran and the first line of what it printed",
      where: "the step of the README or the command",
      conditions: ["A computer with the language's tools installed (the page says which)", "Comfortable with a terminal"],
      disallowed: ["Do not put a real key or token in your answer"],
      minutes: 12,
    },
  },
  api: {
    label: "an API",
    sageRead: "the public pages and documentation",
    honesty: "Sage has no API key, so it made no calls: it read the public pages and documentation, and people followed the quickstart with a key of their own.",
    peopleDoTheTry: false,
    listingOnly: false,
    architect: "an API product. Sage read the public pages and documentation; it has no key and made no calls. The flows are: getting a key, following the quickstart to a first successful call, and finding how to do one named thing in the reference. A tester reports the request they made and what came back, in their own words. Never ask them to share a key.",
    firstTry: {
      place: "the first screen",
      look: "look at the first screen for about ten seconds. Do not sign up yet.",
      defaultAction: "follow the quickstart to a first successful call",
      how: (_product, action, from) => `Now try to ${action}${from}, with a key of your own if it gives you one free.`,
      stop: "If it asks for a card or for money before a first call, stop there: that counts as where you stopped.",
      last: "the last step of the quickstart you reached and what came back (a status or the first line of the reply)",
      where: "the step of the quickstart or the call",
      conditions: ["Comfortable with a terminal or an HTTP client", "An email you are willing to sign up with"],
      disallowed: ["Do not pay for anything", "Do not put your key in your answer"],
      minutes: 15,
    },
  },
  mobile_app: {
    label: "a mobile app",
    sageRead: "the store listing: its name, description and what it says the app does",
    honesty: "Sage can't run a phone app itself: it read the store listing, and people installed the app and tried it.",
    peopleDoTheTry: true,
    listingOnly: true,
    architect: `a mobile app. Sage read only its store listing and cannot install or run it. Design a mission only for a feature the listing names, ${OWN_WORDS}. With nothing distinct to design, answer {"missions":[]}: Sage's own first-try mission covers installing it and reaching its main screen.`,
    firstTry: {
      place: "the store listing",
      look: "read the listing for about a minute. Do not install anything yet.",
      defaultAction: "open it and reach its main screen",
      how: (product, action) => `Now install ${product} on your own phone and try to ${action}.`,
      stop: "If your phone warns you about the app, or it asks for money, a card, or an account you do not want to make, stop there: that counts as where you stopped.",
      last: "the name of the screen or the words on the last button you used",
      where: "the screen or button inside the app",
      conditions: ["Your own phone of the kind the listing is for", "Room and a connection to install an app"],
      disallowed: NO_MONEY,
      minutes: 10,
    },
  },
  browser_extension: {
    label: "a browser extension",
    sageRead: "the store listing: its name, description and what it says the extension does",
    honesty: "Sage can't install a browser extension: it read the store listing, and people installed it and tried it.",
    peopleDoTheTry: true,
    listingOnly: true,
    architect: `a browser extension. Sage read only its store listing and cannot install it. Design a mission only for a feature the listing names, ${OWN_WORDS}. With nothing distinct to design, answer {"missions":[]}.`,
    firstTry: {
      place: "the store listing",
      look: "read the listing for about a minute, including what it asks permission for. Do not install anything yet.",
      defaultAction: "open it from the toolbar and do the first thing it offers",
      how: (product, action) => `Now install ${product} in your own browser and try to ${action}.`,
      stop: "If your browser warns you about it, or it asks for permissions you would not give, an account you do not want to make, or money, stop there: that counts as where you stopped.",
      last: "the name of the screen or the words on the last button you used",
      where: "the screen or button of the extension",
      conditions: ["A desktop browser the listing is for"],
      disallowed: NO_MONEY,
      minutes: 8,
    },
  },
  desktop_app: {
    label: "a desktop app",
    sageRead: "the download page",
    honesty: "Sage does not download or run installers: it read the download page, and people installed the app on their own computers.",
    peopleDoTheTry: true,
    listingOnly: true,
    architect: `a desktop app offered as a download. Sage read the download page and does not download or run installers. Design a mission only for a feature that page names, ${OWN_WORDS}. With nothing distinct to design, answer {"missions":[]}.`,
    firstTry: {
      place: "the download page",
      look: "read the page for about a minute. Do not download anything yet.",
      defaultAction: "open it and reach its main window",
      how: (product, action) => `Now download and install ${product} on your own computer and try to ${action}.`,
      stop: "If your computer warns that it cannot check the app, or it asks for money or an account you do not want to make, stop there: that counts as where you stopped.",
      last: "the name of the window or the words on the last button you used",
      where: "the window or button inside the app",
      conditions: ["A computer the download supports (the page says which)"],
      disallowed: [...NO_MONEY, "Do not switch off your computer's safety checks to install it"],
      minutes: 12,
    },
  },
  waitlist: {
    label: "a waitlist page",
    sageRead: "the page",
    honesty: "There is nothing to try yet: Sage read the waitlist page, and people said what they took it to be and whether they would sign up.",
    peopleDoTheTry: true,
    listingOnly: false,
    architect: `a waitlist or pre-launch page with no product to use yet. Do not design missions about using a product that does not exist. Answer {"missions":[]} unless the page has a real interactive part (a calculator, a demo): Sage's own first-try mission asks what strangers take it to be and whether they would sign up.`,
    firstTry: {
      place: "the page",
      look: "look at it for about ten seconds without scrolling.",
      defaultAction: "decide whether to join the waitlist",
      how: (_product, action) => `Now read the rest of the page and try to ${action}. Joining is your choice: nobody is asked to give an email.`,
      stop: "If you cannot tell what you would be signing up for, that counts as where you stopped.",
      last: "the part of the page where you made up your mind, or gave up",
      where: "the part of the page",
      conditions: ["A phone or a computer with a normal browser"],
      disallowed: ["You do not have to give your email"],
      minutes: 5,
    },
  },
  ai_chat: {
    label: "an AI chat product",
    sageRead: "the first screen and what it could reach without an account",
    honesty: "Sage opened the chat and saw its first screen; it does not judge whether an AI's answers are good. People asked it real questions and said how the answers held up.",
    peopleDoTheTry: false,
    listingOnly: false,
    architect: "an AI chat product: its main action is a conversation. Sage saw the first screen and does not judge answer quality. A mission asks a tester to ask a specific kind of question the product says it handles and to report, in their own words, what they asked and what was right or wrong in the reply. Never anchor on the wording of a reply: replies differ every time.",
    firstTry: {
      place: "the first screen",
      look: "look at the first screen for about ten seconds. Do not type anything yet.",
      defaultAction: "ask it one real question of the kind it says it is for",
      how: (_product, action, from) => `Now try to ${action}${from}, then ask one follow-up.`,
      stop: "If it asks for money or an account you do not want to make before it answers, stop there: that counts as where you stopped.",
      last: "what you asked and, in a sentence, what it answered",
      where: "the question asked and the reply",
      conditions: ["A phone or a computer with a normal browser"],
      disallowed: [...NO_MONEY, "Do not type anything private into the chat"],
      minutes: 8,
    },
  },
  design_prototype: {
    label: "a design prototype",
    sageRead: `the prototype as its browser showed it (as a proof link, a Figma file shows Sage only ${SIGHT.design.sees})`,
    honesty: "A prototype is a picture of a product: Sage opened it and recorded what its browser showed, and people clicked through it.",
    peopleDoTheTry: true,
    listingOnly: true,
    architect: `a clickable design prototype, not a working product. Missions are ${OWN_WORDS}. Never ask a tester to create anything or to produce a link. With nothing distinct to design, answer {"missions":[]}.`,
    firstTry: {
      place: "the prototype's first screen",
      look: "look at the first screen for about ten seconds. Do not click anything yet.",
      defaultAction: "click through its main flow from the first screen to the last",
      how: (_product, action, from) => `Now try to ${action}${from}. Click where you would expect a real product to respond.`,
      stop: "If nothing responds where you click, that counts as where you stopped.",
      last: "the name of the last screen you reached, or the thing you clicked that did nothing",
      where: "the screen or the control",
      conditions: ["A computer with a normal browser (prototypes are hard to use on a phone)"],
      disallowed: [],
      minutes: 6,
    },
  },
  video_demo: {
    label: "a recorded demo",
    sageRead: SIGHT.video.sees,
    honesty: "Sage reads a recording's title and description, never its picture or sound: people watched it and said what they took the product to be.",
    peopleDoTheTry: true,
    listingOnly: true,
    architect: `a recorded demo, not a product a tester can use. Sage read ${SIGHT.video.sees}. Missions are ${OWN_WORDS}. With nothing distinct to design, answer {"missions":[]}: Sage's own first-try mission asks what viewers take the product to be.`,
    firstTry: {
      place: "the demo's page",
      look: "read its title and description. Do not press play yet.",
      defaultAction: "watch the demo to the end",
      how: (_product, action) => `Now try to ${action}, at normal speed.`,
      stop: "If you stop watching early, that counts as where you stopped: say roughly how many minutes in.",
      last: "the moment (roughly, in minutes) where you understood what it does, or lost the thread",
      where: "the moment in the demo",
      conditions: ["A phone or a computer with sound"],
      disallowed: [],
      minutes: 6,
    },
  },
};

export const playbookOf = (kind: ProductKind | null | undefined): KindPlaybook => KIND_PLAYBOOK[kind ?? "website"] ?? KIND_PLAYBOOK.website;

/* ─────────────────────────────────────────── what a tester reads before a place ── */

/** The one line every tester reads, whatever the product. */
export const NEVER_A_SECRET = "Never type a recovery phrase or a private key anywhere. No real product asks for one, and no test on Sage does.";
const INSTALLS: readonly ProductKind[] = ["mobile_app", "browser_extension", "desktop_app"];
const RUNS_CODE: readonly ProductKind[] = ["code_repo", "package"];

/**
 * WHAT A TESTER READS BEFORE TAKING A PLACE (22 Nov 2026). Short, calm, and the same on every test of a
 * kind: Sage screens the product (src/lib/safety/), and these lines are what protects a tester when a screen
 * is wrong. A mission's `conditions` and `disallowed` are never shown to a tester, so the page says these.
 */
export function testerCautions(kind: ProductKind | null | undefined): string[] {
  const k = kind ?? "website";
  if (k === "wallet_dapp") {
    return [NEVER_A_SECRET, "Use a wallet with nothing in it you would mind losing. A new, empty one is best.", "Stop at the first request to confirm anything in your wallet. Stopping there earns the same."];
  }
  if (INSTALLS.includes(k)) {
    return [NEVER_A_SECRET, "Install it only from the address the mission names. If your phone, browser or computer warns you about it, stop there. Stopping there earns the same."];
  }
  if (RUNS_CODE.includes(k)) {
    return [NEVER_A_SECRET, "Run it only as its own page says, without administrator rights and without any real key or password of yours."];
  }
  return [NEVER_A_SECRET];
}

/** The kind a stored product map carries, read defensively (older maps carry none: a website). */
export function kindOfMap(map: { productKind?: unknown } | null | undefined): ProductKind {
  const k = (map?.productKind as { kind?: unknown } | null | undefined)?.kind;
  return typeof k === "string" && (PRODUCT_KINDS as readonly string[]).includes(k) ? (k as ProductKind) : "website";
}

/**
 * What Sage READ, where it could not use the product itself ("the store listing"); null where it tried the
 * product in its browser. The page says "Sage read the store listing", never "Sage tried it", about a phone app.
 * Before the map exists, the address alone answers for the kinds an address decides.
 */
export function sageReadsOnly(map: { productKind?: unknown } | null | undefined, url: string): string | null {
  const kind = map ? kindOfMap(map) : (kindFromUrl(url)?.kind ?? "website");
  const p = playbookOf(kind);
  return p.peopleDoTheTry ? (p.firstTry?.place ?? null) : null;
}

/** The one line a builder reads about what Sage could and could not try. Empty for an ordinary site. */
export function kindHonestyLine(map: { productKind?: unknown } | null | undefined): string {
  return playbookOf(kindOfMap(map)).honesty;
}

/** The line the architect and the core-place question are told. Empty for an ordinary site. */
export function kindLineFor(map: { productKind?: unknown } | null | undefined): string {
  const p = playbookOf(kindOfMap(map));
  return p.architect ? `PRODUCT KIND (decided by Sage from the address and what it saw; trusted): ${p.architect}` : "";
}

/* ───────────────────────────────────────────────── proof Sage can actually read ── */

const CHAT_PROOF = /\b(?:link|url|address)\b[^.\n]{0,60}\b(?:telegram|t\.me|discord|whatsapp|slack)\b|\b(?:telegram|t\.me|discord|whatsapp|slack)\b[^.\n]{0,40}\b(?:message|chat|conversation|thread)\s+(?:link|url)\b|\bmessage link\b|\bforward(?:ed|s)? (?:the|a|your) (?:message|chat)\b/i;
const CHAIN_PROOF = /\b(?:transaction|tx)\s+(?:hash|id|link)\b|\bexplorer link\b/i;
const KEY_PROOF = /\b(?:your|the|their) (?:api[\s-]?key|access token|secret)\b[^.\n]{0,30}\b(?:in|with) (?:your|the) (?:answer|submission)\b/i;

/**
 * Does this mission ask for a proof Sage cannot read, given the kind? Null when it is checkable.
 *
 * The gate (validate-mission.ts) already refuses a picture, a recording, a file and a signed-in page for every
 * product. This adds what only the kind can know:
 *   - a chat is not a page: a "link to the Telegram message" or a Discord thread opens nothing Sage can read
 *     (STORAGE_OR_APP_HOSTS, what-sage-sees.ts);
 *   - on a listing-only kind, the one public page is the listing, so a page-and-quote mission pays for
 *     reading it. Such a mission must be the tester's own account, judged, never auto-verified by URL;
 *   - a dapp mission must not need a transaction, so it can never need its hash;
 *   - nobody is asked to hand over a key.
 */
export function kindProofIssue(
  m: Pick<CandidateMission, "objective" | "criteria" | "evidenceRequirements" | "instructions">,
  kind: ProductKind,
  verifiability: "url-verifiable" | "observation-based",
): string | null {
  if (kind === "website") return null;
  const asks = `${m.criteria.join("\n")}\n${m.evidenceRequirements.join("\n")}`;
  const p = playbookOf(kind);
  const chat = CHAT_PROOF.exec(asks);
  if (chat) return `asks for "${chat[0].slice(0, 60)}": a chat is not a page Sage can open (${STORAGE_OR_APP_HOSTS.filter((h) => /t\.me|discord|whatsapp|slack/.test(h)).slice(0, 4).join(", ")}); ask what the tester did and saw instead`;
  if (kind === "wallet_dapp" && CHAIN_PROOF.test(asks)) return "asks for a transaction's hash: a tester is never asked to send a transaction, so there is none to give";
  if (KEY_PROOF.test(asks)) return "asks a tester to hand over a key";
  if (p.listingOnly && verifiability === "url-verifiable")
    return `would be checked by opening a page and matching a quote, and the only public page of ${p.label} is ${p.firstTry?.place ?? "its listing"}: that pays for reading it, not for trying the product. Ask for the tester's own account of what they did instead`;
  return null;
}
