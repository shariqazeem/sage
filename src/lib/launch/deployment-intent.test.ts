import { describe, expect, it } from "vitest";
import { deploymentIntent, mapDirectCampaignArgs } from "@/lib/mcp/server";
import { directCampaignSchema } from "./direct-campaign";

/**
 * "$35 when they deploy the contract on-chain" — the milestone that could not be expressed.
 *
 * An onchain_tx contract must carry a shape constraint or it verifies any transaction the recipient
 * ever sent. Every other constraint names something that already exists, so a deployment had no
 * form at all, and one unexpressible milestone failed the whole grant (P-DIRECT,
 * pd-grant-mixed-evidence-kinds, all three runs). This holds both halves of the fix: the constraint
 * is honoured when the model states it, and recovered from the founder's own compiled words when it
 * does not — but never invented from words that say nothing about deploying.
 */
describe("deploymentIntent", () => {
  const ms = (over: Record<string, unknown> = {}) => ({
    title: "Deploy the contract",
    instructions: "Deploy the contract on GOAT and send us the transaction hash.",
    criteria: ["The contract is live on-chain"],
    ...over,
  });

  it("honours the model's own boolean", () => {
    expect(deploymentIntent(ms({ title: "Ship the thing", instructions: "x", criteria: [] }), { deploysContract: true }))
      .toEqual({ deploysContract: true });
  });

  it("honours it as the string a model writes when a schema says boolean", () => {
    expect(deploymentIntent({}, { deploysContract: "true" })).toEqual({ deploysContract: true });
  });

  it("recovers it from the milestone's own words when the model set nothing", () => {
    expect(deploymentIntent(ms(), {})).toEqual({ deploysContract: true });
  });

  it("reads the criteria too, not only the title", () => {
    const m = ms({ title: "Step one", instructions: "Do the work.", criteria: ["The contract is deployed on-chain"] });
    expect(deploymentIntent(m, {})).toEqual({ deploysContract: true });
  });

  it("adds NOTHING when the founder's words say nothing about deploying", () => {
    const m = ms({ title: "Send the payment", instructions: "Transfer 10 USDC to the treasury.", criteria: ["Paid"] });
    expect(deploymentIntent(m, {})).toEqual({});
  });

  it("does not touch a milestone that already stated a real constraint", () => {
    const m = ms(); // its words DO say deploy
    expect(deploymentIntent(m, { to: "0x1111111111111111111111111111111111111111" })).toEqual({});
    expect(deploymentIntent(m, { methodSelector: "0xa9059cbb" })).toEqual({});
    expect(deploymentIntent(m, { minValueWei: "1000" })).toEqual({});
  });
});

describe("the mixed-evidence grant compiles end to end", () => {
  it("one tranche on-chain (a deployment) and one a published page", () => {
    const mapped = mapDirectCampaignArgs({
      kind: "grant",
      title: "Developer grant, two steps",
      milestones: [
        {
          title: "Deploy the contract on-chain",
          instructions: "Deploy the contract and send the transaction hash.",
          criteria: ["The contract is deployed and the transaction succeeded"],
          // exactly what the model produced: a chain and nothing else
          evidence: { kind: "onchain_tx", chainId: 2345 },
          rewardUsd: 35,
          slots: 1,
        },
        {
          title: "Publish the docs page",
          instructions: "Publish a public docs page for the contract with your wallet address on it.",
          criteria: ["The page is live and public"],
          evidence: { kind: "artifact_url", allowedHosts: [] },
          rewardUsd: 25,
          slots: 1,
        },
      ],
    });
    const parsed = directCampaignSchema.safeParse(mapped);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const kinds = parsed.data.milestones.map((m) => m.evidence.kind);
    expect(kinds).toEqual(["onchain_tx", "artifact_url"]);
    const first = parsed.data.milestones[0].evidence;
    expect(first.kind === "onchain_tx" && first.deploysContract).toBe(true);
    expect(parsed.data.milestones.map((m) => m.rewardUsd)).toEqual([35, 25]);
  });
});
