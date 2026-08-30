import { describe, expect, it } from "vitest";
import { surfaceCriteria } from "./decisions";
import type { VerificationContract } from "@/lib/verify/contract";

const artifact = (hosts: string[]): VerificationContract => ({
  kind: "artifact_url",
  allowedHosts: hosts,
  markerKind: "wallet",
});
const SURFACE = "https://sagepays.xyz/c/gig-CNTNilT30v";
const line = (c: VerificationContract | null) => surfaceCriteria(SURFACE, c).join(" ");

/**
 * This decides what the payout judge is TOLD. A contradictory brief held a gig that had passed
 * every deterministic check, so these are money assertions, not copy assertions.
 */
describe("surfaceCriteria", () => {
  it("keeps the surface as a hard criterion for a non-artifact mission", () => {
    // Product testing is performed ON the surface — unchanged behaviour.
    expect(surfaceCriteria(SURFACE, null)).toEqual([`Target surface: ${SURFACE}`]);
    expect(line({ kind: "observation" } as VerificationContract)).toBe(`Target surface: ${SURFACE}`);
  });

  it("tells the judge a publish-anywhere artifact is NOT bound to the surface", () => {
    // The live hold: empty allowedHosts means the verifier skips the host check entirely.
    const out = line(artifact([]));
    expect(out).toMatch(/ANY public host/);
    expect(out).toMatch(/NOT a criterion/);
    expect(out).not.toMatch(/^Target surface:/);
  });

  it("states the real host requirement when hosts ARE named", () => {
    const out = line(artifact(["github.com", "notion.so"]));
    expect(out).toContain("github.com or notion.so");
    expect(out).not.toMatch(/ANY public host/);
  });

  it("still gives the judge the surface as context, never silently dropped", () => {
    for (const c of [artifact([]), artifact(["github.com"])]) expect(line(c)).toContain(SURFACE);
  });

  it("emits nothing when there is no surface", () => {
    for (const v of [null, undefined, "", "   "]) {
      expect(surfaceCriteria(v, artifact([]))).toEqual([]);
      expect(surfaceCriteria(v, null)).toEqual([]);
    }
  });
});
