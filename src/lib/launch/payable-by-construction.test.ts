import { describe, expect, it } from "vitest";
import { composeDirectBody, composerFromDraft, type Draft } from "./composer";
import { compileDirectCampaign, directCampaignSchema } from "./direct-campaign";
import { cleanDraft, gigDraftSchema } from "./gig-draft";
import { proofFeasibility, repoIn } from "./proof-feasibility";

/**
 * PAYABLE BY CONSTRUCTION (6 Nov 2026). Sage Bench r9's payability audit (Opus reading 168 launched jobs as the
 * worker and as the check): only 24 were cleanly payable. These are the GENERAL rules that came out of it,
 * each true for any site and any kind of job, not a patch for one.
 */
const milestone = (evidence: Draft["milestones"][number]["evidence"], over: Partial<Draft["milestones"][number]> = {}): Draft["milestones"][number] => ({
  title: "Fix the retry bug",
  deliverable: "The retry fix is merged",
  instructions: "1. Fix the bug in github.com/harbor-hr/app.\n2. Open a pull request.",
  criteria: ["The retry backs off exponentially", "A test covers it", "The PR explains the change"],
  evidence,
  ...over,
});
const draft = (m: Draft["milestones"][number]): Draft => ({ kind: "gig", title: m.title, who: "anyone", slots: 1, milestones: [m] });
const launch = (d: Draft, words: string, amount = "50") => {
  const card = composerFromDraft(d, words);
  const body = composeDirectBody({ who: card.pay.who, slots: "1", tranches: card.tranches.map((t) => ({ ...t, amount: t.amount || amount })), splitTotal: "", currency: "USD", inviteOnly: false, why: "", title: card.title });
  return { card, body, parsed: directCampaignSchema.safeParse(body) };
};

describe("a merged pull request binds to the founder's repository", () => {
  it("in any repository proves nothing: the compiler refuses it and the card asks", () => {
    expect(proofFeasibility({ kind: "artifact_url", prMerged: true }, [])).toMatchObject({ ok: false, ask: "repo" });
    const { parsed } = launch(draft(milestone({ kind: "artifact_url", allowedHosts: ["github.com"], prMerged: true }, { instructions: "1. Fix it.\n2. Open a pull request." })), "fix the retry bug, $50");
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error?.issues)).toMatch(/proves nothing.*evidence\.repo/);
  });

  it("takes the repository the job itself names, so nobody has to type it", () => {
    const { card, parsed } = launch(draft(milestone({ kind: "artifact_url", allowedHosts: ["github.com"], prMerged: true })), "fix the retry bug, $50");
    expect(card.tranches[0]!.repo).toBe("harbor-hr/app");
    expect(parsed.success).toBe(true);
  });

  it("reads a repository's full name, and never guesses between two", () => {
    expect(repoIn("see https://github.com/vercel/next.js/issues/48748")).toBe("vercel/next.js");
    expect(repoIn("clone github.com/acme/api.git, then")).toBe("acme/api");
    expect(repoIn("github.com/acme/api and github.com/acme/web")).toBeNull();
  });
});

describe("the wallet goes where the check looks", () => {
  it("a pull request's criterion and steps name its description", () => {
    const { body } = launch(draft(milestone({ kind: "artifact_url", allowedHosts: ["github.com"], prMerged: true, repo: "harbor-hr/app" })), "fix the retry bug, $50");
    const m = (body as { milestones: { criteria: string[]; instructions: string }[] }).milestones[0]!;
    expect(m.criteria).toContain("The pull request description carries the submitting wallet address");
    expect(m.instructions).toMatch(/Put your full wallet address in the pull request description/);
  });

  it("steps that already say where the wallet goes are left alone", () => {
    const { body } = launch(draft(milestone({ kind: "artifact_url", allowedHosts: ["docs.google.com"], minRows: 20 }, { instructions: "1. Fill the sheet.\n2. Type your wallet address in cell A1." })), "a sheet of 20 stores, $40");
    const m = (body as { milestones: { instructions: string }[] }).milestones[0]!;
    expect(m.instructions.match(/wallet/gi)?.length).toBe(1);
  });
});

describe("work kept where Sage can't read it", () => {
  it("a folder or an app's view becomes a Google Doc or Sheet listing it", () => {
    const raw = gigDraftSchema.parse(draft(milestone({ kind: "artifact_url", allowedHosts: ["drive.google.com", "dropbox.com"] }, { title: "Photograph 40 products" })));
    const { draft: cleaned, notes } = cleanDraft(raw);
    expect(cleaned.milestones[0]!.evidence).toMatchObject({ kind: "artifact_url", allowedHosts: ["docs.google.com"] });
    expect(notes.join(" ")).toMatch(/can't open drive\.google\.com, dropbox\.com/);
    expect(proofFeasibility({ kind: "artifact_url", allowedHosts: ["airtable.com"] }, []).ok).toBe(false);
  });
});

describe("links listed in the work", () => {
  it("survive the drafter, the card, the body and the compiler", () => {
    const raw = gigDraftSchema.parse(draft(milestone({ kind: "artifact_url", allowedHosts: ["docs.google.com"], linkProof: { minLinks: 5, hosts: ["https://x.com/", "bsky.app"] } } as never, { title: "Post about our launch five times", instructions: "1. Post five times.\n2. List the links in a Google Doc." })));
    expect((raw.milestones[0]!.evidence as { linkProof?: unknown }).linkProof).toEqual({ minLinks: 5, hosts: ["x.com", "bsky.app"] });
    const { card, parsed } = launch(raw as Draft, "pay people to post about our launch five times, $10 each");
    expect(card.tranches[0]!.linkProof).toEqual({ minLinks: 5, hosts: ["x.com", "bsky.app"] });
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    const compiled = parsed.success ? compileDirectCampaign(parsed.data, "gig-links", null) : null;
    expect(compiled?.ok).toBe(true);
    expect(compiled && compiled.ok ? (compiled.plan.missions[0] as unknown as { verificationContract: { linkProof?: unknown } }).verificationContract.linkProof : null).toEqual({ minLinks: 5, hosts: ["x.com", "bsky.app"] });
  });
});

describe("a third party's decision is judged on what pays, not on the steps' history", () => {
  it("background in the steps no longer refuses a grant; a decision in the criteria still does", () => {
    const base = milestone({ kind: "artifact_url", allowedHosts: ["github.com"] }, {
      title: "M1: Testnet subgraph",
      instructions: "1. Add a FeeTier entity (requested by the committee and accepted in the proposal thread).\n2. Put your wallet in the README.",
      criteria: ["The repository defines the FeeTier entity", "The README names the query endpoint", "The schema is documented"],
    });
    expect(launch(draft(base), "grant the subgraph work, $3000").parsed.success).toBe(true);
    const c = launch(draft({ ...base, criteria: ["The bank has approved her loan", "The README names the query endpoint"] }), "x, $3000");
    const compiled = c.parsed.success ? compileDirectCampaign(c.parsed.data, "gig-x", null) : null;
    expect(compiled && !compiled.ok ? compiled.error : "").toMatch(/third party's private decision/);
  });
});

describe("the repository comes from what the founder handed over", () => {
  it("a pasted GitHub issue names it, so the card never has to ask", async () => {
    const { draftDirectCampaign } = await import("./gig-draft");
    const drafted = draft(milestone({ kind: "artifact_url", allowedHosts: ["github.com"], prMerged: true }, { instructions: "1. Fix the bug described in the issue.\n2. Open a pull request.\n3. Put your wallet in its description." }));
    const r = await draftDirectCampaign(
      { intent: "Fix this, $80: https://github.com/Acme/web/issues/12", source: { url: "https://github.com/Acme/web/issues/12", text: "Retry storms on 503s" } },
      { complete: async () => ({ json: drafted, model: "m" }) },
    );
    expect(r.ok && r.draft.milestones[0]!.evidence).toMatchObject({ prMerged: true, repo: "acme/web" });
  });
});

describe("the founder's answer to 'which repository' binds the merged PR", () => {
  it("typed once, as a link or as owner/name", async () => {
    const { withRepoFromNeeds } = await import("./composer");
    const t = { amount: "50", deliverable: "The fix is merged", verify: "link", expectedText: "", toAddr: "", prMerged: true, allowedHosts: ["github.com"] };
    const ask = (value: string) => [{ label: "The GitHub repository (owner/name) the pull request goes into", value }];
    expect(withRepoFromNeeds([t], ask("https://github.com/Acme/Web"))[0]!.repo).toBe("acme/web");
    expect(withRepoFromNeeds([t], ask("acme/api"))[0]!.repo).toBe("acme/api");
    expect(withRepoFromNeeds([t], ask(""))[0]!.repo).toBeUndefined();
    expect(withRepoFromNeeds([t], [{ label: "The Discord invite", value: "acme/web" }])[0]!.repo).toBeUndefined();
    const body = composeDirectBody({ who: "anyone", slots: "1", tranches: [{ ...t, criteria: ["The fix backs off exponentially", "A test covers it"] }], splitTotal: "", currency: "USD", inviteOnly: false, why: "", title: "Fix the reconnect loop", needs: ask("acme/web") });
    expect(directCampaignSchema.safeParse(body).success).toBe(true);
  });
});
