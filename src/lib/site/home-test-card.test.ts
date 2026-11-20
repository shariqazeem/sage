import { describe, expect, it } from "vitest";
import { cardOfCampaign, cardOfInspection } from "./home-test-card";

const insp = (status: string, more: Partial<{ steps: number; missions: number }> = {}) => cardOfInspection({ id: "abc", href: "/t/abc", host: "yara.garden", status, steps: 0, missions: 0, at: 1, ...more });
const camp = (status: string, total: number, paid: number, checking = 0) => cardOfCampaign({ id: "c1", href: "/t/c1", host: "yara.garden", status, total, paid, checking, event: null, at: 1 });

describe("a test, as its card reads", () => {
  it("every stage of Sage trying a product is 'trying', in plain words", () => {
    for (const s of ["queued", "fetching", "field_test", "mapping", "analyzing", "generating_missions", "reviewing"]) {
      const c = insp(s);
      expect(c.state, s).toBe("trying");
      expect(c.line, s).toMatch(/^Sage is /);
    }
    expect(insp("field_test", { steps: 6 }).event).toBe("6 steps so far");
  });

  it("a finished try is ready, and says what was written", () => {
    expect(insp("ready", { missions: 2, steps: 26 })).toMatchObject({ state: "ready", line: "2 missions written. Set the people and pay.", event: "Sage took 26 steps through it" });
    expect(insp("ready", { missions: 1 }).line).toBe("1 mission written. Set the people and pay.");
  });

  it("a question and a failure are never a dead end", () => {
    expect(insp("needs_input").state).toBe("question");
    expect(cardOfInspection({ id: "a", href: "/t/a", host: "a.com", status: "needs_input", steps: 0, missions: 0, at: 1, question: "Sage could only reach the entry screen" }).event).toBe("Sage could only reach the entry screen");
    expect(insp("failed")).toMatchObject({ state: "stopped", href: "/t/abc" });
    expect(insp("failed").line).toMatch(/try again/);
  });

  it("a live test counts people from real numbers only", () => {
    expect(camp("live", 10, 0)).toMatchObject({ state: "live", line: "Waiting for the first of 10 people." });
    expect(camp("live", 10, 4)).toMatchObject({ line: "4 of 10 paid.", places: { total: 10, paid: 4, taken: 0 } });
    expect(camp("live", 10, 4, 2).line).toBe("4 of 10 paid, 2 being checked.");
    expect(camp("live", 3, 3, 5).places).toEqual({ total: 3, paid: 3, taken: 0 });
  });

  it("a finished or stopped test says what happened", () => {
    expect(camp("completed", 10, 10)).toMatchObject({ state: "done", line: "10 people tried it and were paid." });
    expect(camp("completed", 1, 1).line).toBe("1 person tried it and was paid.");
    expect(camp("cancelled", 10, 3)).toMatchObject({ state: "done", line: "Stopped after 3 people were paid." });
    expect(camp("cancelled", 10, 0)).toMatchObject({ state: "stopped", line: "Stopped before anyone was paid." });
  });
});
