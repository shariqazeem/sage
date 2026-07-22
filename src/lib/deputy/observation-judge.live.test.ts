import { describe, expect, it } from "vitest";
import { distillPrivateKey } from "./observation-verify";
import { judgeObservationAccount } from "./observation-judge";
import {
  observationCases,
  yaraFieldTest,
  yaraPublicStrings,
  excalidrawFieldTest,
  excalidrawPublicStrings,
} from "./observation-fixtures";

/**
 * The LIVE ledger for the observation LLM judge — runs the fixture accounts through the REAL model, the
 * same prompt + hardening as production. It is GATED: it only runs with `OBS_LIVE_EVAL=1` and an LLM key
 * (a few pennies, non-deterministic), so the default suite stays hermetic. This is the "live ledger
 * green" gate the go-package requires BEFORE deploy — the judge's half of the fixtures-as-spec contract.
 *
 *   OBS_LIVE_EVAL=1 npx vitest run src/lib/deputy/observation-judge.live.test.ts
 */

const keys = {
  yara: distillPrivateKey(yaraFieldTest, yaraPublicStrings),
  excalidraw: distillPrivateKey(excalidrawFieldTest, excalidrawPublicStrings),
};

const judge = (product: "yara" | "excalidraw", account: string) =>
  judgeObservationAccount({
    account,
    missionObjective: product === "yara" ? "Validate the first-session feel" : "Validate the first drawing",
    criteria: ["The tester describes what they actually experienced"],
    privateObservations: keys[product].observations.map((o) => o.text),
  });

describe.runIf(process.env.OBS_LIVE_EVAL === "1")("observation judge — LIVE ledger", () => {
  it("a GENUINE yara account → high confidence, zero contradictions", async () => {
    const c = observationCases.find((x) => x.label === "genuine-yara")!;
    const r = await judge("yara", c.account);
    expect(r.obsConfidence).toBeGreaterThanOrEqual(0.7);
    expect(r.contradictions).toHaveLength(0);
  }, 30_000);

  it("a GENUINE excalidraw account → high confidence, zero contradictions", async () => {
    const c = observationCases.find((x) => x.label === "genuine-excalidraw")!;
    const r = await judge("excalidraw", c.account);
    expect(r.obsConfidence).toBeGreaterThanOrEqual(0.7);
    expect(r.contradictions).toHaveLength(0);
  }, 30_000);

  it("an INJECTION-in-a-plausible-account → confidence 0, injection contradiction", async () => {
    const c = observationCases.find((x) => x.label === "injection-in-plausible-yara")!;
    const r = await judge("yara", c.account);
    expect(r.obsConfidence).toBe(0);
    expect(r.contradictions.join(" ").toLowerCase()).toContain("injection");
  }, 30_000);

  it("a fluent-GENERIC account → low confidence (no specific first-hand detail)", async () => {
    const c = observationCases.find((x) => x.label === "fluent-generic-yara")!;
    const r = await judge("yara", c.account);
    expect(r.obsConfidence).toBeLessThan(0.7);
  }, 30_000);

  it("a genuine account that CONTRADICTS the corpus → a contradiction is flagged", async () => {
    const contradicting =
      "I saw make a wish and a koi pond ripples in moonlight, then the cherry blossoms fall. There was also a bright red Buy Now checkout button and a shopping cart with three items.";
    const r = await judge("yara", contradicting);
    expect(r.contradictions.length).toBeGreaterThan(0);
  }, 30_000);
});
