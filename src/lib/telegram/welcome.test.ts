import { describe, it, expect } from "vitest";
import { startWelcomeText, helpText } from "./format";
import { splitForTelegram } from "./chunk";

describe("startWelcomeText — /start first contact", () => {
  const s = startWelcomeText();

  it("introduces Sage, shows one example command, and says what happens next", () => {
    expect(s).toContain("Sage");
    expect(s).toContain("test my product at https://yourproduct.com, budget $10");
    expect(s).toContain("about 2 minutes");
    expect(s.toLowerCase()).toContain("fund"); // "nothing is charged until YOU fund it"
    expect(s).toContain("/help");
    expect(s).toContain("/status");
  });

  it("uses the single user-facing name only — never 'Deputy'", () => {
    expect(s).not.toContain("Deputy");
  });

  it("fits one Telegram chunk, so its HTML formatting is preserved", () => {
    expect(splitForTelegram(s)).toHaveLength(1);
  });
});

describe("helpText — /help", () => {
  const h = helpText();

  it("states the three lifecycle steps (inspect → fund → autonomous payouts + proof)", () => {
    expect(h).toContain("inspect");
    expect(h.toLowerCase()).toContain("fund");
    expect(h).toContain("proof link");
  });

  it("lists the commands and never says 'Deputy'", () => {
    expect(h).toContain("/start");
    expect(h).toContain("/status");
    expect(h).toContain("/agent");
    expect(h).not.toContain("Deputy");
  });

  it("fits one Telegram chunk", () => {
    expect(splitForTelegram(h)).toHaveLength(1);
  });
});
