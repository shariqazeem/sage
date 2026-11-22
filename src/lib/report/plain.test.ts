import { describe, expect, it } from "vitest";
import { REACHED_REPORT } from "@/lib/core-test/shape";
import { firstClause, firstSentence, OTHER_NOTES, type Finding, type PaidAnswer } from "./core";
import { coverPlainly, failureMode, hitBy, kindOfSentence, LIKED_TITLE, plainFindings, sentencesOf, signatureOf, stem, topicWords } from "./plain";
import { ANSWER_SETS, DROPS, LOOKALIKES, RUNGS, SHOP, type AnswerSet } from "./plain.fixtures";
import { fixFirst, rankFindings } from "./product";

/**
 * THE PLAIN REPORT, measured. Most reports are built with no model, so these hold the grouping to
 * what a careful person would do by hand on realistic answers: the same problem from several people
 * is one finding, two different problems never are, and every word shown is somebody's own.
 */

/** the report before 22 Nov 2026: every paid answer its own finding */
const oneByOne = (answers: readonly PaidAnswer[]): Finding[] =>
  answers.map((a) => ({ title: firstClause(a.text) || "Answered without a note", kind: "other" as const, submissionIds: [a.id], quotes: firstSentence(a.text) ? [{ submissionId: a.id, text: firstSentence(a.text)! }] : [] }));

const build = (set: AnswerSet) => plainFindings(set.answers, { rungs: set.rungs });
const groupOf = (findings: readonly Finding[], id: string) => findings.filter((f) => f.submissionIds.includes(id) && f.submissionIds.length > 1 && f.kind !== "liked" && f.kind !== "other" && !f.rung);
const together = (findings: readonly Finding[], a: string, b: string) => groupOf(findings, a).some((f) => f.submissionIds.includes(b));

/** how a report scores against the hand-made groups */
function measure(set: AnswerSet, findings: readonly Finding[]) {
  const found = set.expect.filter((g) => findings.some((f) => f.submissionIds.length === g.length && g.every((id) => f.submissionIds.includes(id)))).length;
  const merged = set.apart.filter(([a, b]) => together(findings, a, b)).length;
  const ranked = rankFindings(findings, []);
  const fixes = fixFirst({ ranked, core: null, sage: [] }).filter((f) => f.from === "people").length;
  return { findings: findings.length, groupsFound: found, groupsExpected: set.expect.length, wronglyMerged: merged, biggest: Math.max(0, ...findings.filter((f) => f.kind === "stuck" || f.kind === "bug").map((f) => f.submissionIds.length)), fixesFromPeople: fixes };
}

describe("reading a sentence", () => {
  it("splits an answer into exact substrings", () => {
    const text = "  The page went blank.\nThen I reloaded! Is v2.0 out? yes";
    const s = sentencesOf(text);
    expect(s).toEqual(["The page went blank.", "Then I reloaded!", "Is v2.0 out?", "yes"]);
    for (const x of s) expect(text).toContain(x);
  });

  it("meets the same thing in its different forms", () => {
    expect(stem("wallets")).toBe(stem("wallet"));
    expect(stem("connecting")).toBe(stem("connected"));
    expect(stem("connection")).toBe(stem("connect"));
    expect([...topicWords("I couldn't find the Sign-Up button on mobile")]).toEqual(["signup"]);
    expect([...topicWords("signing up was hard")]).toEqual(["signup"]);
    // logging in is not signing up
    expect(topicWords("I could not log in").has("signup")).toBe(false);
  });

  it.each([
    ["The Continue button did nothing.", "stuck"],
    ["The page crashed after I uploaded a photo.", "bug"],
    ["No issues at all, it worked great.", "liked"],
    ["There was no error message, nothing happened.", "stuck"],
    ["I couldn't be happier with it.", "liked"],
    ["Would be nice to have a dark mode.", "idea"],
    ["I opened the page and read it.", "other"],
    ["No pude conectar mi billetera.", "stuck"],
  ])("%s is %s", (sentence, kind) => {
    expect(kindOfSentence(sentence)).toBe(kind);
  });

  it.each([
    ["I couldn't find where to sign up", "not-found"],
    ["I found the button but nothing happened", "no-response"],
    ["It asked me to connect a wallet before showing anything", "blocked"],
    ["I didn't understand what the second step was for", "confusing"],
    ["The dashboard took too long", "slow"],
    ["The total was wrong", "wrong"],
    ["The upload crashed", "failed"],
  ])("%s fails as %s", (sentence, mode) => {
    expect(failureMode(sentence)).toBe(mode);
  });
});

describe("plain grouping on realistic answers", () => {
  it.each(ANSWER_SETS.map((s) => [s.name, s] as const))("%s: finds the hand-made groups and merges nothing it should not", (_name, set) => {
    const findings = build(set);
    for (const g of set.expect) {
      const f = findings.find((x) => g.every((id) => x.submissionIds.includes(id)) && x.submissionIds.length > 1);
      expect(f, `expected one finding for ${g.join(", ")}`).toBeTruthy();
      expect([...f!.submissionIds].sort(), `the finding for ${g.join(", ")} holds only them`).toEqual([...g].sort());
    }
    for (const [a, b] of set.apart) expect(together(findings, a, b), `${a} and ${b} are different problems`).toBe(false);
    // every paid answer is in the report, and every quote is that person's exact words
    const byId = new Map(set.answers.map((a) => [a.id, a.text]));
    for (const a of set.answers) expect(findings.some((f) => f.submissionIds.includes(a.id)), `${a.id} is in a finding`).toBe(true);
    for (const f of findings) {
      expect(f.quotes.length).toBeLessThanOrEqual(3);
      for (const q of f.quotes) {
        expect(f.submissionIds).toContain(q.submissionId);
        expect(byId.get(q.submissionId)).toContain(q.text);
      }
    }
  });

  it("titles a group in a member's own words", () => {
    const findings = build(DROPS);
    const cont = findings.find((f) => f.submissionIds.includes("d1"))!;
    expect(cont.title).toBe("I reached the form and the Continue button did nothing");
    expect(findings.find((f) => f.submissionIds.includes("d6"))!.title).toBe("It wants a wallet connection before showing anything");
    expect(cont.kind).toBe("stuck");
    // the people whose words are not already the title are read first
    expect(cont.quotes[0]!.submissionId).not.toBe("d3");
    for (const f of findings.filter((x) => x.submissionIds.length > 1 && !x.rung && x.kind !== "liked" && x.title !== OTHER_NOTES)) {
      const words = f.submissionIds.map((id) => DROPS.answers.find((a) => a.id === id)!.text.toLowerCase().replace(/[’']/g, "'"));
      expect(words.some((w) => w.includes(f.title.toLowerCase().replace(/[’']/g, "'").slice(0, 24))), `"${f.title}" is from an answer`).toBe(true);
    }
  });

  it("keeps a problem only one person hit as its own finding, and praise as one", () => {
    const findings = build(DROPS);
    const blank = findings.find((f) => f.submissionIds.includes("d10"))!;
    expect(blank).toMatchObject({ kind: "bug", submissionIds: ["d10"] });
    // the clause that says what broke, not the one that says how they got there
    expect(blank.title).toBe("The page went blank after I uploaded a photo");
    const liked = findings.find((f) => f.title === LIKED_TITLE)!;
    expect(liked.submissionIds.sort()).toEqual(["d8", "d9"]);
    expect(liked.kind).toBe("liked");
  });

  it("vague and off-topic answers are never called a problem", () => {
    const findings = build(SHOP);
    expect(findings.find((f) => f.title === LIKED_TITLE)!.submissionIds.sort()).toEqual(["s3", "s4"]);
    expect(findings.find((f) => f.submissionIds.includes("s9"))).toMatchObject({ title: OTHER_NOTES, kind: "other" });
    expect(findings.find((f) => f.submissionIds.includes("s10"))).toMatchObject({ kind: "idea" });
  });

  it("people who stopped on a rung and named no problem are that rung's finding", () => {
    const findings = build(RUNGS);
    const rung = findings.find((f) => f.rung === "first-screen")!;
    expect(rung).toMatchObject({ title: REACHED_REPORT["first-screen"], kind: "stuck", submissionIds: ["r4", "r5"] });
    // and it is never offered as a fix of its own: the main action's count already says it
    const ranked = rankFindings(findings, []);
    expect(ranked.find((f) => f.rung)!.suggestedFix).toBeNull();
  });

  it("praise that names the same things is not the problem", () => {
    const findings = build(LOOKALIKES);
    // a clause that names nothing is never a title
    expect(findings.find((f) => f.submissionIds.includes("l8"))!.title).toBe("The search returned nothing for my query, which is wrong");
    for (const f of findings.filter((x) => x.kind === "stuck" || x.kind === "bug")) expect(f.submissionIds).toHaveLength(1);
    expect(findings.find((f) => f.submissionIds.includes("l11"))!.kind).toBe("liked");
  });

  it("matches two people to the same problem Sage recorded itself", () => {
    const sageProblems = [{ id: "P1", text: "The checkout logs an error in the browser TypeError: Cannot read properties of undefined (reading 'shippingAddress')" }];
    const answers: PaidAnswer[] = [
      { id: "a", text: "Checkout died when it tried to read my shipping address, some TypeError about shippingAddress undefined." },
      { id: "b", text: "Got a TypeError on the pay step, it said undefined properties." },
      { id: "c", text: "The colours are hard to read." },
    ];
    const findings = plainFindings(answers, { sageProblems });
    const f = findings.find((x) => x.sageSaw === "P1")!;
    expect(f.submissionIds).toEqual(["a", "b"]);
    expect(rankFindings(findings, [{ id: "P1", title: "Checkout logs an error", fix: "Fix the script.", text: sageProblems[0]!.text }])[0]).toMatchObject({ count: 2, suggestedFix: "Fix the script." });
  });

  it("quotes what happened, not the first impression, for a core answer it cannot sort", () => {
    const findings = build(DROPS);
    // nobody in this set is left unsorted, so add one who finished and said nothing either way
    const extra: PaidAnswer = { id: "dx", text: "Gift links.\n\nThe one button.\n\nSent one to my sister on the second try.\n\nPerhaps." };
    const withExtra = plainFindings([...DROPS.answers, extra], { rungs: new Map([...DROPS.rungs, ["dx", "finished"]]) });
    expect(withExtra.find((f) => f.title === OTHER_NOTES)).toMatchObject({ submissionIds: ["dx"], quotes: [{ submissionId: "dx", text: "Sent one to my sister on the second try." }] });
    expect(findings.some((f) => f.title === OTHER_NOTES)).toBe(false);
  });

  it("is the same report whatever order the answers arrive in", () => {
    const shape = (fs: Finding[]) => fs.map((f) => [...f.submissionIds].sort().join(",")).sort();
    const forward = shape(build(SHOP));
    const backward = shape(plainFindings([...SHOP.answers].reverse(), { rungs: SHOP.rungs }));
    expect(backward).toEqual(forward);
  });

  it("handles a long test quickly, and empty answers without a word", () => {
    const many: PaidAnswer[] = Array.from({ length: 60 }, (_, i) => ({ id: `m${i}`, text: i % 3 === 0 ? "The connect wallet button did nothing when I pressed it." : i % 3 === 1 ? `Step ${i} of the tour was confusing, I didn't know what token ${i} meant.` : "" }));
    const t0 = Date.now();
    const findings = plainFindings(many);
    expect(Date.now() - t0).toBeLessThan(2500);
    expect(findings[0]!.submissionIds).toHaveLength(20);
    expect(findings.length).toBeLessThanOrEqual(25);
    for (const a of many) expect(findings.some((f) => f.submissionIds.includes(a.id))).toBe(true);
  });

  it("stays quick on a large test where everyone names different things", () => {
    const things = ["wallet", "checkout", "invoice", "profile", "avatar", "calendar", "export", "import", "search", "filter", "coupon", "address", "password", "report", "chart", "table"];
    const fails = ["did nothing", "was confusing", "crashed", "could not be found", "took too long", "showed the wrong value"];
    const many: PaidAnswer[] = Array.from({ length: 150 }, (_, i) => ({
      id: `v${i}`,
      text: `The ${things[i % 16]} ${things[(i * 7 + 3) % 16]} ${fails[i % 6]}. Then the ${things[(i * 5 + 1) % 16]} ${fails[(i + 2) % 6]} on the ${things[(i * 3 + 2) % 16]} step. I liked the ${things[(i + 9) % 16]}.`,
    }));
    const t0 = Date.now();
    const findings = plainFindings(many);
    const took = Date.now() - t0;
    if (process.env.FINDINGS_TABLE) console.log(`150 answers grouped in ${took} ms into ${findings.length} findings`);
    expect(took).toBeLessThan(4000);
    for (const a of many) expect(findings.some((f) => f.submissionIds.includes(a.id))).toBe(true);
  });

  it("covers answers a model's groups left out by grouping them in code, never by widening a group", () => {
    const model: Finding[] = [{ title: "Continue is dead", kind: "stuck", submissionIds: ["d1", "d2"], quotes: [{ submissionId: "d1", text: "the Continue button did nothing" }] }];
    const out = coverPlainly(model, DROPS.answers, { rungs: DROPS.rungs });
    expect(out[0]).toEqual(model[0]);
    expect(out.find((f) => f.submissionIds.includes("d4"))!.submissionIds.sort()).toEqual(["d4", "d5"]);
    for (const a of DROPS.answers) expect(out.some((f) => f.submissionIds.includes(a.id))).toBe(true);
  });
});

describe("before and after", () => {
  it("a plain report now finds the groups a builder can act on", () => {
    const table = ANSWER_SETS.map((set) => ({ set: set.name, before: measure(set, oneByOne(set.answers)), after: measure(set, build(set)) }));
    if (process.env.FINDINGS_TABLE) {
      for (const r of table) {
        console.log(`\n${r.set}`);
        console.table({ before: r.before, after: r.after });
        for (const f of rankFindings(build(ANSWER_SETS.find((s) => s.name === r.set)!), [])) console.log(`  ${f.count} · [${f.kind}${f.rung ? ` · ${f.rung}` : ""}] ${f.title}${f.suggestedFix ? `\n      fix: ${f.suggestedFix}` : ""}`);
      }
    }
    for (const r of table) {
      expect(r.before.groupsFound).toBe(0);
      expect(r.after.groupsFound).toBe(r.after.groupsExpected);
      expect(r.after.wronglyMerged).toBe(0);
      expect(r.after.findings).toBeLessThanOrEqual(r.before.findings);
    }
    // ten people on the first-try mission: three problems with people behind them, each with a fix
    const drops = table[0]!;
    expect(drops.before).toMatchObject({ biggest: 0, fixesFromPeople: 0 });
    expect(drops.after).toMatchObject({ biggest: 3, fixesFromPeople: 3 });
  });
});

describe("the same problem in another set of answers", () => {
  it("counts who ran into a finding's problem, and not who praised the same thing", () => {
    const then = build(DROPS).find((f) => f.submissionIds.includes("d1"))!;
    const sig = signatureOf(then);
    expect([...sig.words].sort()).toEqual(["continu"]);
    const later: PaidAnswer[] = [
      { id: "n1", text: "The Continue button still does not respond." },
      { id: "n2", text: "Continue worked first time, lovely." },
      { id: "n3", text: "The share link was broken." },
    ];
    expect(hitBy(sig, later)).toEqual(["n1"]);
    const wallet = signatureOf(build(DROPS).find((f) => f.submissionIds.includes("d6"))!);
    expect(hitBy(wallet, [{ id: "w", text: "It asked me to connect a wallet first and I don't have one." }, { id: "x", text: "Connecting my wallet was painless." }])).toEqual(["w"]);
  });
});
