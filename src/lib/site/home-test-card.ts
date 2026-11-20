import type { TestCardState } from "@/components/sage/test-card";

/**
 * A TEST, AS ITS CARD READS. Pure: the state and the one line come from the stored status and the
 * real counts, and from nothing else. Every status has a card, so a test never disappears and never
 * dead-ends: a product Sage couldn't open says so and is still there to open.
 */
export interface HomeTest {
  key: string;
  href: string;
  host: string;
  state: TestCardState;
  line: string;
  places: { total: number; paid: number; taken: number } | null;
  event: string | null;
  /** unix seconds of the last thing that happened */
  at: number;
}

const people = (n: number): string => (n === 1 ? "1 person" : `${n} people`);

export function cardOfInspection(i: { id: string; href: string; host: string; status: string; steps: number; missions: number; at: number; question?: string | null }): HomeTest {
  const base = { key: `i:${i.id}`, href: i.href, host: i.host, places: null, at: i.at };
  if (i.status === "ready") {
    return {
      ...base,
      state: "ready",
      line: i.missions > 0 ? `${i.missions === 1 ? "1 mission" : `${i.missions} missions`} written. Set the people and pay.` : "Sage tried it. Set the people and pay.",
      event: i.steps > 0 ? `Sage took ${i.steps === 1 ? "1 step" : `${i.steps} steps`} through it` : null,
    };
  }
  if (i.status === "needs_input") return { ...base, state: "question", line: "Sage has a question before it writes the missions.", event: i.question ?? null };
  if (i.status === "failed") return { ...base, state: "stopped", line: "Sage couldn't finish trying it. Open it to see why and try again.", event: null };
  const doing: Record<string, string> = {
    queued: "Sage is about to open it.",
    fetching: "Sage is opening it.",
    field_test: "Sage is trying it in a real browser.",
    mapping: "Sage is working out what it does.",
    analyzing: "Sage is working out what it does.",
    generating_missions: "Sage is writing the missions.",
    reviewing: "Sage is checking the missions it wrote.",
  };
  return { ...base, state: "trying", line: doing[i.status] ?? "Sage is trying it.", event: i.steps > 0 ? `${i.steps === 1 ? "1 step" : `${i.steps} steps`} so far` : null };
}

export function cardOfCampaign(c: { id: string; href: string; host: string; status: string; total: number; paid: number; checking: number; event: string | null; at: number }): HomeTest {
  const base = { key: `c:${c.id}`, href: c.href, host: c.host, event: c.event, at: c.at };
  const places = c.total > 0 ? { total: c.total, paid: Math.min(c.paid, c.total), taken: Math.min(c.checking, Math.max(0, c.total - c.paid)) } : null;
  if (c.status === "live") {
    const line = c.paid === 0 && c.checking === 0 ? `Waiting for the first of ${people(c.total)}.` : `${c.paid} of ${c.total} paid${c.checking > 0 ? `, ${c.checking} being checked` : ""}.`;
    return { ...base, state: "live", line, places };
  }
  if (c.status === "draft") return { ...base, state: "ready", line: "Ready. Set the people and pay.", places: null };
  if (c.status === "completed") return { ...base, state: "done", line: `${people(c.paid)} tried it and ${c.paid === 1 ? "was" : "were"} paid.`, places };
  // paused, cancelled, or anything a vault can be that is not taking places
  return { ...base, state: c.paid > 0 ? "done" : "stopped", line: c.paid > 0 ? `Stopped after ${people(c.paid)} ${c.paid === 1 ? "was" : "were"} paid.` : "Stopped before anyone was paid.", places };
}
