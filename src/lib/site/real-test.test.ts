import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { db } from "@/lib/db";
import { campaignSharing } from "@/lib/db/schema";
import { setSharing } from "@/lib/sharing";
import { OWN_WALLETS } from "@/lib/campaigns/settled-ledger";
import { consented } from "./real-test";

/** A builder's product reaches Sage's public front door only with their yes, or when the test is Sage's own. */

beforeEach(() => {
  db.delete(campaignSharing).run();
});

const stranger = "0x1234567890abcdef1234567890abcdef12345678";

describe("consented", () => {
  it("refuses a builder's test with no answer, and one not yet funded", () => {
    expect(consented({ founderWallet: stranger, publicCampaignId: "gig-quiet" })).toBe(false);
    expect(consented({ founderWallet: stranger, publicCampaignId: "" })).toBe(false);
  });

  it("refuses a builder who shares on X but keeps the findings private", () => {
    setSharing("gig-x-only", { postMission: true, findingsPublic: false });
    expect(consented({ founderWallet: stranger, publicCampaignId: "gig-x-only" })).toBe(false);
  });

  it("shows a test whose builder made the findings public", () => {
    setSharing("gig-public", { findingsPublic: true });
    expect(consented({ founderWallet: stranger, publicCampaignId: "gig-public" })).toBe(true);
  });

  it("shows Sage's own tests", () => {
    const own = OWN_WALLETS.find((w) => /^0x[0-9a-f]{40}$/i.test(w));
    expect(own).toBeTruthy();
    expect(consented({ founderWallet: own!, publicCampaignId: "" })).toBe(true);
  });
});
