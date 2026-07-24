import { describe, it, expect, vi } from "vitest";

/**
 * Defense-in-depth for the request-scoped identity model. `opStartInspection` must refuse to
 * surface a plan or a fundable approvalUrl when the returned job doesn't belong to THIS founder
 * turn — either its stored goal differs (`stale_task_result`) or its stored request id differs
 * (`request_identity_mismatch`). It also relays a fail-closed mismatch from the create layer.
 */

const { startInspectionMock } = vi.hoisted(() => ({ startInspectionMock: vi.fn() }));
vi.mock("@/lib/launch/start", () => ({ startInspection: startInspectionMock }));
vi.mock("@/lib/site", () => ({ siteUrl: () => "https://sagepays.xyz" }));

const { opStartInspection } = await import("./operations");

const REQ = "prid:tg:req-current";
const body = (goal: string) => ({ productUrl: "https://yara.garden/", repoUrl: null, goal, targetUsers: "u", budgetUsd: 1.5 });

describe("opStartInspection — request/goal identity guard", () => {
  it("BLOCKS stale_task_result when the returned job's goal ≠ the requested goal", () => {
    startInspectionMock.mockReturnValue({
      ok: true,
      created: false,
      job: { id: "6PciNNBK3f1A", goal: "Does a first-time visitor understand what yara.garden is…", planningRequestId: REQ },
    });
    const r = opStartInspection(body("make users land in yara.garden and talk to yara"), "chat-1", REQ);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe("blocked: stale_task_result");
      expect(r.status).toBe(409);
    }
  });

  it("BLOCKS request_identity_mismatch when the returned job's request id ≠ the turn's", () => {
    startInspectionMock.mockReturnValue({
      ok: true,
      created: false,
      job: { id: "otherJob", goal: "talk to yara", planningRequestId: "prid:tg:req-OTHER" },
    });
    const r = opStartInspection(body("talk to yara"), "chat-1", REQ);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe("blocked: request_identity_mismatch");
      expect(r.status).toBe(409);
    }
  });

  it("RELAYS a fail-closed request_identity_mismatch from the create layer", () => {
    startInspectionMock.mockReturnValue({ ok: false, error: "request_identity_mismatch" });
    const r = opStartInspection(body("talk to yara"), "chat-1", REQ);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe("blocked: request_identity_mismatch");
      expect(r.status).toBe(409);
    }
  });

  it("passes through when goal + request id both match (boundary-trim tolerant, case-exact)", () => {
    startInspectionMock.mockReturnValue({
      ok: true,
      created: true,
      job: { id: "freshId12345", goal: "Talk to Yara", planningRequestId: REQ },
    });
    const r = opStartInspection(body("  Talk to Yara  "), "chat-1", REQ);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.inspectionId).toBe("freshId12345");
      expect(r.approvalUrl).toContain("freshId12345");
      expect(r.planningRequestId).toBe(REQ);
    }
  });
});
