import { describe, expect, it } from "vitest";
import { DEFAULT_WEEKS, repeatFromWords } from "./words";

/** "Every week, for 8 weeks", read from the founder's words; a duration alone is never a repeat. */
describe("reading a schedule from the founder's words", () => {
  it.each([
    ["pay my 40 ambassadors $5 for a thread about Metis every week for 8 weeks", 8],
    ["Weekly: $10 to each tester who files a bug, for the next six weeks", 6],
    ["an 8-week programme for our community writers", 8],
    ["every Monday, pay the moderators $20", DEFAULT_WEEKS],
    ["each week, $5 per merged PR", DEFAULT_WEEKS],
    ["every week for 40 weeks", 26],
  ])("%s → %i weeks", (text, weeks) => {
    expect(repeatFromWords(text)).toBe(weeks);
  });

  it.each([
    "hire a designer for 2 weeks to redo our landing page",
    "fund my cousin's shop $60 in three milestones",
    "pay 10 people $2 to try the app",
    "deliver within 3 weeks",
  ])("%s → once", (text) => {
    expect(repeatFromWords(text)).toBe(0);
  });
});
