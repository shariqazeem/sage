import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * PAY ON THE WEB (relaunch, 20 Nov 2026): with TELEGRAM_LAUNCH_ON_WEB=1, a launch asked for in chat hands
 * the founder the test's own page, where they pay from a wallet they control. Nothing is spent from the
 * chat's server wallet, and the switch off leaves the old door exactly as it was.
 */

const h = vi.hoisted(() => ({ deploy: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/privy/onboarding", () => ({
  founderBinding: (chatId: string) =>
    chatId === "metisChat"
      ? { chatId, founderAddress: "0x5555555555555555555555555555555555555555", privyWalletId: "pw_m", privyWalletAddress: "0x5555555555555555555555555555555555555555", policyId: "pol_m", perCampaignCapBase: 50_000_000, chainId: 1088 }
      : null,
  onboardWalletless: vi.fn(),
  treasuryChainId: () => 1088,
}));
vi.mock("@/lib/privy/deploy-runner", () => ({ deployCampaignViaPrivy: (...a: unknown[]) => h.deploy(...a) }));

import { callAgentWalletTool } from "./agent-wallet-tools";

const run = async (name: string, args: Record<string, unknown>, chat: string) =>
  JSON.parse((await callAgentWalletTool(name, args, chat)).content[0]?.text ?? "{}");

afterEach(() => {
  vi.unstubAllEnvs();
  h.deploy.mockReset();
});

describe("sage_fund_and_launch with TELEGRAM_LAUNCH_ON_WEB=1", () => {
  it("hands over the test's own page for a named plan and spends nothing", async () => {
    vi.stubEnv("TELEGRAM_LAUNCH_ON_WEB", "1");
    const r = await run("sage_fund_and_launch", { inspectionId: "insp_abc" }, "metisChat");
    expect(r).toMatchObject({ ok: false, payOnWeb: true });
    expect(r.url).toMatch(/\/t\/insp_abc$/);
    expect(r.message).toMatch(/Nothing has moved/);
    expect(h.deploy).not.toHaveBeenCalled();
  });

  it("works for a chat that never set up a wallet", async () => {
    vi.stubEnv("TELEGRAM_LAUNCH_ON_WEB", "1");
    const r = await run("sage_fund_and_launch", { inspectionId: "insp_new" }, "freshChat");
    expect(r).toMatchObject({ ok: false, payOnWeb: true });
    expect(r.url).toMatch(/\/t\/insp_new$/);
    expect(h.deploy).not.toHaveBeenCalled();
  });

  it("says so when there's no plan to launch", async () => {
    vi.stubEnv("TELEGRAM_LAUNCH_ON_WEB", "1");
    const r = await run("sage_fund_and_launch", {}, "freshChat");
    expect(r).toMatchObject({ ok: false, payOnWeb: true });
    expect(r.url).toBeUndefined();
    expect(r.message).toMatch(/no ready plan/);
  });
});

describe("sage_fund_and_launch with the switch off", () => {
  it("keeps the chat-wallet door as it was", async () => {
    const r = await run("sage_fund_and_launch", { inspectionId: "insp_abc" }, "freshChat");
    expect(r.payOnWeb).toBeUndefined();
    expect(r.error).toMatch(/set up an agent wallet/);
  });
});
