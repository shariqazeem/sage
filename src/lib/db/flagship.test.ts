import { describe, expect, it, vi } from "vitest";
import { db } from "./index";
import { campaigns } from "./schema";
import { nowSeconds } from "./keys";
import {
  FLAGSHIP_CAMPAIGN_ID,
  ensureFlagshipCampaign,
  getCampaign,
} from "./campaigns";

/**
 * Production naming: the flagship campaign seeds under a production slug and the
 * legacy `demo` row is retired (a redirect keeps old links alive). DB-backed
 * against the isolated in-memory SQLite.
 */
describe("ensureFlagshipCampaign — production naming", () => {
  it("seeds the founding-testers flagship (live) and retires a legacy `demo` row", () => {
    vi.stubEnv("GOAT_VAULT_ADDRESS", "");
    vi.stubEnv("NEXT_PUBLIC_VAULT_ADDRESS", "0x0000000000000000000000000000000000000abc");

    // a pre-existing legacy `demo` row, still soliciting
    db.insert(campaigns)
      .values({
        id: "demo",
        title: "Break Sage's onboarding",
        descriptionMd: "",
        criteria: [],
        conditionType: "approval",
        rewardAmount: 500_000,
        maxRecipients: 4,
        vaultAddress: "0x0000000000000000000000000000000000000abc",
        chainId: 59902,
        posterWallet: "0x0000000000000000000000000000000000000abc",
        ownerIsSage: true,
        status: "live",
        autonomy: "manual",
        autopilotThreshold: 0.85,
        createdAt: nowSeconds(),
      })
      .run();

    ensureFlagshipCampaign();

    const flagship = getCampaign(FLAGSHIP_CAMPAIGN_ID);
    expect(flagship?.id).toBe("founding-testers");
    expect(flagship?.status).toBe("live");

    // the legacy row is closed — no longer accepts submissions
    expect(getCampaign("demo")?.status).toBe("completed");

    vi.unstubAllEnvs();
  });
});
