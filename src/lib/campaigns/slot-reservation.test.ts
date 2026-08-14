import { describe, it, expect } from "vitest";
import {
  missionSlotStatus,
  slotsHeldMessage,
  OBSERVATION_RETRY_TOKEN,
  RETRY_RESERVATION_MINUTES,
} from "./slot-reservation";
import { observationRetryLine } from "@/lib/deputy/reason-copy";

/**
 * THE BROKEN PROMISE, measured on the first funded campaign (clawup, 2026-08-14): a tester submitted
 * to the wrong mission, Sage invited them to fix it and resubmit, and the mission filled while they
 * were rewriting. They did the work twice and were paid nothing. An invitation Sage cannot honour is
 * worse than no invitation.
 */
const NOW = 1_700_000_000;
const MIN = 60;

const invited = (agoMinutes: number) => ({
  status: "pending",
  lastHoldReason: `0xabc…def · ${observationRetryLine(1, 3)}`,
  lastHeldAt: NOW - agoMinutes * MIN,
});
const paid = { status: "paid", lastHoldReason: null, lastHeldAt: null };
const settling = { status: "settling", lastHoldReason: null, lastHeldAt: null };
const awaitingFounder = {
  status: "pending",
  lastHoldReason: "0xabc…def · observation-based work that needs your judgment (observation_review)",
  lastHeldAt: NOW - 5 * MIN,
};

describe("the retry line and the matcher agree — a stringly link that must never drift", () => {
  it("observationRetryLine carries the token missionSlotStatus looks for", () => {
    expect(observationRetryLine(1, 3)).toContain(OBSERVATION_RETRY_TOKEN);
  });
});

describe("missionSlotStatus", () => {
  it("holds the invited tester's place: 2 slots, 1 paid, 1 invited → nothing open", () => {
    const s = missionSlotStatus([paid, invited(2)], 2, NOW);
    expect(s).toMatchObject({ taken: 1, reserved: 1, open: 0 });
    expect(s.nextOpensAt).toBe(NOW - 2 * MIN + RETRY_RESERVATION_MINUTES * MIN);
  });

  it("the exact clawup race: the slot is NOT given away while the tester is rewriting", () => {
    // before the fix this returned open=1 and the newcomer took the last slot
    expect(missionSlotStatus([paid, invited(1)], 2, NOW).open).toBe(0);
  });

  it("a lapsed invitation returns the slot — a held place must never be permanent", () => {
    const s = missionSlotStatus([paid, invited(RETRY_RESERVATION_MINUTES + 1)], 2, NOW);
    expect(s).toMatchObject({ reserved: 0, open: 1, nextOpensAt: null });
  });

  it("work awaiting the FOUNDER does not reserve — two weak accounts must not lock out the good ones", () => {
    // measured on clawup M2: reserving founder-review holds would have blocked the two best accounts,
    // which were the ones that actually got paid.
    expect(missionSlotStatus([awaitingFounder, awaitingFounder], 2, NOW).open).toBe(2);
  });

  it("settling counts as taken — money already in flight is not a free slot", () => {
    expect(missionSlotStatus([settling, paid], 2, NOW).open).toBe(0);
  });

  it("never reports more open than the vault's own cap allows", () => {
    expect(missionSlotStatus([], 3, NOW).open).toBe(3);
    expect(missionSlotStatus([paid, paid, paid, paid], 3, NOW).open).toBe(0);
  });

  it("reports the EARLIEST expiry when several places are held", () => {
    const s = missionSlotStatus([invited(20), invited(5)], 4, NOW);
    expect(s.reserved).toBe(2);
    expect(s.nextOpensAt).toBe(NOW - 20 * MIN + RETRY_RESERVATION_MINUTES * MIN); // the older one
  });
});

describe("slotsHeldMessage", () => {
  it("reads as 'come back', never as a rejection — the reader has done no work yet", () => {
    const s = missionSlotStatus([paid, invited(20)], 2, NOW);
    const msg = slotsHeldMessage(s, NOW);
    expect(msg).toContain("held for a tester finishing a revision");
    expect(msg).toMatch(/about 10 minutes/);
    expect(msg).not.toMatch(/limit|rejected|denied/i);
  });
});
