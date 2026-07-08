import { describe, expect, it } from "vitest";
import type { CampaignEvent } from "@/lib/db/schema";
import { decodeDetail, encodeDetail, journalMeta, toJournalEntries } from "./journal";

function ev(partial: Partial<CampaignEvent>): CampaignEvent {
  return {
    id: "e1",
    campaignId: "c1",
    submissionId: null,
    kind: "settled",
    detail: null,
    txHash: null,
    logIndex: null,
    vaultAddress: null,
    amount: null,
    failedCheckIndex: null,
    createdAt: 100,
    ...partial,
  };
}

describe("journalMeta", () => {
  it("maps each kind to the right design-system tone", () => {
    expect(journalMeta("settled").tone).toBe("settled");
    expect(journalMeta("blocked").tone).toBe("blocked");
    expect(journalMeta("revoked").tone).toBe("blocked");
    expect(journalMeta("vendor_allowlisted").tone).toBe("timelocked");
    expect(journalMeta("campaign_created").tone).toBe("action");
    expect(journalMeta("submission_received").tone).toBe("neutral");
  });
});

describe("toJournalEntries", () => {
  it("orders newest first and carries the on-chain fields", () => {
    const rows = [
      ev({ id: "a", kind: "campaign_created", createdAt: 100 }),
      ev({ id: "b", kind: "settled", createdAt: 300, txHash: "0xabc", amount: 10_000_000 }),
      ev({ id: "c", kind: "blocked", createdAt: 200, failedCheckIndex: 4 }),
    ];
    const out = toJournalEntries(rows);
    expect(out.map((e) => e.id)).toEqual(["b", "c", "a"]);
    expect(out[0]).toMatchObject({
      tone: "settled",
      txHash: "0xabc",
      amountBase: 10_000_000,
    });
    expect(out[1]).toMatchObject({ tone: "blocked", failedCheckIndex: 4 });
  });

  it("does not mutate the input array", () => {
    const rows = [ev({ id: "a", createdAt: 1 }), ev({ id: "b", createdAt: 2 })];
    toJournalEntries(rows);
    expect(rows.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("decodes a cid envelope into display text + correlation id", () => {
    const out = toJournalEntries([
      ev({ id: "x", detail: encodeDetail("0xabc · held for review", { cid: "run123" }) }),
    ]);
    expect(out[0].detail).toBe("0xabc · held for review");
    expect(out[0].cid).toBe("run123");
  });
});

describe("encodeDetail / decodeDetail — cid envelope, backward compatible", () => {
  it("round-trips an envelope, passes plain text through, and omits the envelope with no cid", () => {
    const enc = encodeDetail("0xabc · held", { cid: "run123" });
    expect(decodeDetail(enc)).toEqual({ text: "0xabc · held", cid: "run123" });
    // legacy / non-pipeline plain strings decode to themselves with a null cid
    expect(decodeDetail("plain legacy text")).toEqual({ text: "plain legacy text", cid: null });
    // no cid → no envelope (stays a plain string)
    expect(encodeDetail("no cid")).toBe("no cid");
    expect(decodeDetail(null)).toEqual({ text: null, cid: null });
  });
});
