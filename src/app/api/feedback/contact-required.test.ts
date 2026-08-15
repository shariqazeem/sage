import { describe, it, expect } from "vitest";

/**
 * ONE IDENTITY PER PAYOUT — the cheapest Sybil friction there is.
 *
 * The widget only appears on surfaces a paid tester passes through, so every one of them is a place
 * someone can claim to be a second person. Requiring a contact on all of them means two wallets
 * claiming to be two people have to be two CONTACTABLE people, and every response becomes a seed
 * user the founder can follow up with. Scoped to plan pages first; the founder widened it the same
 * day, accepting that a passer-by with a one-line note now has to sign it too.
 */
const bounded = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim().slice(0, max);
  return t.length > 0 ? t : null;
};

/** mirrors the route's door check. */
function rejectsForMissingContact(body: { inspectionId?: unknown; contact?: unknown }): boolean {
  const contact = bounded(body.contact, 200);
  return !contact || contact.length < 3;
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

  it("REFUSES feedback with no inspection id either — the rule is every surface, not just plan pages", () => {
    expect(rejectsForMissingContact({})).toBe(true);
    expect(rejectsForMissingContact({ contact: "" })).toBe(true);
    expect(rejectsForMissingContact({ inspectionId: null, contact: null })).toBe(true);
  });

  it("a non-string contact cannot smuggle past the check", () => {
    expect(rejectsForMissingContact({ contact: 123 })).toBe(true);
    expect(rejectsForMissingContact({ contact: { handle: "x" } })).toBe(true);
  });
});
