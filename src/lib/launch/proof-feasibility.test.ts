import { describe, expect, it } from "vitest";
import { linkLivesOnSage, proofFeasibility, sageActionIn } from "./proof-feasibility";

/**
 * A PROOF THAT CAN NEVER PASS IS NEVER LAUNCHED (5 Nov 2026). The founder's own test: "whoever launches a job
 * on sagepays.xyz, pay them 0.5 usdc each". Sage wrote a card asking for a link that carries the worker's
 * wallet, the link being a Sage job page, which never shows who posted it, and still offered Launch.
 */
const THE_CARD = {
  title: "Launch a job on Sage",
  deliverable: "A live job is posted on sagepays.xyz",
  criteria: [
    "The submitted link opens a live job page on sagepays.xyz",
    "The job has a clear title and describes a concrete deliverable that someone could prove they finished",
    "The job is a genuine request for work, not empty or placeholder text",
    "The job includes at least one milestone with its own acceptance criteria",
  ],
};
const texts = (c: { title: string; deliverable: string; criteria: string[] }) => [c.title, c.deliverable, ...c.criteria];

describe("a link on Sage's own pages", () => {
  it("is caught on the founder's exact card, with the proof that works", () => {
    const f = proofFeasibility({ kind: "artifact_url", allowedHosts: [] }, texts(THE_CARD));
    expect(f.ok).toBe(false);
    expect(f.ok ? null : f.fix).toEqual({ action: "launched_job" });
    expect(f.ok ? "" : f.reason).toMatch(/never shows who made it/);
  });

  it("is caught by its host alone", () => {
    expect(linkLivesOnSage(["sagepays.xyz"], [])).toBe(true);
    expect(linkLivesOnSage(["www.sagepays.xyz"], [])).toBe(true);
    expect(linkLivesOnSage([], ["Submit your receipt link, sagepays.xyz/proof/0x…"])).toBe(true);
  });

  it("never catches work that only talks about Sage", () => {
    const blog = ["Write a review of Sage", "A public blog post reviews sagepays.xyz", "The post names sagepays.xyz and links to it", "It explains how payouts are verified"];
    expect(proofFeasibility({ kind: "artifact_url", allowedHosts: [] }, blog).ok).toBe(true);
    expect(proofFeasibility({ kind: "artifact_url", allowedHosts: ["dev.to"] }, ["A dev.to article about building on Sage"]).ok).toBe(true);
    // the other proofs are not link-with-marker proofs, so this rule never touches them
    expect(proofFeasibility({ kind: "public_url" }, texts(THE_CARD)).ok).toBe(true);
    expect(proofFeasibility({ kind: "sage_record" }, texts(THE_CARD)).ok).toBe(true);
  });

  it("names no fix when the job doesn't say what was done on Sage", () => {
    const f = proofFeasibility({ kind: "artifact_url", allowedHosts: ["sagepays.xyz"] }, ["Share your Sage page", "Your page on sagepays.xyz is public"]);
    expect(f.ok).toBe(false);
    expect(f.ok ? "x" : f.fix).toBeNull();
  });
});

describe("what was done on Sage", () => {
  it("reads launching before being paid", () => {
    expect(sageActionIn("whoever launches a job on sagepays.xyz")).toBe("launched_job");
    expect(sageActionIn("post a bounty on Sage and fund it")).toBe("launched_job");
    expect(sageActionIn("complete any job on Sage and get paid")).toBe("was_paid");
    expect(sageActionIn("share your Sage payout receipt")).toBe("was_paid");
    expect(sageActionIn("write about your weekend")).toBeNull();
  });
});
