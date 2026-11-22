import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReleaseLine, missionsToRelease } from "./release-line";

const LINE = "Sage may ask you to release answers to this mission: much of what it can check is also on the mission card or your public page. An answer that names what is behind the first screen is still paid without you.";
const missions = [
  { missionKey: "core-first-try", title: "Try Driftboard for the first time" },
  { missionKey: "pricing", title: "Check the pricing claim" },
];

describe("answers the builder may release", () => {
  it("names only the missions the server marked, in plan order, with the server's own sentence", () => {
    const items = missionsToRelease(
      { observation: true, sources: 7, autonomous: true, missions: [
        { missionKey: "core-first-try", autonomous: true, cardClears: false, tryOnlySources: 5, line: null },
        { missionKey: "pricing", autonomous: false, cardClears: true, tryOnlySources: 4, line: LINE },
      ] },
      missions,
    );
    expect(items).toEqual([{ n: 2, title: "Check the pricing claim", line: LINE }]);
    render(<ReleaseLine items={items} />);
    expect(screen.getByText("Answers you may release")).toBeTruthy();
    expect(screen.getByText("02 Check the pricing claim")).toBeTruthy();
    expect(screen.getByText(LINE)).toBeTruthy();
  });

  it("says nothing when every mission is Sage's to pay, or when the server sent no per-mission record", () => {
    expect(missionsToRelease({ observation: true, sources: 7, autonomous: true }, missions)).toEqual([]);
    expect(missionsToRelease(null, missions)).toEqual([]);
    const { container } = render(<ReleaseLine items={[]} />);
    expect(container.innerHTML).toBe("");
  });
});
