import { describe, it, expect, vi } from "vitest";

import { callSageTool, MCP_TOOLS, MCP_SERVER_INFO, type McpContext } from "./server";

const ctx = (scheduleAfter = vi.fn()): McpContext => ({ scheduleAfter });

describe("MCP tool registry", () => {
  it("exposes exactly the sage tools, each with an object input schema", () => {
    expect(MCP_TOOLS.map((t) => t.name)).toEqual([
      "sage_start_inspection",
      "sage_get_inspection",
      "sage_answer_questions",
      "sage_get_campaign",
      "sage_get_submission",
      "sage_get_proof",
    ]);
    for (const t of MCP_TOOLS) {
      expect(t.inputSchema).toMatchObject({ type: "object" });
      expect(typeof t.description).toBe("string");
    }
  });

  it("server info is stable", () => {
    expect(MCP_SERVER_INFO).toEqual({ name: "sage", version: "1.0.0" });
  });
});

describe("callSageTool dispatch", () => {
  it("returns null for an unknown tool (route turns this into an SDK protocol error)", async () => {
    expect(await callSageTool("sage_drain_the_vault", {}, ctx())).toBeNull();
  });

  it("get_inspection for a bogus id → isError result, not a throw", async () => {
    const r = await callSageTool("sage_get_inspection", { inspectionId: "does-not-exist" }, ctx());
    expect(r?.isError).toBe(true);
    expect(r?.content[0]!.text.toLowerCase()).toContain("not found");
  });

  it("get_submission for a bogus id → isError", async () => {
    const r = await callSageTool("sage_get_submission", { submissionId: "nope" }, ctx());
    expect(r?.isError).toBe(true);
  });

  it("answer_questions for a bogus id → isError, schedules no re-plan", async () => {
    const scheduleAfter = vi.fn();
    const r = await callSageTool("sage_answer_questions", { inspectionId: "nope", answer: "the wishing tree should work" }, ctx(scheduleAfter));
    expect(r?.isError).toBe(true);
    expect(scheduleAfter).not.toHaveBeenCalled();
  });

  it("get_campaign for a bogus id → isError", async () => {
    const r = await callSageTool("sage_get_campaign", { campaignId: "nope" }, ctx());
    expect(r?.isError).toBe(true);
  });

  it("start_inspection with a loopback URL is SSRF-rejected and schedules no job", async () => {
    const scheduleAfter = vi.fn();
    const r = await callSageTool(
      "sage_start_inspection",
      { productUrl: "http://localhost/evil", goal: "g", targetUsers: "u", budgetUsd: 1 },
      ctx(scheduleAfter),
    );
    expect(r?.isError).toBe(true);
    expect(scheduleAfter).not.toHaveBeenCalled();
  });
});
