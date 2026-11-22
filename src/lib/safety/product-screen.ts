import { domainToUnicode } from "node:url";
import type { FieldTestSummary, ProductObservation } from "@/lib/launch/schemas";
import { kindFromUrl, type ProductKind } from "@/lib/launch/product-kind";
import { BAIT_WORDS, BRANDS, PLATFORM_BAIT_WORDS, isBrandsOwn, registrable, type Brand } from "./brands";

/**
 * NEVER SEND A TESTER INTO HARM (22 Nov 2026).
 *
 * Sage pays strangers to try whatever a builder pastes: connect a wallet to a dapp, install an app, run a
 * repository's quickstart. The work policy (launch/work-policy.ts) refuses harmful WORK. This file screens
 * the PRODUCT: is the address a known phishing site, a copy of a well-known brand, a wallet drainer, a page
 * that asks for a recovery phrase, or a download shaped like malware?
 *
 * Deterministic, no model, no I/O. It reads only what Sage already has: the address, where it landed, what
 * the plain read and the field test saw, and the product kind. The lists that need a network (MetaMask's
 * phishing list, Google Safe Browsing, a domain's age) are looked up by the caller and handed in; with none
 * of them, every other check still runs.
 *
 * Three outcomes, conservative by default:
 *   clear    nothing found; the test runs as it always did.
 *   hold     suspicious, not certain. The builder's own invited people may still take part; the test is
 *            never shown to the public until a person at Sage has looked.
 *   refused  certain harm: on the phishing list, a recovery-phrase or private-key field, or a lookalike of
 *            a well-known brand that also asks for a wallet. No test, no launch, no funding.
 *
 * A false refusal is a failure too. Every rule is narrow, and prose that WARNS about a scam ("never share
 * your recovery phrase") is not the scam: only a field that asks, or words that ask, count.
 */

export type SafetyOutcome = "clear" | "hold" | "refused";

export const SAFETY_SIGNALS = [
  "phishing_list",
  "safe_browsing",
  "lookalike",
  "near_miss_name",
  "bait_address",
  "drainer_words",
  "secret_field",
  "asks_for_secret",
  "download_elsewhere",
  "archive_password",
  "safety_checks_off",
  "new_domain",
] as const;
export type SafetySignalId = (typeof SAFETY_SIGNALS)[number];

export interface SafetySignal {
  id: SafetySignalId;
  /** what this signal does by itself */
  severity: "hold" | "refuse";
  /** one plain sentence, written to be read by the builder: what Sage noticed, never what it concludes */
  reason: string;
  /** the exact thing seen (a host, a field's name, a few words), for the operator */
  seen: string;
}

export interface ProductSafetyRecord {
  version: 1;
  outcome: SafetyOutcome;
  /**
   * What a person's review is about: the host, or on a shared platform the product's own page there
   * ("t.me/some_bot", "github.com/owner/repo"), so clearing one bot never clears Telegram.
   */
  subject: string;
  /** the host the builder pasted, and any other host Sage landed on */
  host: string;
  hosts: string[];
  signals: SafetySignal[];
  /** which outside lists answered: a clear from a screen that could not read a list says so */
  lists: { phishing: ListState; safeBrowsing: ListState; domainAge: ListState };
  /** a person at Sage overrode the screen for this host */
  reviewed?: { decision: "cleared" | "refused"; at: number } | null;
  checkedAt: number;
}
export type ListState = "checked" | "unavailable" | "off";

/** MetaMask's eth-phishing-detect config, as published (config.json). */
export interface PhishingConfig {
  version?: number;
  tolerance: number;
  fuzzylist: string[];
  whitelist: string[];
  blacklist: string[];
}
/** The same list, ready to ask: sets, and the fuzzylist without its endings. */
export interface PhishingList {
  blacklist: ReadonlySet<string>;
  whitelist: ReadonlySet<string>;
  fuzzy: readonly string[];
  tolerance: number;
  fetchedAt: number;
}
export function compilePhishingList(config: PhishingConfig, fetchedAt = 0): PhishingList {
  const lower = (xs: unknown): string[] => (Array.isArray(xs) ? xs.filter((x): x is string => typeof x === "string").map((x) => x.toLowerCase().replace(/^www\./, "")) : []);
  return {
    blacklist: new Set(lower(config.blacklist)),
    whitelist: new Set(lower(config.whitelist)),
    fuzzy: lower(config.fuzzylist).map((d) => d.split(".").slice(0, -1).join(".")).filter(Boolean),
    tolerance: typeof config.tolerance === "number" && config.tolerance >= 0 && config.tolerance <= 3 ? config.tolerance : 1,
    fetchedAt,
  };
}

/** Does a list name this host, or a domain it sits under? ("a.b.evil.xyz" is on a list that names "evil.xyz") */
function onList(host: string, list: ReadonlySet<string>): string | null {
  const labels = host.split(".");
  for (let i = 0; i < labels.length - 1; i++) {
    const candidate = labels.slice(i).join(".");
    if (list.has(candidate)) return candidate;
  }
  return null;
}

/**
 * What MetaMask's list says about one host: its own order (whitelist, then blacklist, then a near-miss of a
 * fuzzylist name within the list's tolerance).
 */
export function phishingVerdict(hostRaw: string, list: PhishingList): { verdict: "listed" | "allowed" | "near" | "none"; match: string | null } {
  const host = hostRaw.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
  const allowed = onList(host, list.whitelist);
  if (allowed) return { verdict: "allowed", match: allowed };
  const listed = onList(host, list.blacklist);
  if (listed) return { verdict: "listed", match: listed };
  const name = registrable(host).own.slice(-1)[0] ?? "";
  if (name.length >= 6) {
    for (const f of list.fuzzy) {
      const target = f.split(".").slice(-1)[0] ?? f;
      if (name !== target && editDistance(name, target, list.tolerance) <= list.tolerance) return { verdict: "near", match: f };
    }
  }
  return { verdict: "none", match: null };
}

/* ───────────────────────────────────────────────────────────── lookalikes ── */

/** Letters from other alphabets that are drawn like a Latin one. Short on purpose: the ones phishers use. */
const CONFUSABLE: Record<string, string> = {
  "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "х": "x", "у": "y", "і": "i", "ѕ": "s", "ԁ": "d", "ӏ": "l", "һ": "h", "ј": "j", "ԛ": "q", "ԝ": "w", "к": "k", "м": "m", "т": "t", "в": "b", "н": "h",
  "α": "a", "ο": "o", "ν": "v", "ρ": "p", "τ": "t", "ι": "i", "κ": "k", "ε": "e", "υ": "u", "χ": "x", "β": "b",
  "ɡ": "g", "ı": "i", "ł": "l", "ø": "o", "ß": "b", "đ": "d", "ħ": "h",
};
const LEET: Record<string, string> = { "0": "o", "1": "l", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b" };

/** A label as a reader would take it: other alphabets' lookalike letters and accents folded onto plain Latin. */
function foldLetters(s: string): string {
  let out = "";
  for (const ch of s.normalize("NFKD")) {
    if (/[̀-ͯ]/.test(ch)) continue;
    out += CONFUSABLE[ch] ?? ch;
  }
  return out.toLowerCase();
}
/** A word with its digits read as the letters they stand in for. A "1" is an l or an i, so both are tried. */
function foldDigits(s: string): string[] {
  const base = s.replace(/[034578]/g, (d) => LEET[d] ?? d).replace(/rn/g, "m").replace(/vv/g, "w");
  return [base.replace(/1/g, "l"), base.replace(/1/g, "i")];
}

/** Edit distance where two neighbouring letters swapped count once ("metamsak"). Short strings only. */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2]![j - 2]! + 1);
      d[i]![j] = v;
    }
  }
  return d[a.length]![b.length]!;
}
/** Ordinary words one letter from a brand: never a near miss of it. */
const ORDINARY_NEAR = new Set(["telegraf", "telegraaf", "telegrams", "facebooks", "instagrams", "metatask", "metamark", "metacask"]);

export interface Lookalike {
  brand: Brand;
  /** how the address imitates it */
  how: "other_alphabet" | "digits_for_letters" | "brand_with_bait" | "brands_domain_inside" | "near_miss" | "brand_on_other_ending";
  /** strong imitations refuse a wallet dapp; a near miss or a bare name only ever holds */
  strong: boolean;
  seen: string;
}

/**
 * Is this name an imitation of a well-known brand? `own` is the labels a registrant chose (a host's labels
 * left of its public suffix, or a platform handle split into words). Null when it is the brand's own
 * address, or imitates nothing.
 */
function lookalikeOfLabels(own: readonly string[], display: string, hadOtherAlphabet: boolean): Lookalike | null {
  const folded = own.map(foldLetters);
  const tokens = folded.flatMap((l) => l.split(/[^a-z0-9]+/)).filter(Boolean);
  const joined = folded.join(".");
  const dashed = tokens.join("-");
  const name = folded[folded.length - 1] ?? "";

  for (const brand of BRANDS) {
    const n = brand.name;
    const bait = brand.platform ? PLATFORM_BAIT_WORDS : BAIT_WORDS;
    const hasBait = tokens.some((t) => bait.includes(t));
    const baitInside = (rest: string): boolean => bait.some((w) => w.length >= 5 && rest.includes(w));
    // 1. written in another alphabet, and reads as the brand
    if (hadOtherAlphabet && (tokens.includes(n) || (brand.distinctive && joined.includes(n)))) return { brand, how: "other_alphabet", strong: true, seen: display };
    // 2. the brand's real domain, spelled inside someone else's address ("metamask.io.secure-login.xyz", "metamask-io.xyz")
    for (const d of brand.domains) {
      if (d.split(".")[0]!.length < 4) continue;
      if (joined === d || joined.includes(`${d}.`) || joined.endsWith(`.${d}`) || `-${dashed}-`.includes(`-${d.replace(/\./g, "-")}-`)) return { brand, how: "brands_domain_inside", strong: true, seen: display };
    }
    const whole = tokens.includes(n);
    const within = brand.distinctive ? tokens.find((t) => t !== n && t.includes(n)) : undefined;
    // 3. digits for letters ("m3tamask", "un1swap", "paypa1")
    if (!whole && !within && n !== "1inch") {
      const hit = tokens.find((t) => /[0-9]|rn|vv/.test(t) && !/^\d+$/.test(t) && foldDigits(t).some((f) => f === n || (brand.distinctive && n.length >= 6 && f.includes(n))));
      if (hit) return { brand, how: "digits_for_letters", strong: true, seen: display };
    }
    // 4. the brand's name beside a bait word ("uniswap-claim", "metamasksupport")
    if (whole && hasBait) return { brand, how: "brand_with_bait", strong: true, seen: display };
    if (within && (hasBait || baitInside(within.replace(n, "")))) return { brand, how: "brand_with_bait", strong: true, seen: display };
    // 5. the bare brand name on an ending that is not the brand's ("metamask.app")
    if (brand.distinctive && name === n && own.length === 1) return { brand, how: "brand_on_other_ending", strong: false, seen: display };
    // 6. one letter off a coined name of eight letters or more ("metamsak", "coinbasse"). Shorter names have
    // too many honest neighbours: measured on MetaMask's own whitelist, "opensea" alone is one letter from
    // openseal, openseam, openset and opensee.
    if (brand.distinctive && n.length >= 8 && !whole) {
      const near = tokens.find((t) => t.length >= 6 && t !== n && !ORDINARY_NEAR.has(t) && editDistance(t, n, 1) <= 1);
      if (near) return { brand, how: "near_miss", strong: false, seen: display };
    }
  }
  return null;
}

/**
 * Words an address is given to promise free money. Measured 22 Nov 2026: as a whole word of the address,
 * "claim" is on MetaMask's list 1,033 times and "airdrop" 325, and neither appears once in the 100,000 most
 * visited sites. Real projects do run claim pages on such addresses, so this holds and never refuses, and
 * only when the page also asks for a wallet.
 */
const BAIT_ADDRESS = new Set(["claim", "claims", "airdrop", "airdrops", "allocation", "allocations", "eligibility", "giveaway", "presale"]);
export function baitWordInHost(hostRaw: string): string | null {
  const { own } = registrable(hostRaw.toLowerCase());
  return own.flatMap((l) => l.split(/[^a-z0-9]+/)).find((t) => BAIT_ADDRESS.has(t)) ?? null;
}

/** A host's lookalike, if it has one. A brand's own domains, and anything under them, never match. */
export function lookalikeOfHost(hostRaw: string): Lookalike | null {
  const ascii = hostRaw.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
  if (!ascii || /^[\d.]+$/.test(ascii) || ascii.includes(":")) return null;
  if (BRANDS.some((brand) => isBrandsOwn(ascii, brand))) return null;
  const punycode = /(^|\.)xn--/.test(ascii);
  let unicode = ascii;
  if (punycode) {
    try {
      unicode = domainToUnicode(ascii) || ascii;
    } catch {
      unicode = ascii;
    }
  }
  const hadOtherAlphabet = punycode || /[^\x00-\x7f]/.test(unicode);
  const { own } = registrable(unicode);
  if (own.length === 0) return null;
  return lookalikeOfLabels(own, unicode === ascii ? ascii : `${unicode} (${ascii})`, hadOtherAlphabet);
}

/** A platform handle ("Uniswap_Support_bot") read the same way: only a brand beside a bait word counts. */
export function lookalikeOfHandle(handle: string): Lookalike | null {
  const words = foldLetters(handle.replace(/^@/, "")).split(/[^a-z0-9]+/).filter(Boolean);
  if (words.length === 0) return null;
  const hit = lookalikeOfLabels([words.join("-")], handle, /[^\x00-\x7f]/.test(handle));
  return hit && (hit.how === "brand_with_bait" || hit.how === "digits_for_letters" || hit.how === "other_alphabet") ? hit : null;
}

/* ─────────────────────────────────────────────────────── what the page says ── */

const WALLET_ASK = /\bconnect(?:\s+(?:a|your|my))?\s+wallet\b|\bconnect metamask\b|\bwallet\s?connect\b|\bconnect-wallet required\b|\b(?:launch|enter|open) dapp\b|\blink (?:your )?wallet\b/i;
const CRYPTO_WORDS = /\b(?:wallet|crypto|web3|blockchain|ethereum|solana|bitcoin|token|nft|defi|metamask|ledger|airdrop|staking|dapp)\b/i;

/**
 * Words a wallet drainer puts on the screen that asks to connect. Each is a tool or a hurry no real dapp
 * needs: "validate your wallet", "sync wallet", "rectify", "revoke now", "claim your airdrop", a countdown
 * on a free mint. "Claim rewards" on a staking page is ordinary and is not here.
 */
const DRAINER: { re: RegExp; says: string }[] = [
  { re: /\b(?:validate|synchroni[sz]e|sync|rectify|re-?verify)\s+(?:your\s+|my\s+)?wallets?\b|\bwallets?\s+(?:validation|synchroni[sz]ation|rectification|restoration)\b|\bdapps?\s+(?:rectif\w+|fixer)\b|\brectif(?:y|ication)\s+(?:issue|problem|tool|protocol)s?\b/i, says: "wording about validating, syncing or rectifying a wallet" },
  { re: /\bclaim\s+(?:your|my|the)?\s*(?:free\s+)?(?:airdrops?|\$?[A-Z]{2,8}\s+airdrop)\b|\beligible\s+(?:for|to\s+claim)\s+(?:an?\s+|the\s+|your\s+)?(?:airdrop|tokens?|allocation)\b|\bairdrop\s+(?:is\s+)?(?:live|ends|ending|closes)\b/i, says: "an airdrop to claim" },
  { re: /\bfree\s+mint\s+(?:ends|ending|closes|expires)\b|\b(?:mint|claim|airdrop|bonus|offer)\b[^.\n]{0,30}\b(?:ends|expires|closes)\s+in\s+\d+\s*(?:m|min|mins|minutes|h|hrs?|hours?)\b|\bonly\s+\d+\s+(?:free\s+)?(?:mints?|claims?)\s+left\b/i, says: "a countdown or a hurry" },
  { re: /\brevoke\s+(?:now|immediately|all)\b|\byour\s+wallet\s+(?:is|has\s+been|may\s+be)\s+(?:compromised|at\s+risk|flagged|suspended)\b|\bsecure\s+your\s+(?:assets|funds)\s+now\b/i, says: "an urgent warning about the visitor's wallet" },
  { re: /\b(?:double|2x|triple)\s+your\s+(?:eth|btc|sol|crypto|tokens?|deposit)\b|\bsend\s+[\d.]+\s*(?:eth|btc|sol|usdt|usdc)\b[^.\n]{0,40}\b(?:get|receive)\b|\bgiveaway\b/i, says: "a giveaway" },
];

/** A field that asks for the one thing no product may ask for. Read from a field's name, id, type or label. */
const SEED_FIELD = /\b(?:seed\s?(?:phrase|words?)|mnemonic\s?(?:phrase|words?)|recovery\s?(?:phrase|words?)|secret\s?(?:recovery\s?)?phrase|(?:12|24)\s?words?)\b/i;
/** Names that mean a recovery phrase only on a page about wallets ("seed" is also a garden and a game). */
const SEED_FIELD_IN_CRYPTO = /^(?:seed|seeds|mnemonic|mnemonics|phrase|keystore(?:\s?json)?|backup\s?phrase)$/i;
const KEY_FIELD = /\b(?:private\s?key|priv\s?key|wallet\s?key|secret\s?key)\b/i;
const fieldWords = (raw: string): string => raw.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_\-.[\]]+/g, " ").toLowerCase().trim();

/** Words that ASK for a secret, and are not a warning: "enter your 12-word recovery phrase". */
const ASKS_SECRET = /\b(?:enter|type|paste|input|provide|submit|import|fill\s+in)\s+(?:in\s+)?(?:your|the|a)?\s*(?:(?:12|24|twelve|twenty[\s-]four)[\s-]*word\s+)?(?:seed|recovery|secret\s+recovery|mnemonic|backup)\s+(?:phrase|words?)\b|\b(?:enter|type|paste|input|provide|submit|import)\s+(?:in\s+)?(?:your|the|a)?\s*(?:wallet(?:'s)?\s+)?private\s+key\b|\bimport\s+(?:your\s+)?wallet\s+(?:using|with)\s+(?:your\s+|a\s+)?(?:seed|recovery|private|mnemonic)/gi;
/**
 * ...nor the title of a help article: "How to import a recovery phrase into the X Wallet" explains a thing, it
 * does not ask for one. Measured on every stored plan: that one help-centre heading held a well-known exchange's
 * own app on 17 of its 24 inspections, the only product of 57 the screen stopped, and a false one. A page that
 * really asks still has the field, which is checked apart from these words.
 */
const HOW_TO_BEFORE = /\b(?:how\s+(?:to|do\s+i|can\s+i|do\s+you)|learn\s+(?:how\s+)?to|guide\s+to|steps?\s+to|instructions?\s+(?:for|to|on))\s+(?:safely\s+|securely\s+)?$/i;
const WARNING_BEFORE = /\b(?:never|don'?t|do\s+not|not|won'?t|will\s+never|no\s+one|nobody|should\s+not|shouldn'?t|without|instead\s+of|avoid|beware|scam\w*|phish\w*)\b[^.!?\n]{0,60}$/i;

const INSTALLER = /\.(?:exe|msi|dmg|pkg|apk|appimage|deb|rpm|bat|cmd|scr|ps1|jar|iso|msix|xapk)(?:$|[?#])/i;
const ARCHIVE = /\.(?:zip|rar|7z|tar\.gz|tgz)(?:$|[?#])/i;
/** Where real products host their downloads: stores, code hosts, and the big object stores behind most sites. */
const DOWNLOAD_HOSTS = [
  "github.com", "githubusercontent.com", "gitlab.com", "sourceforge.net", "apps.apple.com", "play.google.com", "microsoft.com", "apple.com",
  "amazonaws.com", "cloudfront.net", "googleapis.com", "storage.googleapis.com", "azureedge.net", "windows.net", "digitaloceanspaces.com", "r2.dev", "b-cdn.net",
  "todesktop.com", "electronjs.org", "npmjs.com", "pypi.org", "f-droid.org", "fastly.net", "akamaized.net", "cdn77.org", "jsdelivr.net",
  // the installers a page most often points at as something to have first
  "google.com", "nodejs.org", "python.org", "mozilla.org", "mozilla.net", "docker.com", "visualstudio.com", "jetbrains.com", "oracle.com", "java.com", "videolan.org", "brave.com", "git-scm.com", "rust-lang.org", "golang.org", "go.dev",
];
/** File lockers and chat attachments: where a product has no reason to keep its installer. */
const LOCKER_HOSTS = [
  "mediafire.com", "mega.nz", "mega.io", "dropbox.com", "dropboxusercontent.com", "drive.google.com", "docs.google.com", "anonfiles.com", "gofile.io", "pixeldrain.com",
  "catbox.moe", "transfer.sh", "wetransfer.com", "we.tl", "zippyshare.com", "4shared.com", "sendspace.com", "file.io", "1fichier.com", "krakenfiles.com", "workupload.com",
  "cdn.discordapp.com", "media.discordapp.net", "t.me", "telegra.ph", "bit.ly", "tinyurl.com", "cutt.ly", "rebrand.ly", "is.gd",
];
const onAny = (host: string, list: readonly string[]): boolean => list.some((d) => host === d || host.endsWith(`.${d}`));

const ARCHIVE_PASSWORD = /\b(?:archive|zip|rar|7z|file|installer|unzip|extract)\b[^.\n]{0,50}\bpass(?:word|code)?\b\s*(?:is\b|[:=-])\s*["'`]?[\w!@#$%^&*-]{3,24}|\bpass(?:word|code)?\b\s*(?:is\b|[:=-])\s*["'`]?[\w!@#$%^&*-]{3,24}[^.\n]{0,50}\b(?:archive|zip|rar|7z|unzip|extract)\b/i;
const SAFETY_OFF = /\b(?:disable|turn\s+off|switch\s+off|deactivate|pause|temporarily\s+disable)\s+(?:your\s+|the\s+|any\s+)?(?:anti-?virus|windows\s+defender|defender|real-?time\s+protection|smartscreen|gatekeeper|firewall|security\s+software)\b|\badd\s+(?:it|this|the\s+\w+)\s+to\s+(?:your\s+)?(?:anti-?virus|defender)\s+(?:exclusions?|exceptions?|whitelist)\b|\b(?:anti-?virus|defender)\s+may\s+(?:flag|block|detect)\b[^.\n]{0,60}\b(?:false\s+positive|ignore|disable|safe)\b|\bspctl\s+--master-disable\b/i;

const INSTALL_KINDS: readonly ProductKind[] = ["desktop_app", "browser_extension", "mobile_app", "code_repo", "package"];

export interface ScreenInput {
  url: string;
  observations: readonly ProductObservation[];
  fieldTest?: FieldTestSummary | null;
  kind: ProductKind;
  /** MetaMask's list, when the server has a copy; null when it could not be read */
  phishing?: PhishingList | null;
  /** what Google Safe Browsing said about the address: threat types, [] for none, null when not asked */
  safeBrowsing?: string[] | null;
  /** days since the domain was registered, when it could be learned */
  domainAgeDays?: number | null;
  now?: number;
}

function hostOfUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:" ? u.hostname.toLowerCase().replace(/\.$/, "").replace(/^www\./, "") : null;
  } catch {
    return null;
  }
}

/** What a review of this address is about (see `ProductSafetyRecord.subject`). Empty for no address at all. */
export function screenSubject(url: string): string {
  const host = hostOfUrl(url);
  if (!host) return "";
  const scope = kindFromUrl(url)?.scope?.pathPrefix ?? "";
  return scope && scope !== "/" ? `${host}${scope}`.toLowerCase() : host;
}

/** Every host this product showed Sage: the pasted one first, then wherever it landed. */
export function productHosts(input: Pick<ScreenInput, "url" | "observations" | "fieldTest">): string[] {
  const out: string[] = [];
  const add = (raw: string | null | undefined) => {
    const h = raw ? hostOfUrl(raw) : null;
    if (h && !out.includes(h)) out.push(h);
  };
  add(input.url);
  for (const o of input.observations) add(o.url);
  add(input.fieldTest?.startUrl);
  for (const p of input.fieldTest?.pages ?? []) add(p.url);
  for (const s of input.fieldTest?.states ?? []) add(s.url);
  return out.slice(0, 8);
}

const HOW_WORDS: Record<Lookalike["how"], string> = {
  other_alphabet: "it is written with letters from another alphabet that look the same",
  digits_for_letters: "it uses digits in place of letters",
  brand_with_bait: "it puts the name beside a word like claim, support or wallet",
  brands_domain_inside: "it spells the real address inside a different one",
  near_miss: "it is one letter away from the name",
  brand_on_other_ending: "it uses the name on an ending the brand does not use",
};

/** The screen. Pure: the same input always gives the same record. */
export function screenProduct(input: ScreenInput): ProductSafetyRecord {
  const signals: SafetySignal[] = [];
  const add = (s: SafetySignal) => {
    if (!signals.some((x) => x.id === s.id)) signals.push(s);
  };
  const hosts = productHosts(input);
  const host = hosts[0] ?? "";
  const platform = kindFromUrl(input.url);

  // what the page says, in two strengths: its controls, and all its text
  const obs = input.observations;
  const ft = input.fieldTest ?? null;
  const controls = [
    ...obs.flatMap((o) => [...o.ctas, ...o.forms.flatMap((f) => [f.label, ...f.fields])]),
    ...(ft?.pages ?? []).flatMap((p) => p.ctas),
    ...(ft?.states ?? []).flatMap((s) => s.notableElements.map((e) => e.text)),
  ].join(" • ");
  const text = [
    ...obs.flatMap((o) => [o.title, ...o.headings, ...o.claims, ...o.snippets]),
    ...(ft?.pages ?? []).flatMap((p) => [p.title, p.h1, p.visibleTextExcerpt ?? ""]),
    ...(ft?.states ?? []).map((s) => s.visibleTextExcerpt),
    controls,
  ].filter(Boolean).join("\n");
  const asksWallet = input.kind === "wallet_dapp" || WALLET_ASK.test(text) || /connect-wallet required/i.test(ft?.limitation ?? "");

  /* 1. a known phishing address (MetaMask's list; Google's when it was asked) */
  let allowedByList = false;
  if (input.phishing) {
    for (const h of hosts) {
      const v = phishingVerdict(h, input.phishing);
      if (v.verdict === "allowed" && h === host) allowedByList = true;
      if (v.verdict === "listed") add({ id: "phishing_list", severity: "refuse", reason: `${h} is on a public list of reported phishing addresses (MetaMask's)`, seen: v.match ?? h });
      if (v.verdict === "near" && !BRANDS.some((b) => isBrandsOwn(h, b))) add({ id: "near_miss_name", severity: "hold", reason: `${h} is spelled almost like ${v.match}, a name phishers often copy`, seen: `${h} ~ ${v.match}` });
    }
  }
  const threats = (input.safeBrowsing ?? []).filter(Boolean);
  if (threats.length > 0) {
    const certain = threats.some((t) => /SOCIAL_ENGINEERING|MALWARE/i.test(t));
    add({ id: "safe_browsing", severity: certain ? "refuse" : "hold", reason: `Google Safe Browsing lists ${host} as unsafe`, seen: threats.join(", ") });
  }

  /* 2. a lookalike of a well-known brand: the address itself, or a handle on a shared platform */
  if (!allowedByList) {
    let like: Lookalike | null = null;
    if (platform?.name && /^(?:telegram_bot|telegram_mini_app|community|discord_bot)$/.test(platform.kind)) like = lookalikeOfHandle(platform.name);
    else if (!platform) for (const h of hosts) like ??= lookalikeOfHost(h);
    if (like) {
      const refuse = like.strong && asksWallet;
      add({
        id: like.strong ? "lookalike" : "near_miss_name",
        severity: refuse ? "refuse" : "hold",
        reason: `${like.seen} looks like ${like.brand.label}'s name but is not one of ${like.brand.label}'s addresses: ${HOW_WORDS[like.how]}${refuse ? ", and it asks visitors to connect a wallet" : ""}`,
        seen: `${like.seen} ~ ${like.brand.name} (${like.how})`,
      });
    }
  }

  // an address named for free money, on a page that asks for a wallet
  if (asksWallet && !allowedByList && !platform && !signals.some((x) => x.id === "lookalike")) {
    const bait = hosts.map((h) => ({ h, w: baitWordInHost(h) })).find((x) => x.w && !BRANDS.some((b) => isBrandsOwn(x.h, b)));
    if (bait) add({ id: "bait_address", severity: "hold", reason: `the address ${bait.h} is named for a ${bait.w}, and the page asks visitors to connect a wallet`, seen: bait.h });
  }

  /* 3. a field that asks for a recovery phrase or a private key: no real product asks for one */
  const fields: { raw: string; words: string }[] = [
    ...obs.flatMap((o) => o.forms.flatMap((f) => [f.label, ...f.fields])),
    ...(ft?.pages ?? []).flatMap((p) => p.forms.flatMap((f) => f.fields)),
    ...(ft?.states ?? []).flatMap((s) => s.notableElements.filter((e) => /^(?:input|textarea)$/i.test(e.tag) || /textbox/i.test(e.role)).map((e) => e.text)),
  ].filter(Boolean).map((raw) => ({ raw, words: fieldWords(raw) }));
  // on a page about wallets it is certain; anywhere else (an account's own recovery phrase, an API's key) a person looks
  const crypto = asksWallet || CRYPTO_WORDS.test(text);
  const seed = fields.find((f) => SEED_FIELD.test(f.words) || (crypto && SEED_FIELD_IN_CRYPTO.test(f.words)));
  const wordBoxes = fields.filter((f) => /^(?:word|phrase|seed)\s?\d{1,2}$/.test(f.words)).length;
  const key = fields.find((f) => KEY_FIELD.test(f.words));
  if (seed || wordBoxes >= 12) add({ id: "secret_field", severity: crypto || wordBoxes >= 12 ? "refuse" : "hold", reason: "the page has a field that asks for a recovery phrase", seen: seed?.raw ?? `${wordBoxes} numbered word boxes` });
  else if (key) add({ id: "secret_field", severity: crypto ? "refuse" : "hold", reason: "the page has a field that asks for a private key", seen: key.raw });
  for (const m of text.matchAll(ASKS_SECRET)) {
    const before = text.slice(Math.max(0, (m.index ?? 0) - 80), m.index ?? 0);
    if (WARNING_BEFORE.test(before) || HOW_TO_BEFORE.test(before)) continue;
    add({ id: "asks_for_secret", severity: "hold", reason: "the page asks visitors to enter a recovery phrase or a private key", seen: m[0].slice(0, 80) });
    break;
  }

  /* 4. drainer wording on a screen that asks for a wallet */
  if (asksWallet) {
    const hit = DRAINER.map((d) => ({ d, m: d.re.exec(text) })).find((x) => x.m);
    if (hit?.m) add({ id: "drainer_words", severity: "hold", reason: `the screen that asks to connect a wallet also shows ${hit.d.says}`, seen: hit.m[0].slice(0, 80) });
  }

  /* 5. a download shaped like malware */
  const own = new Set(hosts.map((h) => registrable(h).domain));
  const related = (h: string): boolean => own.has(registrable(h).domain);
  const links: string[] = [];
  for (const o of obs) for (const l of o.links) {
    try {
      links.push(new URL(l, o.url).toString());
    } catch {
      /* not an address */
    }
  }
  // the pasted address itself can be the download
  if (INSTALLER.test(input.url) || ARCHIVE.test(input.url)) links.push(input.url);
  let hasArchive = false;
  for (const l of links) {
    const h = hostOfUrl(l);
    if (!h) continue;
    let path = l;
    try {
      path = new URL(l).pathname;
    } catch {
      /* keep the address */
    }
    const installer = INSTALLER.test(path);
    const archive = ARCHIVE.test(path);
    if (archive) hasArchive = true;
    if (!installer && !archive) continue;
    if (onAny(h, LOCKER_HOSTS)) add({ id: "download_elsewhere", severity: "hold", reason: `the download is kept on a file-sharing service (${h}), not with the product`, seen: l.slice(0, 160) });
    else if (installer && l !== input.url && !related(h) && !onAny(h, DOWNLOAD_HOSTS)) add({ id: "download_elsewhere", severity: "hold", reason: `the installer comes from ${h}, which is not the product's own address`, seen: l.slice(0, 160) });
  }
  const pw = ARCHIVE_PASSWORD.exec(text);
  if (pw && (hasArchive || /\b(?:zip|rar|7z|archive)\b/i.test(pw[0]))) add({ id: "archive_password", severity: "hold", reason: "the page gives a password for a download, which hides a file from safety checks", seen: pw[0].slice(0, 80) });
  const off = SAFETY_OFF.exec(text);
  if (off) add({ id: "safety_checks_off", severity: "hold", reason: "the page tells visitors to switch off their computer's safety checks", seen: off[0].slice(0, 80) });

  /* 6. a brand-new domain that asks for a wallet or an install */
  const age = input.domainAgeDays;
  if (!platform && typeof age === "number" && age >= 0 && age < NEW_DOMAIN_DAYS && (asksWallet || INSTALL_KINDS.includes(input.kind) || links.some((l) => INSTALLER.test(l)))) {
    add({ id: "new_domain", severity: "hold", reason: `${host} was registered ${age === 0 ? "today" : `${age} ${age === 1 ? "day" : "days"} ago`} and asks visitors ${asksWallet ? "to connect a wallet" : "to install something"}`, seen: `${age} days` });
  }

  const outcome: SafetyOutcome = signals.some((s) => s.severity === "refuse") ? "refused" : signals.length > 0 ? "hold" : "clear";
  return {
    version: 1,
    outcome,
    subject: screenSubject(input.url),
    host,
    hosts,
    signals,
    lists: {
      phishing: input.phishing ? "checked" : "unavailable",
      safeBrowsing: input.safeBrowsing === undefined ? "off" : input.safeBrowsing === null ? "unavailable" : "checked",
      domainAge: input.domainAgeDays === undefined ? "off" : input.domainAgeDays === null ? "unavailable" : "checked",
    },
    checkedAt: input.now ?? 0,
  };
}
export const NEW_DOMAIN_DAYS = 30;

/** A person at Sage looked at this host: their word replaces the screen's, and the signals stay on record. */
export function withReview(record: ProductSafetyRecord, decision: "cleared" | "refused" | null, at: number): ProductSafetyRecord {
  if (!decision) return record;
  return { ...record, outcome: decision === "cleared" ? "clear" : "refused", reviewed: { decision, at } };
}

/* ─────────────────────────────────────────────────────── what a builder reads ── */

const REVIEW = "If this is a mistake, tell us and a person at Sage will look.";

/**
 * The one calm line a builder reads. It says what Sage noticed and what happens next: never that the
 * builder did anything wrong. Empty when the product is clear.
 */
export function builderSafetyLine(record: Pick<ProductSafetyRecord, "outcome" | "signals" | "reviewed" | "host"> | null | undefined): string {
  if (!record || record.outcome === "clear") return "";
  const first = record.signals.find((s) => (record.outcome === "refused" ? s.severity === "refuse" : true)) ?? record.signals[0];
  const noticed = first ? first.reason : `a person at Sage reviewed ${record.host || "this address"}`;
  if (record.outcome === "refused") {
    return record.reviewed?.decision === "refused"
      ? `Sage can't run a test here: a person at Sage reviewed ${record.host || "this address"} and it stays closed. ${REVIEW}`
      : `Sage can't run a test here: ${noticed}. Sage does not send testers to an address like that. ${REVIEW}`;
  }
  return `Sage noticed that ${noticed}. People you invite can still take part; public testers wait until a person at Sage has looked.`;
}

/** The stored record on a product map, read defensively (older maps carry none: never screened, so clear). */
export function safetyOfMap(map: { safety?: unknown } | null | undefined): ProductSafetyRecord | null {
  const s = map?.safety as Partial<ProductSafetyRecord> | null | undefined;
  if (!s || typeof s !== "object" || (s.outcome !== "clear" && s.outcome !== "hold" && s.outcome !== "refused")) return null;
  return { version: 1, outcome: s.outcome, subject: typeof s.subject === "string" ? s.subject : typeof s.host === "string" ? s.host : "", host: typeof s.host === "string" ? s.host : "", hosts: Array.isArray(s.hosts) ? s.hosts.filter((h): h is string => typeof h === "string") : [], signals: Array.isArray(s.signals) ? (s.signals as SafetySignal[]) : [], lists: s.lists ?? { phishing: "unavailable", safeBrowsing: "off", domainAge: "off" }, reviewed: s.reviewed ?? null, checkedAt: typeof s.checkedAt === "number" ? s.checkedAt : 0 };
}
