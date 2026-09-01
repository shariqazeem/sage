import { beforeEach, describe, expect, it } from "vitest";
import { POST } from "./route";
import { buildAttestation, signAttestation } from "@/lib/campaigns/attestation";
import type { CreditSignals } from "@/lib/campaigns/credit";
import type { WalletRecord } from "@/lib/campaigns/record";

/** A real key for the ISSUER role in tests — the well-known anvil #0 key, never real money. */
const TEST_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

const record = {
  wallet: "0x00000000000000000000000000000000000000fe",
  totalUsd: 6,
  completions: 4,
  distinctCampaigns: 2,
  lastAt: 1_756_000_000,
  entries: [{ txHash: "0xaaa1" }, { txHash: "0xaaa2" }],
} as unknown as WalletRecord;

const signals = {
  completions: 4, distinctPayers: 2, distinctCampaigns: 2, monthsActive: 2,
  verificationPassRate: 0.8, tenureDays: 40,
} as unknown as CreditSignals;

const call = (attestation: unknown) =>
  POST(new Request("http://t/api/attest/verify", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ attestation }),
  }));

const issue = async (floor?: number, over: Record<string, unknown> = {}) => {
  const unsigned = buildAttestation(record, signals, { earnedAtLeastUsd: floor, now: Math.floor(Date.now() / 1000) });
  const signed = await signAttestation(unsigned);
  return { ...signed, ...over };
};

beforeEach(() => {
  process.env.GOAT_AGENT_PRIVATE_KEY = TEST_KEY;
});

describe("attestation verify — the lender's check", () => {
  it("a genuine attestation verifies, and the issuer is published for off-platform checks", async () => {
    const res = await call(await issue(5));
    const j = (await res.json()) as { valid: boolean; expectedIssuer: string; claims: { earnedAtLeastUsd?: number } };
    expect(j.valid).toBe(true);
    expect(j.expectedIssuer).toMatch(/^0x/);
    expect(j.claims.earnedAtLeastUsd).toBe(5);
  });

  it("a TAMPERED floor fails — the signature covers every claim", async () => {
    const a = await issue(5);
    a.claims = { ...a.claims, earnedAtLeastUsd: 500 };
    const j = (await (await call(a)).json()) as { valid: boolean; reason: string };
    expect(j.valid).toBe(false);
    expect(j.reason).toMatch(/signature/i);
  });

  it("an attestation from a DIFFERENT issuer fails even when internally consistent", async () => {
    const a = await issue(5);
    process.env.GOAT_AGENT_PRIVATE_KEY =
      "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"; // anvil #1
    const j = (await (await call(a)).json()) as { valid: boolean; reason: string };
    expect(j.valid).toBe(false);
    expect(j.reason).toMatch(/different issuer/i);
  });

  it("an expired attestation fails in words", async () => {
    const unsigned = buildAttestation(record, signals, { earnedAtLeastUsd: 5, ttlSeconds: 1, now: 1_000 });
    const a = await signAttestation(unsigned);
    const j = (await (await call(a)).json()) as { valid: boolean; reason: string };
    expect(j.valid).toBe(false);
    expect(j.reason).toBe("expired");
  });

  it("a mangled paste gets a WHAT-is-wrong answer, not a 500", async () => {
    for (const bad of [null, {}, { schema: "something.else" }, { schema: "sage.earnings-attestation.v1" }]) {
      const res = await call(bad);
      expect(res.status).toBe(400);
    }
  });
});
