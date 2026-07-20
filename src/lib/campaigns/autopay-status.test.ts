import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/deputy/observation-judge", () => ({ observationAutopayEnabled: vi.fn(() => false) }));
vi.mock("@/lib/env", () => ({ mainnetAutopilotEnabled: vi.fn(() => false) }));

import { campaignAutopays } from "./autopay-status";
import { observationAutopayEnabled } from "@/lib/deputy/observation-judge";
import { mainnetAutopilotEnabled } from "@/lib/env";

const obs = { verifiabilityClass: "observation-based" as const };
const url = { verifiabilityClass: "url-verifiable" as const };
const autopilot = { autonomy: "autopilot" };

afterEach(() => vi.clearAllMocks());

/**
 * P23 truth-state: the board headline may promise "paid automatically" ONLY when this returns true, so
 * the promise can never outrun the flag. Conservative — the weakest lane governs a mixed campaign.
 */
describe("campaignAutopays", () => {
  it("manual autonomy never autopays, whatever the flags", () => {
    vi.mocked(observationAutopayEnabled).mockReturnValue(true);
    expect(campaignAutopays({ autonomy: "manual" }, [obs], true)).toBe(false);
  });

  it("observation lane needs OBSERVATION_AUTOPAY", () => {
    vi.mocked(observationAutopayEnabled).mockReturnValue(false);
    expect(campaignAutopays(autopilot, [obs], true)).toBe(false);
    vi.mocked(observationAutopayEnabled).mockReturnValue(true);
    expect(campaignAutopays(autopilot, [obs], true)).toBe(true);
  });

  it("url lane on TESTNET autopays regardless of the mainnet flag", () => {
    vi.mocked(mainnetAutopilotEnabled).mockReturnValue(false);
    expect(campaignAutopays(autopilot, [url], true)).toBe(true);
  });

  it("url lane on MAINNET needs DEPUTY_AUTOPILOT_MAINNET", () => {
    vi.mocked(mainnetAutopilotEnabled).mockReturnValue(false);
    expect(campaignAutopays(autopilot, [url], false)).toBe(false);
    vi.mocked(mainnetAutopilotEnabled).mockReturnValue(true);
    expect(campaignAutopays(autopilot, [url], false)).toBe(true);
  });

  it("mixed campaign: the WEAKEST lane governs (obs off → no promise even if url is armed)", () => {
    vi.mocked(observationAutopayEnabled).mockReturnValue(false);
    vi.mocked(mainnetAutopilotEnabled).mockReturnValue(true);
    expect(campaignAutopays(autopilot, [obs, url], false)).toBe(false);
  });
});
