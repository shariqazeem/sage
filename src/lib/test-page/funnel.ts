/**
 * WHO CAME, AND HOW FAR THEY GOT (27 Nov 2026, "see everything"). Pure: no database, no network, safe for a
 * browser. The server reads the rows (`tracking.ts`) and hands them here.
 *
 * A PERSON is a wallet when one is known (a signed-in visit, an answer, a place taken through the builder's
 * link), and otherwise a visitor id. Every stage means "got at least this far", so the counts can only fall
 * from one stage to the next: someone who answered counts as having seen the test, signed in and opened the
 * product even when no visit was recorded for them (they may have come from Telegram or the API).
 *
 * The owner's alone. Nothing here is ever on the public view of a test.
 */
export type FunnelStage = "saw" | "signed-in" | "opened" | "answered" | "paid";
export const STAGE_LABEL: Record<FunnelStage, string> = {
  saw: "Saw the test",
  "signed-in": "Signed in to take part",
  opened: "Opened your product",
  answered: "Answered",
  paid: "Paid for an honest try",
};
export const FUNNEL_STAGES: readonly FunnelStage[] = ["saw", "signed-in", "opened", "answered", "paid"];

export interface TestFunnel {
  stages: { stage: FunnelStage; label: string; people: number }[];
  /** where the most people stopped: the biggest drop from one stage to the next; null when nobody came or nobody stopped */
  stop: { after: FunnelStage; people: number; line: string } | null;
  /** answers waiting for the builder */
  held: number;
  /** answers that were not paid */
  notPaid: number;
  /** false when the test has no visit rows at all (it predates tracking): the UI then says visits were not counted */
  tracked: boolean;
}

export type SourceKey = "x" | "telegram" | "earn" | "alert" | "link" | "sage" | "direct" | "other";
export const SOURCE_LABEL: Record<SourceKey, string> = {
  x: "Sage's post on X",
  telegram: "Sage's Telegram channel",
  earn: "Earn, Sage's list of open tests",
  alert: "People who asked Sage to tell them",
  link: "Your own link",
  sage: "Sage's home page",
  direct: "Direct or unknown",
  other: "Other sites",
};
export const SOURCE_KEYS: readonly SourceKey[] = ["x", "telegram", "earn", "alert", "link", "sage", "direct", "other"];
export const isSourceKey = (v: unknown): v is SourceKey => typeof v === "string" && (SOURCE_KEYS as readonly string[]).includes(v);

export interface SourceRow {
  source: SourceKey;
  label: string;
  saw: number;
  answered: number;
  paid: number;
}

/* ───────────────────────────────────────────── where a visit came from ───── */

const VIA: Record<string, SourceKey> = {
  x: "x",
  tg: "telegram",
  telegram: "telegram",
  earn: "earn",
  alert: "alert",
  link: "link",
  home: "sage",
  sage: "sage",
};
const X_HOSTS = new Set(["t.co", "x.com", "twitter.com"]);
const TELEGRAM_HOSTS = new Set(["t.me", "telegram.org"]);
export const SAGE_HOSTS: readonly string[] = ["sagepays.xyz"];

const bare = (host: string): string => host.toLowerCase().replace(/^(www|m|mobile|web)\./, "");

/**
 * The source of a FIRST visit. `via` is what Sage's own links carry (`?via=x`), and it wins when it is one
 * of the known words; anything else in it is ignored, so a link cannot invent a source. Otherwise the
 * referring page decides, by its host. Nothing here is stored but the one word it returns.
 */
export function sourceOf(input: { via?: string | null; ref?: string | null }, ownHosts: readonly string[] = SAGE_HOSTS): SourceKey {
  const via = typeof input.via === "string" ? VIA[input.via.trim().toLowerCase()] : undefined;
  if (via) return via;
  const ref = typeof input.ref === "string" ? input.ref.trim() : "";
  if (!ref) return "direct";
  let url: URL;
  try {
    url = new URL(ref);
  } catch {
    return "other";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "other";
  const host = bare(url.hostname);
  if (X_HOSTS.has(host)) return "x";
  if (TELEGRAM_HOSTS.has(host)) return "telegram";
  if (ownHosts.some((h) => bare(h) === host)) return url.pathname === "/earn" || url.pathname.startsWith("/earn/") ? "earn" : "sage";
  return "other";
}

/** A user agent that is a crawler, a link preview or a script, not a person. No user agent is one too. */
export function looksLikeBot(userAgent: string | null | undefined): boolean {
  const ua = (userAgent ?? "").trim();
  if (!ua) return true;
  return /bot\b|bot[/;) ]|crawl|spider|slurp|preview|facebookexternalhit|embedly|headless|lighthouse|pingdom|uptime|monitor|curl\/|wget\/|python|node-fetch|axios|go-http|okhttp|java\/|libwww|scrapy|httpclient/i.test(ua);
}

/* ───────────────────────────────────────────────────────── the funnel ───── */

export interface FunnelVisit {
  visitor: string;
  /** the visitor's wallet once they signed in, in any spelling */
  wallet: string | null;
  source: string;
  firstAt: number;
  signedInAt: number | null;
  openedAt: number | null;
}
export interface FunnelAnswer {
  wallet: string;
  /** paid: the payout settled. held: waiting for the builder. not-paid: declined. open: still being checked. */
  state: "paid" | "held" | "not-paid" | "open";
}
export interface FunnelInput {
  visits: readonly FunnelVisit[];
  answers: readonly FunnelAnswer[];
  /** wallets that took a place through the builder's own link */
  seats: readonly string[];
}

interface Person {
  saw: boolean;
  signedIn: boolean;
  opened: boolean;
  answered: boolean;
  paid: boolean;
  source: SourceKey | null;
  sourceAt: number;
}

/** One spelling per wallet: lower case, and a padded Starknet address without its padding. */
export function walletKey(wallet: string): string {
  const t = wallet.trim().toLowerCase();
  return t.length <= 42 ? t : `0x${t.replace(/^0x/, "").replace(/^0+/, "") || "0"}`;
}

function people(input: FunnelInput): Map<string, Person> {
  const map = new Map<string, Person>();
  const of = (key: string): Person => {
    let p = map.get(key);
    if (!p) {
      p = { saw: true, signedIn: false, opened: false, answered: false, paid: false, source: null, sourceAt: Number.POSITIVE_INFINITY };
      map.set(key, p);
    }
    return p;
  };
  for (const v of input.visits) {
    const p = of(v.wallet ? `w:${walletKey(v.wallet)}` : `v:${v.visitor}`);
    if (v.wallet || v.signedInAt !== null) p.signedIn = true;
    if (v.openedAt !== null) p.opened = true;
    // the first touch of the person's earliest visit
    if (v.firstAt < p.sourceAt) {
      p.sourceAt = v.firstAt;
      p.source = isSourceKey(v.source) ? v.source : "other";
    }
  }
  for (const wallet of input.seats) {
    const p = of(`w:${walletKey(wallet)}`);
    p.signedIn = true;
    // a place taken through the builder's link, with no visit on record: the link is where they came from
    if (p.source === null) p.source = "link";
  }
  for (const a of input.answers) {
    const p = of(`w:${walletKey(a.wallet)}`);
    p.signedIn = true;
    p.opened = true;
    p.answered = true;
    if (a.state === "paid") p.paid = true;
    if (p.source === null) p.source = "direct";
  }
  return map;
}

/** How far a person got, as a number: every stage up to it counts them. */
function reached(p: Person): number {
  if (p.paid) return 4;
  if (p.answered) return 3;
  if (p.opened) return 2;
  if (p.signedIn) return 1;
  return 0;
}

/** "11 opened it, 4 answered", for the stage people stopped after. */
const STOP_WORDS: Record<Exclude<FunnelStage, "answered" | "paid">, { after: string; here: (c: number) => string; next: (c: number) => string }> = {
  saw: { after: "seeing the test", here: (c) => `${c} saw it`, next: (c) => `${c} signed in` },
  "signed-in": { after: "signing in", here: (c) => `${c} signed in`, next: (c) => `${c} opened your product` },
  opened: { after: "opening your product", here: (c) => `${c} opened it`, next: (c) => `${c} answered` },
};

export function buildFunnel(input: FunnelInput): TestFunnel {
  const all = [...people(input).values()];
  const counts = FUNNEL_STAGES.map((_, i) => all.filter((p) => reached(p) >= i).length);
  const stages = FUNNEL_STAGES.map((stage, i) => ({ stage, label: STAGE_LABEL[stage], people: counts[i] }));

  // Where people STOPPED is a question about the way in: seeing, signing in, opening, answering. An answer
  // that is not paid yet has not stopped anywhere (it is being checked, or it is waiting for the builder),
  // so the last step is counted by `held` and `notPaid` and never called a stop.
  let stop: TestFunnel["stop"] = null;
  let worst = 0;
  for (let i = 0; i < 3; i += 1) {
    const drop = counts[i] - counts[i + 1];
    if (drop > worst) {
      worst = drop;
      const stage = FUNNEL_STAGES[i] as keyof typeof STOP_WORDS;
      const w = STOP_WORDS[stage];
      const stoppedBeforeAnswering = counts[0] - counts[3];
      const lead = drop * 2 > stoppedBeforeAnswering ? "Most people who stopped did so" : "More people stopped";
      const tail = drop * 2 > stoppedBeforeAnswering ? "" : " than anywhere else";
      stop = { after: stage, people: drop, line: `${lead} after ${w.after}${tail}: ${w.here(counts[i])}, ${w.next(counts[i + 1])}.` };
    }
  }

  return {
    stages,
    stop,
    held: input.answers.filter((a) => a.state === "held").length,
    notPaid: input.answers.filter((a) => a.state === "not-paid").length,
    tracked: input.visits.length > 0,
  };
}

/** Where people came from, most first. A source nobody came from is left out. */
export function buildSources(input: FunnelInput): SourceRow[] {
  const rows = new Map<SourceKey, SourceRow>();
  for (const p of people(input).values()) {
    const source = p.source ?? "direct";
    const row = rows.get(source) ?? { source, label: SOURCE_LABEL[source], saw: 0, answered: 0, paid: 0 };
    row.saw += 1;
    if (p.answered) row.answered += 1;
    if (p.paid) row.paid += 1;
    rows.set(source, row);
  }
  return [...rows.values()].sort((a, b) => b.saw - a.saw || b.answered - a.answered || SOURCE_KEYS.indexOf(a.source) - SOURCE_KEYS.indexOf(b.source));
}

/** A live test's card line, in words: "12 saw it · 5 answered · 4 paid". Null when visits were not counted. */
export function funnelLine(funnel: TestFunnel): string | null {
  if (!funnel.tracked) return null;
  const by = new Map(funnel.stages.map((s) => [s.stage, s.people]));
  return `${by.get("saw") ?? 0} saw it · ${by.get("answered") ?? 0} answered · ${by.get("paid") ?? 0} paid`;
}
