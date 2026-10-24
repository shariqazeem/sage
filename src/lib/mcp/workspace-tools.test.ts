import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * AN OWNER'S AGENT SEES AND RUNS ONLY ITS SCOPES, AND IS ALWAYS THE OWNER. A caller can't name
 * another founder: founderOverride and clientRef are dropped, and the owner is bound server-side.
 */
const h = vi.hoisted(() => ({ calls: [] as Array<{ name: string; args: Record<string, unknown>; founderWallet?: string }>, launch: vi.fn() }));

vi.mock("./server", async (orig) => {
  const real = await orig<typeof import("./server")>();
  return {
    ...real,
    callSageTool: async (name: string, args: Record<string, unknown>, ctx: { founderWallet?: string }) => {
      h.calls.push({ name, args, founderWallet: ctx.founderWallet });
      return { content: [{ type: "text", text: "{}" }], isError: false };
    },
  };
});
vi.mock("@/lib/treasury/launch", () => ({ launchFromTreasury: (...a: unknown[]) => h.launch(...a), webTreasuryStatus: async () => null }));
vi.mock("@/lib/campaigns/launchable", () => ({ listLaunchablePlans: () => [{ inspectionId: "insp_ready" }] }));

import { callWorkspaceTool, workspaceTools } from "./workspace-tools";
import type { AgentKeyScope } from "@/lib/db/schema";

const OWNER = "0xAbCdEf0000000000000000000000000000000001";
const ctx = (scopes: AgentKeyScope[]) => ({ founder: OWNER, scopes: new Set(scopes), scheduleAfter: () => {} });
const names = (scopes: AgentKeyScope[]) => workspaceTools(new Set(scopes)).map((t) => t.name);

beforeEach(() => {
  h.calls = [];
  h.launch.mockReset();
});

describe("workspace agent tools", () => {
  it("lists only what the key's scopes allow", () => {
    expect(names(["read"])).toContain("sage_my_campaigns");
    expect(names(["read"])).toContain("sage_account");
    expect(names(["read"])).not.toContain("sage_start_inspection");
    expect(names(["read"])).not.toContain("sage_launch_from_account");
    expect(names(["read", "plan"])).toContain("sage_create_direct_campaign");
    expect(names(["read", "plan", "launch"])).toContain("sage_launch_from_account");
  });

  it("refuses a tool outside the key's scopes, and runs nothing", async () => {
    const r = await callWorkspaceTool("sage_launch_from_account", {}, ctx(["read", "plan"]));
    expect(r?.isError).toBe(true);
    expect(h.launch).not.toHaveBeenCalled();
  });

  it("binds the owner server-side and drops any founder the caller names", async () => {
    await callWorkspaceTool("sage_start_inspection", { productUrl: "https://x.example", founderOverride: "0xevil", clientRef: "spoof" }, ctx(["read", "plan"]));
    expect(h.calls[0]).toMatchObject({ name: "sage_start_inspection", founderWallet: OWNER });
    expect(h.calls[0]!.args.founderOverride).toBe(OWNER.toLowerCase());
    expect(h.calls[0]!.args.clientRef).toBeUndefined();
    await callWorkspaceTool("sage_my_campaigns", { founderOverride: "0xevil" }, ctx(["read"]));
    expect(h.calls[1]!.args.founderOverride).toBeUndefined();
    expect(h.calls[1]!.founderWallet).toBe(OWNER);
  });

  it("launches the owner's own ready plan from their account, through the same door as their button", async () => {
    h.launch.mockResolvedValue({ ok: true, campaignId: "c1", vault: "0xvault", steps: [{ step: "create", txHash: "0x1", explorerUrl: "https://x/1" }] });
    const r = await callWorkspaceTool("sage_launch_from_account", {}, ctx(["read", "launch"]));
    expect(h.launch).toHaveBeenCalledWith(OWNER, "insp_ready");
    expect(JSON.parse(r!.content[0]!.text)).toMatchObject({ ok: true, campaignId: "c1" });
  });

  it("knows nothing outside its surface", async () => {
    expect(await callWorkspaceTool("sage_fund_and_launch", {}, ctx(["read", "plan", "launch"]))).toBeNull();
  });
});
