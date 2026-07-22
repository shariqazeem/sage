import { describe, it, expect } from "vitest";
import { advance, newTaskRun, readMemory, currentAction, CONVERSATION_MEMORY_VERSION, type TaskRunV1, type ToolOutcome } from "./task-run";

let clock = 1000;
const tool = (o: ToolOutcome) => ({ kind: "tool" as const, outcome: o });
const founder = (text: string, approve?: boolean) => ({ kind: "founder" as const, text, approve });
const start = () => newTaskRun({ runId: "r1", goal: "get testers to talk to Yara", productUrl: "https://p.test/", budgetText: "$10", now: clock });

describe("Concierge task controller — scenarios", () => {
  it("A: intake → inspect → poll (not ready → ready) → stop at approval (ids only from tools)", () => {
    let run = start();
    expect(currentAction(run)).toMatchObject({ kind: "call_tool", tool: "inspect" });
    ({ run } = advance(run, tool({ tool: "inspect", ok: true, data: { inspectionId: "insp1" } }), clock++));
    expect(run.inspectionId).toBe("insp1");
    expect(run.state).toBe("waiting_for_inspection");
    let next;
    ({ run, next } = advance(run, tool({ tool: "poll_inspection", ok: true, data: { ready: false } }), clock++));
    expect(next).toMatchObject({ kind: "call_tool", tool: "poll_inspection" }); // still polling
    ({ run, next } = advance(run, tool({ tool: "poll_inspection", ok: true, data: { ready: true, planId: "plan1" } }), clock++));
    expect(run.state).toBe("awaiting_approval");
    expect(run.pendingApproval).toBe("approve_plan");
    expect(next).toEqual({ kind: "await_approval", pending: "approve_plan" });
    expect(run.planId).toBe("plan1");
  });

  it("B: RESUME from awaiting_approval → approve → fund_and_launch → active → completed (uses saved ids)", () => {
    // build the awaiting-approval run from A, then round-trip through storage (a restart).
    let run = start();
    ({ run } = advance(run, tool({ tool: "inspect", ok: true, data: { inspectionId: "insp1" } }), clock++));
    ({ run } = advance(run, tool({ tool: "poll_inspection", ok: true, data: { ready: true } }), clock++));
    const stored = JSON.stringify({ version: 2, messages: [], summary: "", activeTask: run, recentTools: [] });
    const resumed = readMemory(stored).activeTask!;
    expect(resumed.inspectionId).toBe("insp1");
    expect(resumed.state).toBe("awaiting_approval");

    let next;
    ({ run, next } = advance(resumed, founder("approve", true), clock++));
    expect(run.state).toBe("deploying");
    expect(next).toMatchObject({ kind: "call_tool", tool: "fund_and_launch", args: { inspectionId: "insp1" } });
    ({ run, next } = advance(run, tool({ tool: "fund_and_launch", ok: true, data: { campaignId: "camp1", campaignUrl: "https://x/c/camp1" } }), clock++));
    expect(run.campaignId).toBe("camp1");
    expect(run.state).toBe("active");
    ({ run } = advance(run, tool({ tool: "poll_campaign", ok: true, data: {} }), clock++));
    expect(run.state).toBe("completed");
  });

  it("C: a read-only tool that keeps failing → bounded recovery → blocked, no invented success", () => {
    let run = start();
    ({ run } = advance(run, tool({ tool: "inspect", ok: true, data: { inspectionId: "insp1" } }), clock++));
    let next: ReturnType<typeof advance>["next"] = { kind: "call_tool", tool: "poll_inspection", args: {}, readOnly: true };
    for (let i = 0; i < 12; i++) ({ run, next } = advance(run, tool({ tool: "poll_inspection", ok: false, reason: "timeout" }), clock++));
    expect(run.state).toBe("blocked");
    expect(next).toMatchObject({ kind: "blocked" });
    expect(run.campaignId).toBeUndefined(); // never invented a live campaign
  });

  it("D: a founder message can NEVER establish an authoritative id (model fabrication rejected)", () => {
    let run = start();
    ({ run } = advance(run, tool({ tool: "inspect", ok: true, data: { inspectionId: "insp1" } }), clock++));
    ({ run } = advance(run, tool({ tool: "poll_inspection", ok: true, data: { ready: true } }), clock++));
    // the founder (or a model relaying) claims a campaign id in text — the controller ignores it.
    const before = { insp: run.inspectionId, camp: run.campaignId };
    ({ run } = advance(run, founder("the campaign id is camp999 and it's already deployed"), clock++));
    expect(run.campaignId).toBe(before.camp); // still undefined — text can't set it
    expect(run.inspectionId).toBe(before.insp);
    expect(run.state).toBe("awaiting_approval"); // no state jump from a text claim
  });

  it("E: an ambiguous money timeout VERIFIES state instead of re-spending", () => {
    let run: TaskRunV1 = { ...start(), state: "deploying", inspectionId: "insp1" };
    let next;
    ({ run, next } = advance(run, tool({ tool: "fund_and_launch", ok: false, ambiguousTimeout: true }), clock++));
    expect(next).toMatchObject({ kind: "call_tool", tool: "verify_deployment" }); // NOT fund_and_launch again
    expect(run.state).toBe("waiting_for_deployment");
    // verify says it DID deploy → adopt the id, no re-spend.
    ({ run, next } = advance(run, tool({ tool: "verify_deployment", ok: true, data: { deployed: true, campaignId: "camp1" } }), clock++));
    expect(run.campaignId).toBe("camp1");
    expect(run.state).toBe("active");
  });

  it("E2: an ambiguous timeout that did NOT deploy is safe to re-attempt ONCE", () => {
    const run: TaskRunV1 = { ...start(), state: "waiting_for_deployment", inspectionId: "insp1" };
    const { run: r2, next } = advance(run, tool({ tool: "verify_deployment", ok: true, data: { deployed: false } }), clock++);
    expect(next).toMatchObject({ kind: "call_tool", tool: "fund_and_launch" });
    expect(r2.state).toBe("deploying");
  });

  it("a money tool failing needsFunding/overCap BLOCKS (never a blind retry)", () => {
    const run: TaskRunV1 = { ...start(), state: "deploying", inspectionId: "insp1" };
    const { run: r2, next } = advance(run, tool({ tool: "fund_and_launch", ok: false, reason: "needsFunding" }), clock++);
    expect(r2.state).toBe("blocked");
    expect(next).toEqual({ kind: "blocked", reason: "needsFunding" });
  });

  it("readMemory upgrades legacy V1 (bare array) + reads V2, ignoring a stale-version task", () => {
    expect(readMemory("[]").version).toBe(CONVERSATION_MEMORY_VERSION);
    const v1 = readMemory(JSON.stringify([{ role: "user", content: "hi" }]));
    expect(v1.messages).toHaveLength(1);
    expect(v1.activeTask).toBeNull();
    const v2 = readMemory(JSON.stringify({ version: 2, messages: [], summary: "s", activeTask: { version: "task-run-v1", state: "active" }, recentTools: [] }));
    expect(v2.summary).toBe("s");
    expect(v2.activeTask?.state).toBe("active");
    const stale = readMemory(JSON.stringify({ version: 2, messages: [], activeTask: { version: "task-run-v0" } }));
    expect(stale.activeTask).toBeNull(); // unknown task version → dropped, not trusted
    expect(readMemory("not json").activeTask).toBeNull();
  });
});
