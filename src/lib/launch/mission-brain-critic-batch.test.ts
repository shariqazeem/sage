import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { batchForCritic, CRITIC_BATCH_CHARS, coerceMission } from "./mission-brain";

/**
 * app.uniswap.org, P-GEN 45 (2026-09-02): five candidates, ~4k chars each; the critic's prompt cut
 * the candidates JSON at 20k, the fifth mission arrived mid-criterion, and the critic rejected it as
 * "truncated" while its stored text was complete. With 6–10 missions per rich map that cut would land
 * on every rich plan's tail. The critic now reviews in batches that fit under the cap.
 */
const fat = (i: number) =>
  coerceMission(
    {
      missionKey: `mission-${i}`,
      title: `Mission ${i} with a long title that describes a real flow on the product`,
      objective: "Walk a first-time visitor through one observed flow and report the resulting state.".repeat(3),
      instructions: Array.from({ length: 8 }, (_, k) => `${k + 1}. Do step ${k + 1} on the observed surface and report exactly what the page shows afterwards, quoting the visible text.`).join("\n"),
      targetSurface: "https://example.com/flow",
      criteria: Array.from({ length: 6 }, (_, k) => `Criterion ${k + 1}: the tester reports the exact on-screen outcome of step ${k + 1}, quoting the visible label text verbatim.`),
      evidenceRequirements: Array.from({ length: 5 }, (_, k) => `Evidence ${k + 1}: the quoted text and the URL reached after step ${k + 1}.`),
      whyItMatters: "This flow is the product's core path and a first-time visitor who gets stuck here never sees the rest.".repeat(3),
      sources: ["https://example.com/flow"],
      anchors: ["visible label", "reached URL"],
      verificationMethod: "Sage re-opens the page and matches the quotes.",
    },
    i,
  )!;

describe("batchForCritic — every candidate reviewed whole, in order, exactly once", () => {
  it("splits ten rich candidates into batches under the cap and loses none", () => {
    const cands = Array.from({ length: 10 }, (_, i) => fat(i));
    const whole = JSON.stringify({ missions: cands }).length;
    expect(whole).toBeGreaterThan(CRITIC_BATCH_CHARS); // the shape that was being cut
    const batches = batchForCritic(cands);
    expect(batches.length).toBeGreaterThan(1);
    for (const b of batches) expect(JSON.stringify({ missions: b }).length).toBeLessThanOrEqual(CRITIC_BATCH_CHARS);
    expect(batches.flat().map((m) => m.missionKey)).toEqual(cands.map((m) => m.missionKey));
  });

  it("a small plan stays one batch; an over-wide single candidate gets a batch of its own", () => {
    expect(batchForCritic([fat(0), fat(1)]).length).toBe(1);
    const wide = { ...fat(0), instructions: "x".repeat(CRITIC_BATCH_CHARS + 10) };
    const batches = batchForCritic([fat(1), wide, fat(2)]);
    expect(batches.map((b) => b.length)).toEqual([1, 1, 1]);
    expect(batches[1][0].missionKey).toBe(wide.missionKey);
    expect(batchForCritic([])).toEqual([]);
  });

  it("a primary that times out twice hands the architect — and a timed-out review — to the secondary provider once", () => {
    const src = readFileSync(resolve(process.cwd(), "src/lib/launch/mission-brain.ts"), "utf8");
    // the ladder: second timeout → one fallback attempt → stop (never a third primary attempt)
    expect(src).toMatch(/if \(lastError === "provider_timeout" && \+\+timeouts >= 2\) \{\s*const fb = await architectOnFallback\(/);
    expect(src).toMatch(/useFallback: true \}\);\s*const arr = extractMissionArray/);
    // the critic: only a provider_timeout, only once, only when a fallback exists
    expect(src).toMatch(/if \(!useFallback && classifyBrainError\(e\) === "provider_timeout" && fallbackLlm\(\)\) return criticBatch\(candidates, mapJson, true\)/);
  });

  it("the batch cap stays under the prompt builder's own cut, so a batch is never truncated", () => {
    const src = readFileSync(resolve(process.cwd(), "src/lib/launch/mission-prompt.ts"), "utf8");
    const m = src.match(/candidatesJson\.slice\(0, ([\d_]+)\)/);
    expect(m).not.toBeNull();
    expect(CRITIC_BATCH_CHARS).toBeLessThan(Number(m![1].replace(/_/g, "")));
  });
});
