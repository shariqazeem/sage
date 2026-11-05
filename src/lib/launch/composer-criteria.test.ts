import { describe, expect, it } from "vitest";
import { restatesMarkerCheck } from "./composer";

/** The card says Sage's own wallet check once, on its own line; a drafted criterion that only restates it is dropped. */
describe("a criterion that only restates Sage's automatic wallet check", () => {
  it.each([
    "The worker's wallet address appears in the PR description",
    "Your wallet address is included at the end of the post",
    "The submitter's own wallet address is visible in the doc",
    "Their USDC wallet address is listed in the video description",
  ])("drops: %s", (c) => {
    expect(restatesMarkerCheck(c)).toBe(true);
  });

  it.each([
    "The PR description lists each broken link found, with the old address and its replacement",
    "The doc names the Safe's wallet address for the treasury it describes",
    "The post links the founder's product page",
    "The guide shows how to connect a wallet to the app, with screenshots of each step and the address format the app expects, so a new user can follow it end to end without help",
  ])("keeps: %s", (c) => {
    expect(restatesMarkerCheck(c)).toBe(false);
  });
});
