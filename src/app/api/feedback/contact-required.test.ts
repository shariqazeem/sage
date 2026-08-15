import { describe, it, expect } from "vitest";

/**
 * ONE IDENTITY PER PAYOUT — the cheapest Sybil friction there is.
 *
 * Feedback sent from a PLAN PAGE is the traceable half of a paid mission: the row carries the
 * inspection id, so the run and the feedback are one pair. Someone asking to be paid for that can
 * say who they are, and two wallets claiming to be two people then have to be two contactable
 * people. Anonymous stays right everywhere else — the cost of telling us something read wrong
 * should be a single textarea, with no account and no contact.
 */
const bounded = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim().slice(0, max);
  return t.length > 0 ? t : null;
};

/** mirrors the route's door check. */
function rejectsForMissingContact(body: { inspectionId?: unknown; contact?: unknown }): boolean {
  const inspectionId = bounded(body.inspectionId, 64);
  const contact = bounded(body.contact, 200);
  return !!(inspectionId && (!contact || contact.length < 3));
}

describe("feedback contact requirement", () => {
  it("REFUSES plan-page feedback with no contact — the paid path must be reachable", () => {
    expect(rejectsForMissingContact({ inspectionId: "8UChn-kNIhW2" })).toBe(true);
    expect(rejectsForMissingContact({ inspectionId: "8UChn-kNIhW2", contact: "   " })).toBe(true);
    expect(rejectsForMissingContact({ inspectionId: "8UChn-kNIhW2", contact: "ab" })).toBe(true);
  });

  it("ACCEPTS plan-page feedback that carries a handle", () => {
    expect(rejectsForMissingContact({ inspectionId: "8UChn-kNIhW2", contact: "@shariq" })).toBe(false);
    expect(rejectsForMissingContact({ inspectionId: "8UChn-kNIhW2", contact: "me@example.com" })).toBe(false);
  });

  it("leaves ANONYMOUS feedback alone everywhere else — this must not tax the passer-by", () => {
    expect(rejectsForMissingContact({})).toBe(false);
    expect(rejectsForMissingContact({ contact: "" })).toBe(false);
    expect(rejectsForMissingContact({ inspectionId: null, contact: null })).toBe(false);
  });

  it("a non-string inspection id cannot smuggle past the check", () => {
    expect(rejectsForMissingContact({ inspectionId: 123 })).toBe(false);
    expect(rejectsForMissingContact({ inspectionId: { id: "x" } })).toBe(false);
  });
});
