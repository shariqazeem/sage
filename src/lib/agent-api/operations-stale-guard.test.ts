import { describe, it, expect, vi } from "vitest";

/**
 * Defense-in-depth for the stale-intent incident: even if idempotency ever handed back a job whose
 * stored goal differs from what the founder just asked, opStartInspection must refuse to surface a plan
 * or a fundable approvalUrl — it returns `blocked: stale_task_result`.
 */

const { startInspectionMock } = vi.hoisted(() => ({ startInspectionMock: vi.fn() }));
vi.mock("@/lib/launch/start", () => ({ startInspection: startInspectionMock }));
vi.mock("@/lib/site", () => ({ siteUrl: () => "https://sagepays.xyz" }));

const { opStartInspection } = await import("./operations");

const body = (goal: string) => ({ productUrl: "https://yara.garden/", repoUrl: null, goal, targetUsers: "u", budgetUsd: 1.5 });

describe("opStartInspection — stale-intent guard", () => {
  it("BLOCKS when the returned job's goal ≠ the requested goal (the incident)", () => {
    startInspectionMock.mockReturnValue({
      ok: true,
      created: false,
      job: { id: "6PciNNBK3f1A", goal: "Does a first-time visitor understand what yara.garden is…" },
    });
    const r = opStartInspection(body("make users land in yara.garden and talk to yara"), "chat-1");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe("blocked: stale_task_result");
      expect(r.status).toBe(409);
    }
  });

  it("passes through when the job's goal matches the request (canonicalization-tolerant)", () => {
    startInspectionMock.mockReturnValue({ ok: true, created: true, job: { id: "freshId12345", goal: "talk to yara" } });
    const r = opStartInspection(body("  Talk to Yara  "), "chat-1");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.inspectionId).toBe("freshId12345");
      expect(r.approvalUrl).toContain("freshId12345");
    }
  });
});
