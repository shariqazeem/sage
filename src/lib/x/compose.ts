import { X_POST_MAX, containsUrl, xLength } from "./prices";

/**
 * WHAT SAGE SAYS ON X. Templates, not a model.
 *
 * Every number is handed in from the database and every quote is a verbatim piece of stored evidence;
 * nothing here can invent an amount, because nothing here does arithmetic beyond formatting. The voice
 * is plain and specific: no hype, no emoji, no exclamation marks, and never a handle, so a post can
 * never mention someone who didn't tag Sage. Each text carries its own test's facts and link, so no two
 * are the same (X refuses a repeated text).
 *
 * A text that breaks a rule is not repaired, it is refused (`null`), and the agent records why.
 */
export type Composed = { text: string; hasUrl: boolean };

const EMOJI = /\p{Extended_Pictographic}/u;
/** Words Sage's public voice never uses: the retired product name and any "keys" framing. */
const BANNED = /\bdeputy\b|\bkeys?\b/i;

/** The rules every outgoing text must pass. Returns the reason it fails, or null. */
export function ruleBroken(text: string): string | null {
  if (!text.trim()) return "empty text";
  if (xLength(text) > X_POST_MAX) return "over 280 characters";
  if (text.includes("@")) return "would mention someone";
  if (text.includes("!")) return "exclamation mark";
  if (EMOJI.test(text)) return "emoji";
  if (BANNED.test(text)) return "a word Sage doesn't use";
  return null;
}

function finish(text: string): Composed | null {
  return ruleBroken(text) ? null : { text, hasUrl: containsUrl(text) };
}

/** USDC base units (6 decimals) as dollars: `$2`, `$2.50`, `$0.40`. Formatting only. */
export function usd(base: number | bigint): string {
  const n = typeof base === "bigint" ? base : BigInt(Math.trunc(base));
  const whole = n / BigInt(1_000_000);
  const fraction = n % BigInt(1_000_000);
  if (fraction === BigInt(0)) return `$${whole}`;
  // never rounded: a reward of $0.405 is written as $0.405, and whole cents as two digits
  const digits = fraction.toString().padStart(6, "0").replace(/0+$/, "");
  return `$${whole}.${digits.padEnd(2, "0")}`;
}

/** The host a product lives at, without `www.`; null for anything that is not an https link. */
export function domainOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    return /^[a-z0-9.-]+\.[a-z]{2,24}$/.test(host) ? host : null;
  } catch {
    return null;
  }
}

/**
 * Free text that may sit inside a post (a job title, a finding): one line, trimmed, and refused
 * outright if it carries a handle, a link, a wallet address, an emoji or an exclamation mark.
 */
export function plainWords(raw: string | null | undefined, max: number): string | null {
  const s = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!s || s.length > max) return null;
  if (s.includes("@") || s.includes("!") || containsUrl(s) || /0x[0-9a-f]{8,}/i.test(s) || EMOJI.test(s) || BANNED.test(s)) return null;
  return s;
}

/**
 * One sentence a person actually wrote, taken whole. The result is always an exact substring of one
 * of `notes`; a sentence is never trimmed inside, joined or corrected.
 */
export function pickQuote(notes: readonly string[], opts: { min?: number; max?: number } = {}): string | null {
  const min = opts.min ?? 20;
  const max = opts.max ?? 110;
  for (const note of notes) {
    for (const piece of note.split(/(?<=[.?])\s+|\n+/)) {
      const sentence = piece.trim();
      if (sentence.length < min || sentence.length > max) continue;
      if (/[“”"]/.test(sentence)) continue; // it will sit inside quotation marks
      if (plainWords(sentence, max) !== sentence) continue; // one line, no handle, link or address
      return sentence;
    }
  }
  return null;
}

/** Is this quote exactly present in the stored evidence? The last check before a quote is published. */
export function isVerbatim(quote: string, notes: readonly string[]): boolean {
  return quote.length > 0 && notes.some((n) => n.includes(quote));
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export type MissionFacts = {
  product: string;
  /** places still open */
  places: number;
  /** the smallest and largest reward a place pays, in base units */
  rewardMinBase: number;
  rewardMaxBase: number;
  onMetis: boolean;
  url: string;
};

export function missionText(f: MissionFacts): Composed | null {
  if (f.places <= 0 || f.rewardMinBase <= 0) return null;
  const reward =
    f.rewardMinBase === f.rewardMaxBase ? `${usd(f.rewardMinBase)} each` : `${usd(f.rewardMinBase)} to ${usd(f.rewardMaxBase)} each`;
  const paid = f.onMetis ? "in USDC on Metis" : "in USDC";
  return finish(
    `New test on Sage: try ${f.product} and tell us where you get stuck. ${count(f.places, "place", "places")}, ${reward} ${paid}. ${f.url}`,
  );
}

export type ResultTextFacts = {
  product: string;
  /** people who were paid */
  people: number;
  /** the top finding in a few words, when the findings report has one */
  finding: string | null;
  /** a verbatim sentence from stored evidence */
  quote: string | null;
  onMetis: boolean;
  url: string;
};

export function resultText(f: ResultTextFacts): Composed | null {
  if (f.people <= 0) return null;
  const head = `${count(f.people, "person", "people")} tried ${f.product}.`;
  const tail = `${f.people === 1 ? "Checked" : "Each one checked"} and paid${f.onMetis ? " on Metis" : " in USDC"}. ${f.url}`;
  const finding = f.finding?.replace(/[.:]+$/, "") ?? null;
  const middles = [
    finding && f.quote ? `${finding}: “${f.quote}”` : null,
    f.quote ? `One said: “${f.quote}”` : null,
    finding ? `${finding}.` : null,
    "",
  ];
  // the fullest version that fits: a quote is dropped whole, never shortened
  for (const middle of middles) {
    if (middle === null) continue;
    const out = finish([head, middle, tail].filter(Boolean).join(" "));
    if (out) return out;
  }
  return null;
}

export type ReplyReadyFacts = {
  domain: string;
  /** pages Sage opened while trying the product */
  pages: number;
  /** paid places in the drafted test */
  places: number;
  /** what the drafted test costs in all, base units */
  totalBase: number | bigint;
  url: string;
};

export function replyReadyText(f: ReplyReadyFacts): Composed | null {
  if (f.places <= 0 || BigInt(f.totalBase) <= BigInt(0)) return null;
  const tried = f.pages > 0 ? `I tried ${f.domain} and opened ${count(f.pages, "page", "pages")}.` : `I tried ${f.domain}.`;
  return finish(`${tried} A test is ready: ${count(f.places, "place", "places")}, ${usd(f.totalBase)}. ${f.url}`);
}

/** Sage tried the product and needs the builder's answer before it can draft the test. */
export function replyQuestionText(f: { domain: string; url: string }): Composed | null {
  return finish(`I tried ${f.domain} and have a question before a test is ready. ${f.url}`);
}

/** Sage could not open the product. No link of Sage's own: there is nothing to look at. */
export function replyFailedText(f: { domain: string; reason: string }): Composed | null {
  return finish(`I couldn't open ${f.domain}: ${f.reason.replace(/[.]+$/, "")}.`);
}
