/**
 * WHAT A TESTER IS TOLD ABOUT THEIR OWN ANSWER (28 Nov 2026). Pure: no database, no network.
 *
 * A person who answered and left the page never learned they were paid. A tester who asked Sage to message
 * them (the alerts roster) now hears, once each, when their own answer is paid, not paid, passed to the
 * builder to read, or needs more from them.
 *
 * NO CORPUS ORACLE. Nothing here says what Sage saw or how an answer was matched. A "not paid" reason is
 * the same line the test's page shows that tester; "needs more" says only that, and where to add it.
 */
export type TesterNoticeKind = "paid" | "not-paid" | "held" | "improve";

export interface AnswerFacts {
  submissionId: string;
  /** the product's host, or the test's title */
  product: string;
  /** the test's address */
  url: string;
  status: string;
  /** what the mission pays, in USDC base units */
  rewardBase: number;
  payoutTx: string | null;
  /** the site's origin, for a receipt's address */
  origin: string;
  /** the recorded reason as the page shows it to this tester; null when there is none */
  reason: string | null;
  /** Sage has read it and it waits for the builder's own yes or no */
  heldForBuilder: boolean;
  /** Sage asked for more and the tester still has attempts */
  canImprove: boolean;
  /** when the fact became true: the decision, or the hold (epoch seconds) */
  at: number;
}

export interface TesterNotice {
  submissionId: string;
  kind: TesterNoticeKind;
  text: string;
  at: number;
}

const usd = (base: number): string => `$${(base / 1_000_000).toFixed(2)}`;
const plain = (s: string): string => s.replace(/\s+/g, " ").replace(/!+/g, ".").trim().replace(/[.\s]+$/, "");

/** The one notice an answer is due right now, or null. One state, one message. */
export function noticeFor(a: AnswerFacts): TesterNotice | null {
  const say = (kind: TesterNoticeKind, text: string): TesterNotice => ({ submissionId: a.submissionId, kind, text, at: a.at });
  if (a.status === "paid") {
    if (!a.payoutTx) return null; // no receipt on record yet: say nothing until there is one
    return say("paid", `Sage paid you ${usd(a.rewardBase)} for trying ${a.product}. Receipt: ${a.origin}/proof/${a.payoutTx}`);
  }
  if (a.status === "rejected" || a.status === "blocked") {
    const why = a.reason ? plain(a.reason) : "";
    return say("not-paid", why ? `Your answer on ${a.product} was not paid: ${why}.` : `Your answer on ${a.product} was not paid.`);
  }
  if (a.status === "pending" && a.canImprove) {
    return say("improve", `Your answer on ${a.product} was not paid yet: Sage needs more of what you saw. You can improve it from the test page: ${a.url}`);
  }
  if (a.status === "pending" && a.heldForBuilder) {
    return say("held", `Sage passed your answer on ${a.product} to its builder to read. You'll hear here when they decide.`);
  }
  return null;
}

export const noticeKey = (n: Pick<TesterNotice, "submissionId" | "kind">): string => `${n.submissionId}|${n.kind}`;

/**
 * The notices to send, oldest first: each (answer, kind) once, and only for something that happened after
 * the person asked to be told (`since`, by submission id). What was already true when they joined is not news.
 */
export function dueTesterNotices(answers: readonly AnswerFacts[], sent: ReadonlySet<string>, since: ReadonlyMap<string, number> = new Map()): TesterNotice[] {
  const due: TesterNotice[] = [];
  for (const a of answers) {
    const n = noticeFor(a);
    if (!n || sent.has(noticeKey(n))) continue;
    if (n.at < (since.get(a.submissionId) ?? 0)) continue;
    due.push(n);
  }
  return due.sort((x, y) => x.at - y.at || x.submissionId.localeCompare(y.submissionId));
}
