import { describe, expect, it } from "vitest";
import { framesOf, noteOf } from "./real-test-frames";

const state = (n: number, trigger: string, delta: number) => ({ trigger, screenshot: `/api/field-tests/abc/${n}`, url: "https://yara.garden/", pixelDeltaPct: delta });

describe("the frames of a real run", () => {
  it("shows the first step, then the biggest changes of screen, in the order they happened", () => {
    const run = framesOf(
      {
        ran: true,
        durationMs: 87_708,
        states: [state(0, "initial load", 100), state(1, 'clicked "tap to step inside"', 1), state(2, 'clicked "tap to step inside"', 24), state(3, 'clicked "Your journey"', 49), state(4, "scrolled down", 0), state(5, "submitted the form", 15), state(6, "opened /map", 12)],
        visionObservations: [{ stateIndex: 0, sceneDescription: "A landing page with the title Yara." }],
      },
      "yara.garden",
      4,
    );
    expect(run?.steps).toBe(7);
    expect(run?.seconds).toBe(88);
    expect(run?.frames.map((f) => f.n)).toEqual([1, 3, 4, 6]);
    expect(run?.frames[0]).toMatchObject({ file: 0, note: "Opened yara.garden", saw: "A landing page with the title Yara." });
    expect(run?.frames[1].note).toBe("Clicked “tap to step inside”");
    expect(run?.frames[1].saw).toBeNull();
  });

  it("a quiet run still shows what there is, and never more than asked", () => {
    const run = framesOf({ ran: true, states: [state(0, "initial load", 100), state(1, "scrolled down", 0), state(2, "scrolled down", 2)] }, "a.com", 4);
    expect(run?.frames.map((f) => f.n)).toEqual([1, 2, 3]);
    expect(run?.seconds).toBeNull();
  });

  it("reads a page-by-page run from its pages", () => {
    const run = framesOf(
      { ran: true, states: [], pages: [{ url: "https://a.com/", h1: "Home", screenshot: "/api/field-tests/x/0" }, { url: "https://a.com/search", title: "Search", screenshot: "/api/field-tests/x/1" }, { url: "https://a.com/none", screenshot: null }] },
      "a.com",
      4,
    );
    expect(run?.steps).toBe(3);
    expect(run?.frames.map((f) => [f.note, f.saw])).toEqual([
      ["Opened a.com", "Home"],
      ["Opened /search", "Search"],
    ]);
  });

  it("is nothing when the run did not happen or kept no picture", () => {
    expect(framesOf(null, "a.com", 4)).toBeNull();
    expect(framesOf({ ran: false, states: [state(0, "initial load", 100)] }, "a.com", 4)).toBeNull();
    expect(framesOf({ ran: true, states: [{ trigger: "initial load", screenshot: null }] }, "a.com", 4)).toBeNull();
  });

  it("writes a step in plain words, from the run's own", () => {
    expect(noteOf("initial load", "a.com")).toBe("Opened a.com");
    expect(noteOf("clicked at 49%,84%", "a.com")).toBe("Clicked on the page");
    expect(noteOf('clicked ""', "a.com")).toBe("Clicked a button with no label");
    expect(noteOf('clicked "or just step inside →"', "a.com")).toBe("Clicked “or just step inside”");
    expect(noteOf("opened /agent", "a.com")).toBe("Opened /agent");
  });
});
