/**
 * WHICH MESSAGES A BUILDER IS DUE ABOUT ONE TEST. Pure: no database, no network, no clock but the one
 * passed in. Sending is somewhere else (`notify.ts`).
 *
 * Five kinds, each sent at most once per test (an answer waiting is once per answer):
 *   first-answer   the first person answered
 *   held:<id>      an answer is waiting for the builder's own yes or no
 *   findings       the findings have their first group
 *   done           the test ended, and nothing is still being checked
 *   quiet-24h      open a day with no answer: what Sage already did, and what fills it faster
 *
 * Every number is a counted row. A message says nothing Sage did not do: "listed on Earn" only for a test
 * that is public, "told N people" only from the recorded announcement.
 */
export const QUIET_AFTER_SEC = 24 * 3600;

export interface NoticeFacts {
  /** the product's host, or the test's title */
  product: string;
  /** the test's address, with no anchor */
  url: string;
  status: string;
  /** when the test opened (epoch seconds) */
  openedAt: number;
  now: number;
  /** every answer that ever arrived, whatever became of it */
  answers: number;
  /** answers still being checked or paid, not counting those waiting for the builder */
  inFlight: number;
  /** answers waiting for the builder, each with the recorded reason */
  held: readonly { submissionId: string; why: string | null }[];
  /** groups in the stored findings */
  findingGroups: number;
  /** paid answers the stored findings read */
  findingAnswers: number;
  paidPeople: number;
  places: number;
  /** every place is paid */
  full: boolean;
  /** a stranger can find it on Earn */
  publicWork: boolean;
  /** people the roster announcement reached, from its recorded line; null when there was none */
  told: number | null;
}

export interface Notice {
  kind: string;
  text: string;
}

const n = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;
const ENDED = new Set(["completed", "cancelled", "paused"]);

/** The notices that are true right now, in the order they would be sent. Already-sent kinds are left out. */
export function dueNotices(f: NoticeFacts, sent: ReadonlySet<string> = new Set()): Notice[] {
  const due: Notice[] = [];
  const add = (kind: string, text: string) => {
    if (!sent.has(kind)) due.push({ kind, text });
  };
  const people = `${f.url}#people`;
  const findings = `${f.url}#findings`;

  if (f.answers > 0) add("first-answer", `The first answer to your test of ${f.product} is in.\n${people}`);

  for (const h of f.held) {
    const why = h.why ? ` ${h.why.replace(/[.\s]+$/, "")}.` : "";
    add(`held:${h.submissionId}`, `An answer to your test of ${f.product} is waiting for you.${why} Read it and decide whether it is paid.\n${people}`);
  }

  if (f.findingGroups > 0) {
    add("findings", `Sage grouped ${n(f.findingAnswers, "answer", "answers")} to your test of ${f.product} into ${n(f.findingGroups, "finding", "findings")}.\n${findings}`);
  }

  const done = f.status !== "draft" && (ENDED.has(f.status) || f.full);
  if (done && f.inFlight === 0 && f.held.length === 0) {
    const paid = `${f.paidPeople} of ${f.places} ${f.places === 1 ? "person" : "people"} paid`;
    add("done", f.paidPeople > 0 ? `Your test of ${f.product} has ended: ${paid}. What they found is here.\n${findings}` : `Your test of ${f.product} has ended: ${paid}.\n${f.url}`);
  }

  if (f.status === "live" && !f.full && f.answers === 0 && f.now - f.openedAt >= QUIET_AFTER_SEC) {
    const did = f.publicWork
      ? f.told && f.told > 0
        ? `Sage listed it on Earn and told ${n(f.told, "person", "people")} who asked to hear about new tests.`
        : "Sage listed it on Earn."
      : "Only people with your link can take part.";
    const next = f.publicWork ? "Sharing your own link fills it faster." : "Sharing that link is what fills it.";
    add("quiet-24h", `Your test of ${f.product} has been open for a day and nobody has answered yet. ${did} ${next}\n${f.url}`);
  }
  return due;
}

/**
 * What is already true when a builder connects is not news: every due notice except an answer that is
 * waiting for them right now (that one still needs them) is marked as said, without a message.
 */
export function baselineKinds(due: readonly Notice[]): string[] {
  return due.filter((d) => !d.kind.startsWith("held:")).map((d) => d.kind);
}
