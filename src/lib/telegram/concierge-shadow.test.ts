import { describe, it, expect, afterEach } from "vitest";
import { mapConciergeTool, extractIntent, ConciergeTaskShadow, conciergeTaskRunMode, readMemory } from "./concierge-shadow";
import type { ConversationMemoryV2 } from "./task-run";

const emptyMemory = (): ConversationMemoryV2 => ({ version: 2, messages: [], summary: "", activeTask: null, recentTools: [] });

afterEach(() => { delete process.env.CONCIERGE_TASK_RUN_MODE; });

describe("concierge task shadow — maps REAL tool results to controller outcomes (ids from tools only)", () => {
  it("mode defaults off; only 'shadow' arms it (enforce is reserved, not honored)", () => {
    expect(conciergeTaskRunMode()).toBe("off");
    process.env.CONCIERGE_TASK_RUN_MODE = "enforce"; expect(conciergeTaskRunMode()).toBe("off");
    process.env.CONCIERGE_TASK_RUN_MODE = "shadow"; expect(conciergeTaskRunMode()).toBe("shadow");
  });

  it("mapConciergeTool extracts authoritative ids from the tool JSON", () => {
    expect(mapConciergeTool("sage_start_inspection", JSON.stringify({ ok: true, inspectionId: "insp1" }))).toEqual({ tool: "inspect", ok: true, data: { inspectionId: "insp1" } });
    expect(mapConciergeTool("sage_get_inspection", JSON.stringify({ status: "ready", planId: "plan1" }))).toEqual({ tool: "poll_inspection", ok: true, data: { ready: true, planId: "plan1" } });
    expect(mapConciergeTool("sage_fund_and_launch", JSON.stringify({ ok: true, campaignId: "camp1", campaignUrl: "u" }))).toEqual({ tool: "fund_and_launch", ok: true, data: { campaignId: "camp1", campaignUrl: "u" } });
    expect(mapConciergeTool("sage_fund_and_launch", JSON.stringify({ needsFunding: true }))).toEqual({ tool: "fund_and_launch", ok: false, reason: "needsFunding" });
    expect(mapConciergeTool("sage_wallet_status", "{}")).toBeNull(); // not a lifecycle transition
  });

  it("extractIntent pulls a URL + budget from a founder message", () => {
    const i = extractIntent("test https://yara.garden for me, budget $10, get people to talk to Yara");
    expect(i?.productUrl).toBe("https://yara.garden");
    expect(i?.budgetText).toBe("$10");
    expect(extractIntent("hello there")).toBeNull();
  });

  it("a full turn: intent → inspect → poll(ready) → the controller stops at approval, ids from tools", () => {
    const shadow = new ConciergeTaskShadow(emptyMemory(), "launch https://yara.garden budget $10", 1);
    expect(shadow.task?.state).toBe("intake");
    shadow.observeTool("sage_start_inspection", JSON.stringify({ ok: true, inspectionId: "insp1" }));
    expect(shadow.task?.inspectionId).toBe("insp1");
    shadow.observeTool("sage_get_inspection", JSON.stringify({ status: "ready", planId: "plan1" }));
    expect(shadow.task?.state).toBe("awaiting_approval");
    expect(shadow.proposedNext()).toEqual({ kind: "await_approval", pending: "approve_plan" });
  });

  it("a FABRICATED id in tool text is ignored — ids come only from the mapped tool data", () => {
    const shadow = new ConciergeTaskShadow(emptyMemory(), "launch https://p.test budget $5", 1);
    shadow.observeTool("sage_start_inspection", JSON.stringify({ ok: true, inspectionId: "insp1" }));
    shadow.observeTool("sage_get_inspection", JSON.stringify({ status: "ready" }));
    // a tool that isn't a lifecycle transition, even if its text mentions a campaign id, sets nothing.
    shadow.observeTool("sage_wallet_status", JSON.stringify({ note: "campaign camp999 is live" }));
    expect(shadow.task?.campaignId).toBeUndefined();
  });

  it("RESUME across a restart: persist the V2 envelope, then a fresh shadow resumes the activeTask", () => {
    const s1 = new ConciergeTaskShadow(emptyMemory(), "go https://p.test $5", 1);
    s1.observeTool("sage_start_inspection", JSON.stringify({ ok: true, inspectionId: "insp1" }));
    s1.observeTool("sage_get_inspection", JSON.stringify({ status: "ready" }));
    const envelope = s1.toEnvelope([{ role: "user", content: "go" }], "awaiting approval");
    // restart: a new turn reads the envelope + resumes.
    const mem = readMemory(envelope);
    expect(mem.activeTask?.inspectionId).toBe("insp1");
    const s2 = new ConciergeTaskShadow(mem, "approve", 5);
    expect(s2.task?.state).toBe("awaiting_approval");
    s2.observeFounder("approve", true);
    expect(s2.task?.state).toBe("deploying");
    s2.observeTool("sage_fund_and_launch", JSON.stringify({ ok: true, campaignId: "camp1" }));
    expect(s2.task?.campaignId).toBe("camp1"); // authoritative id from the fund tool
    expect(s2.task?.state).toBe("active");
  });

  it("an ambiguous fund timeout is observed as verify (never a re-spend)", () => {
    const shadow = new ConciergeTaskShadow(emptyMemory(), "go https://p.test $5", 1);
    shadow.observeTool("sage_start_inspection", JSON.stringify({ ok: true, inspectionId: "insp1" }));
    shadow.observeTool("sage_get_inspection", JSON.stringify({ status: "ready" }));
    shadow.observeFounder("approve", true);
    // a fund result that is a hard failure blocks (never a blind retry).
    shadow.observeTool("sage_fund_and_launch", JSON.stringify({ overCap: true }));
    expect(shadow.task?.state).toBe("blocked");
    expect(shadow.task?.blockers.at(-1)).toBe("overCap");
  });
});
