import { describe, expect, it } from "vitest";
import {
  autopilotGate,
  casOutcome,
  gateFromBrief,
  lockOutcome,
  type GateInput,
} from "./autopilot";
import type { DecisionBrief } from "./brain-core";

const base: GateInput = {
  autonomy: "autopilot",
  status: "pending",
  engine: "llm",
  recommendation: "pay",
  confidence: 0.9,
  threshold: 0.85,
  hasHighFraud: false,
};

describe("autopilotGate — the exact gate", () => {
  it("pays only when every condition holds", () => {
    expect(autopilotGate(base).pay).toBe(true);
  });

  const cases: [string, Partial<GateInput>, boolean][] = [
    ["manual campaign", { autonomy: "manual" }, false],
    ["already handled (not pending)", { status: "approved" }, false],
    ["settling (a race already owns it)", { status: "settling" }, false],
    ["heuristic engine — LLM pending", { engine: "heuristic" }, false],
    ["recommendation = review", { recommendation: "review" }, false],
    ["recommendation = hold", { recommendation: "hold" }, false],
    ["high-severity fraud signal", { hasHighFraud: true }, false],
    ["confidence just below threshold", { confidence: 0.84 }, false],
    ["confidence exactly at threshold", { confidence: 0.85 }, true],
    ["confidence far above threshold", { confidence: 0.99 }, true],
  ];
  for (const [name, over, expected] of cases) {
    it(`${expected ? "pays" : "holds"}: ${name}`, () => {
      expect(autopilotGate({ ...base, ...over }).pay).toBe(expected);
    });
  }

  it("the heuristic engine can NEVER auto-pay, even when it would otherwise clear", () => {
    // recommendation pay, confidence 1.0, no fraud — still held because engine != llm.
    expect(
      autopilotGate({ ...base, engine: "heuristic", confidence: 1 }).pay,
    ).toBe(false);
    expect(
      autopilotGate({ ...base, engine: "heuristic" }).reason,
    ).toMatch(/LLM pending/i);
  });

  it("surfaces a held reason for each block", () => {
    expect(autopilotGate({ ...base, hasHighFraud: true }).reason).toMatch(/fraud/i);
    expect(autopilotGate({ ...base, confidence: 0.5 }).reason).toMatch(/below/i);
    expect(autopilotGate({ ...base, recommendation: "hold" }).reason).toMatch(/hold/i);
  });
});

describe("gateFromBrief — reads the brief's fraud signals", () => {
  const clean: DecisionBrief = {
    engine: "llm",
    model: "deepseek/deepseek-v4-flash",
    criteria: [],
    fraudSignals: [],
    recommendation: "pay",
    confidence: 0.95,
    summary: "",
    evidenceOk: true,
    contentSha256: null,
    latencyMs: 10,
    costUsd: 0.0003,
    x402PaymentTx: null,
  };

  it("pays a clean, high-confidence LLM brief on an autopilot campaign", () => {
    expect(
      gateFromBrief(clean, { autonomy: "autopilot", autopilotThreshold: 0.85 }, "pending").pay,
    ).toBe(true);
  });

  it("holds when a high-severity fraud signal is present, regardless of confidence", () => {
    const flagged: DecisionBrief = {
      ...clean,
      confidence: 0.99,
      fraudSignals: [{ signal: "recycled evidence", severity: "high", reason: "seen before" }],
    };
    expect(
      gateFromBrief(flagged, { autonomy: "autopilot", autopilotThreshold: 0.85 }, "pending").pay,
    ).toBe(false);
  });

  it("ignores low/med fraud signals for the pay decision", () => {
    const minor: DecisionBrief = {
      ...clean,
      fraudSignals: [{ signal: "short note", severity: "med", reason: "brief" }],
    };
    expect(
      gateFromBrief(minor, { autonomy: "autopilot", autopilotThreshold: 0.85 }, "pending").pay,
    ).toBe(true);
  });
});

describe("casOutcome — the concurrency transition model", () => {
  it("transitions only from the exact expected state", () => {
    expect(casOutcome("pending", "pending", "settling")).toEqual({
      changed: true,
      status: "settling",
    });
  });
  it("refuses when another runner already moved it", () => {
    expect(casOutcome("settling", "pending", "settling")).toEqual({
      changed: false,
      status: "settling",
    });
    expect(casOutcome("paid", "pending", "settling")).toEqual({
      changed: false,
      status: "paid",
    });
  });
});

describe("lockOutcome — the sweep singleton (idempotency) model", () => {
  it("acquires when there is no holder", () => {
    expect(lockOutcome(null, 100, 55)).toEqual({ acquired: true, expiresAt: 155 });
  });
  it("steals an expired lock", () => {
    expect(lockOutcome(90, 100, 55)).toEqual({ acquired: true, expiresAt: 155 });
  });
  it("acquires at the exact expiry boundary (<=)", () => {
    expect(lockOutcome(100, 100, 55)).toEqual({ acquired: true, expiresAt: 155 });
  });
  it("refuses while a live holder still owns it", () => {
    expect(lockOutcome(200, 100, 55)).toEqual({ acquired: false, expiresAt: 200 });
  });
});

describe("mainnet safety gate — chainId 2345 requires DEPUTY_AUTOPILOT_MAINNET", () => {
  const clean: DecisionBrief = {
    engine: "llm",
    model: "deepseek/deepseek-v4-flash",
    criteria: [],
    fraudSignals: [],
    recommendation: "pay",
    confidence: 0.95,
    summary: "",
    evidenceOk: true,
    contentSha256: null,
    latencyMs: 10,
    costUsd: 0.0003,
    x402PaymentTx: null,
  };

  it("holds a GOAT mainnet (2345) campaign when the flag is off", () => {
    const r = autopilotGate({ ...base, chainId: 2345, mainnetAutopilotEnabled: false });
    expect(r.pay).toBe(false);
    expect(r.reason).toMatch(/mainnet autopilot is off/i);
  });

  it("pays a mainnet campaign only once the flag is armed", () => {
    expect(
      autopilotGate({ ...base, chainId: 2345, mainnetAutopilotEnabled: true }).pay,
    ).toBe(true);
  });

  it("leaves testnet (59902 / undefined) unaffected by the flag", () => {
    expect(
      autopilotGate({ ...base, chainId: 59902, mainnetAutopilotEnabled: false }).pay,
    ).toBe(true);
    expect(autopilotGate({ ...base, mainnetAutopilotEnabled: false }).pay).toBe(true);
  });

  it("gateFromBrief threads the campaign chainId + the flag", () => {
    const mainnet = { autonomy: "autopilot", autopilotThreshold: 0.85, chainId: 2345 };
    expect(gateFromBrief(clean, mainnet, "pending", false).pay).toBe(false);
    expect(gateFromBrief(clean, mainnet, "pending", true).pay).toBe(true);
    // a testnet campaign (no chainId) pays regardless of the mainnet flag
    expect(
      gateFromBrief(clean, { autonomy: "autopilot", autopilotThreshold: 0.85 }, "pending", false).pay,
    ).toBe(true);
  });
});
