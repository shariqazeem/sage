/**
 * WHAT SAGE DID FOR A TEST, newest first (27 Nov 2026, "see everything"). Pure: no database and no network.
 *
 * THE NO-FABRICATED-FEED RULE. Every line is one recorded row said in plain words: the inspection and its
 * field test, the plan, the campaign's creation, its journal events, the posts that were really posted, the
 * findings row. A row that is missing is a line that is missing; nothing is filled in, and a time is always
 * the row's own. Reasons are the recorded words, never new ones.
 *
 * The owner's alone: lines name testers by the same short wallet the owner's tickets use.
 */
export type ActivityKind =
  | "tried"
  | "planned"
  | "opened"
  | "announced"
  | "posted-x"
  | "posted-channel"
  | "paid"
  | "held"
  | "not-paid"
  | "flagged"
  | "findings"
  | "ended";

export interface ActivityItem {
  at: number;
  kind: ActivityKind;
  text: string;
  href?: string | null;
}

/** One journal event, already decoded: `text` is the event's own detail, and nothing else. */
export interface ActivityEvent {
  kind: string;
  at: number;
  text: string | null;
  submissionId: string | null;
  txHash: string | null;
  amountBase: number | null;
}

export interface ActivityInput {
  /** the product's host, or the test's title when it has no address */
  product: string | null;
  /** Sage's own run through the product: the field test's stored steps and seconds, and when the inspection began */
  run: { at: number; steps: number; seconds: number | null } | null;
  /** what Sage read where it could not use the product itself ("the store listing"); null when it tried it */
  sageReads: string | null;
  /** the plan the test was paid for */
  plan: { at: number; missions: number; places: number } | null;
  /** the test once it is past a draft: the campaign row's own creation, its money and its vault */
  opened: { at: number; fundedBase: number; places: number; network: string; vaultUrl: string | null } | null;
  events: readonly ActivityEvent[];
  /** each answer as the owner's ticket names it, and where it stands now */
  answers: ReadonlyMap<string, { handle: string; status: string; rejectReason: string | null }>;
  /** posts that reached X, with their address */
  xPosts: readonly { kind: "mission" | "result"; at: number; url: string | null }[];
  /** the post in Sage's Telegram channel, when it was really posted */
  channelPost: { at: number; url: string | null } | null;
  /** the stored findings: when they were built, the paid answers read, the groups made */
  findings: { at: number; answers: number; groups: number } | null;
  /** the end, only when a recorded row carries its time */
  ended: { at: number; how: "full" | "stopped"; paid: number; total: number } | null;
}

const usd = (base: number): string => `$${(base / 1_000_000).toFixed(2)}`;
const count = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** A recorded reason as the end of a sentence: no leading wallet, no trailing code, no final full stop. */
export function reasonWords(text: string | null | undefined): string | null {
  let t = (text ?? "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  // the journal writes "0x12ab…cdef · reason"
  t = t.replace(/^0x[0-9a-fA-F]{2,}…[0-9a-fA-F]{2,}\s*·\s*/, "");
  // "… (observation_review)": the token is for the log, not for a person
  t = t.replace(/\s*\([a-z0-9_]+(?:\([^)]*\))?\)\s*$/i, "");
  t = t.replace(/[.\s]+$/, "");
  // "Deputy" is an engineering name a person never reads (CLAUDE.md), and old rows still carry it
  t = t.replace(/\bthe\s+deputy\b/gi, "Sage").replace(/\bDeputy\b/g, "Sage");
  // the gate's own shorthand for "not sure", in the words it means
  if (/^Sage recommends hold(ing)?$/i.test(t)) return "Sage was not sure it was a real try";
  return t || null;
}

const sentence = (lead: string, reason: string | null): string => (reason ? `${lead}: ${reason}.` : `${lead}.`);
const SETTLED = new Set(["settled", "autopay_settled"]);
const BUILDER_SAID = "The builder said:";
/** a hold that only asks the tester to add to their answer is nothing the builder has to do */
const isRetryLine = (text: string | null): boolean => /observation_retry|for the tester to refine/i.test(text ?? "");
const toldOf = (text: string | null): number | null => {
  const m = /Told (\d+) of \d+/.exec(text ?? "");
  return m ? Number(m[1]) : null;
};

export function buildActivity(input: ActivityInput): ActivityItem[] {
  const items: ActivityItem[] = [];
  const who = (submissionId: string | null): string | null => (submissionId ? (input.answers.get(submissionId)?.handle ?? null) : null);

  if (input.run && input.product) {
    if (input.sageReads) {
      items.push({ at: input.run.at, kind: "tried", text: `Sage read ${input.sageReads} for ${input.product}.` });
    } else if (input.run.steps > 0) {
      const took = input.run.seconds ? ` in ${input.run.seconds} s` : "";
      items.push({ at: input.run.at, kind: "tried", text: `Sage opened ${input.product} in a real browser: ${count(input.run.steps, "step", "steps")}${took}.` });
    }
  }
  if (input.plan && input.plan.missions > 0) {
    items.push({ at: input.plan.at, kind: "planned", text: `Sage wrote ${count(input.plan.missions, "mission", "missions")} with ${count(input.plan.places, "place", "places")}.` });
  }
  if (input.opened) {
    items.push({
      at: input.opened.at,
      kind: "opened",
      text: `The test opened: ${usd(input.opened.fundedBase)} for ${count(input.opened.places, "place", "places")}, held in its own vault on ${input.opened.network}.`,
      href: input.opened.vaultUrl,
    });
  }

  // one payout is one line, even when the journal holds two rows for its transaction
  const paidTx = new Set<string>();
  const bySage = new Set(input.events.filter((e) => e.kind === "autopay_settled" && e.txHash).map((e) => e.txHash as string));
  // only the latest hold of an answer is said: a hold is a state, and its older reasons are history
  const heldSaid = new Set<string>();
  const newestFirst = [...input.events].sort((a, b) => b.at - a.at);

  for (const e of newestFirst) {
    const handle = who(e.submissionId);
    if (SETTLED.has(e.kind)) {
      if (!e.txHash || paidTx.has(e.txHash) || !handle) continue;
      paidTx.add(e.txHash);
      const amount = e.amountBase !== null && e.amountBase > 0 ? ` ${usd(e.amountBase)}` : "";
      items.push({
        at: e.at,
        kind: "paid",
        text: bySage.has(e.txHash) ? `Sage checked ${handle}'s answer and paid${amount}.` : `${handle}'s answer was released and Sage paid${amount}.`,
        href: `/proof/${e.txHash}`,
      });
      continue;
    }
    if (e.kind === "work_announced") {
      const told = toldOf(e.text);
      if (told && told > 0) items.push({ at: e.at, kind: "announced", text: `Sage told ${count(told, "person", "people")} who asked to hear about new tests.` });
      continue;
    }
    if (e.kind === "builder_flagged") {
      if (handle) items.push({ at: e.at, kind: "flagged", text: sentence(`You said ${handle}'s answer wasn't a real try`, reasonWords(e.text)) });
      continue;
    }
    if (e.kind === "autopay_held") {
      if (!handle || !e.submissionId || isRetryLine(e.text) || heldSaid.has(e.submissionId)) continue;
      heldSaid.add(e.submissionId);
      const answer = input.answers.get(e.submissionId);
      const reason = reasonWords(e.text);
      // the journal writes a closed answer (the places filled, the test stopped) under the same kind as a hold
      if (answer?.status === "rejected" || answer?.status === "blocked") {
        items.push({ at: e.at, kind: "not-paid", text: sentence(`Sage did not pay ${handle}`, reason) });
      } else if (answer?.status === "pending") {
        items.push({ at: e.at, kind: "held", text: sentence(`Sage held ${handle}'s answer for you`, reason) });
      }
      continue;
    }
    if (e.kind === "submission_rejected") {
      if (!handle || !e.submissionId) continue;
      // the builder's flag writes this row too; its own line (`builder_flagged`) already says it
      if ((e.text ?? "").startsWith(BUILDER_SAID)) continue;
      const own = reasonWords(e.text);
      // a decline by hand records only the wallet; a revoked payout records "wallet · reason"
      const revoked = own !== null && !/^0x[0-9a-fA-F]{2,}…[0-9a-fA-F]{2,}$/.test((e.text ?? "").trim());
      const recorded = input.answers.get(e.submissionId)?.rejectReason ?? null;
      // the builder's own decline from the test's page is recorded as "The builder said: …"
      const builders = recorded?.startsWith(BUILDER_SAID) ? recorded.slice(BUILDER_SAID.length) : null;
      items.push({
        at: e.at,
        kind: "not-paid",
        text: revoked
          ? sentence(`Sage did not pay ${handle}`, own)
          : builders !== null
            ? sentence(`You declined ${handle}'s answer`, reasonWords(builders))
            : sentence(`${handle}'s answer was declined`, reasonWords(recorded)),
      });
    }
  }

  for (const p of input.xPosts) {
    items.push({ at: p.at, kind: "posted-x", text: p.kind === "mission" ? "Sage posted your test on X." : "Sage posted what people found on X.", href: p.url });
  }
  if (input.channelPost) {
    items.push({ at: input.channelPost.at, kind: "posted-channel", text: "Sage posted your test in its Telegram channel.", href: input.channelPost.url });
  }
  if (input.findings && input.findings.groups > 0) {
    items.push({
      at: input.findings.at,
      kind: "findings",
      text: `Sage grouped ${count(input.findings.answers, "answer", "answers")} into ${count(input.findings.groups, "finding", "findings")}.`,
    });
  }
  if (input.ended) {
    const paid = `${input.ended.paid} of ${input.ended.total} ${input.ended.total === 1 ? "person" : "people"} paid`;
    items.push({ at: input.ended.at, kind: "ended", text: input.ended.how === "full" ? `Every place is paid: ${paid}. The test is done.` : `The test was stopped: ${paid}.` });
  }

  return items.sort((a, b) => b.at - a.at);
}
