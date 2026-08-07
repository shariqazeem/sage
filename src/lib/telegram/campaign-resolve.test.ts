import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * WHAT THE FOUNDER SAYS, RESOLVED TO A CAMPAIGN THEY OWN.
 *
 * Measured live in the bot, twice over, on a campaign the founder owns and Sage had just listed
 * back to them:
 *
 *   "Stop the kyvernlabs campaign"
 *     -> "I don't have a campaign id 'kyvernlabs' in this conversation..."   (no lookup on Telegram)
 *   "Stop both"  ->  "Yes"
 *     -> "Both campaigns aren't found in the system."                        (passed the product name)
 *
 * The second failure is this one: holding the list, Sage passed what it had been showing the
 * founder — "kyvernlabs.com" — where an opaque `launch-kyvernlabs-com-63rjdf` was required. A
 * walletless founder never sees that id, so requiring it made the tool unusable by exactly the
 * person the walletless path exists for.
 *
 * Widening what can be SAID must not widen what can be REACHED: the search runs only over the
 * campaigns this chat's wallet owns.
 */

const h = vi.hoisted(() => ({
  overview: { campaigns: [] as { id: string; title: string; status: string }[] },
}));

vi.mock("@/lib/campaigns/overview", () => ({
  getDeputyOverview: (wallet: string | null) =>
    wallet === MINE ? h.overview : { campaigns: [] },
}));

const MINE = "0x3a60af43c67dd9d552f180d30d9a042948078341";
const SOMEONE_ELSE = "0x00000000000000000000000000000000000000ff";

import { resolveOwnedCampaign } from "./agent-wallet-tools";

const KYVERN = { id: "launch-kyvernlabs-com-63rjdf", title: "Testing campaign · kyvernlabs.com", status: "live" };
const YARA = { id: "launch-yara-garden-cerk8k", title: "Testing campaign · yara.garden", status: "live" };

beforeEach(() => {
  h.overview.campaigns = [KYVERN, YARA];
});

describe("resolveOwnedCampaign", () => {
  it("resolves the exact id, which is what a machine passes", () => {
    expect(resolveOwnedCampaign(MINE, KYVERN.id)).toEqual({ kind: "one", id: KYVERN.id });
  });

  it("resolves the product hostname — the live failure", () => {
    expect(resolveOwnedCampaign(MINE, "kyvernlabs.com")).toEqual({ kind: "one", id: KYVERN.id });
  });

  it("resolves the bare product name a founder actually types", () => {
    expect(resolveOwnedCampaign(MINE, "kyvernlabs")).toEqual({ kind: "one", id: KYVERN.id });
  });

  it("resolves a full url with a path", () => {
    expect(resolveOwnedCampaign(MINE, "https://kyvernlabs.com/pricing")).toEqual({
      kind: "one",
      id: KYVERN.id,
    });
  });

  it("tells the two campaigns apart", () => {
    expect(resolveOwnedCampaign(MINE, "yara.garden")).toEqual({ kind: "one", id: YARA.id });
  });

  it("NEVER reaches a campaign the wallet does not own", () => {
    // The whole point: the needle got looser, the ownership set did not.
    expect(resolveOwnedCampaign(SOMEONE_ELSE, "kyvernlabs.com")).toEqual({ kind: "none" });
    expect(resolveOwnedCampaign(SOMEONE_ELSE, KYVERN.id)).toEqual({ kind: "none" });
  });

  it("reports ambiguity rather than guessing, because stopping cannot be undone", () => {
    const second = { id: "launch-kyvernlabs-com-zzzzzz", title: "Testing campaign · kyvernlabs.com", status: "live" };
    h.overview.campaigns = [KYVERN, second];
    const out = resolveOwnedCampaign(MINE, "kyvernlabs.com");
    expect(out.kind).toBe("ambiguous");
    if (out.kind !== "ambiguous") return;
    expect(out.candidates.map((c) => c.id).sort()).toEqual([KYVERN.id, second.id].sort());
  });

  it("prefers the running campaign when a stopped one shares the product", () => {
    // "stop my kyvernlabs campaign" is about the live one; a cancelled twin must not make it
    // ambiguous and send the founder round the loop again.
    h.overview.campaigns = [
      { id: "launch-kyvernlabs-com-old", title: "Testing campaign · kyvernlabs.com", status: "cancelled" },
      KYVERN,
    ];
    expect(resolveOwnedCampaign(MINE, "kyvernlabs.com")).toEqual({ kind: "one", id: KYVERN.id });
  });

  it("says none rather than picking something for an unrelated name", () => {
    expect(resolveOwnedCampaign(MINE, "stripe.com")).toEqual({ kind: "none" });
  });

  it("says none for empty input instead of matching the first campaign", () => {
    expect(resolveOwnedCampaign(MINE, "")).toEqual({ kind: "none" });
    expect(resolveOwnedCampaign(MINE, "   ")).toEqual({ kind: "none" });
  });

  it("does not match on a stem too short to mean anything", () => {
    h.overview.campaigns = [{ id: "launch-ab-co-xyz", title: "Testing campaign · ab.co", status: "live" }];
    // "ab" is 2 chars — matching on it would make almost any word resolve to this campaign.
    expect(resolveOwnedCampaign(MINE, "abandoned").kind).toBe("none");
  });
});
