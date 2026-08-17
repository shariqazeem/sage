import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/db/campaigns", () => ({ listCampaigns: vi.fn(), listSubmissions: vi.fn() }));
import { formatDuration } from "./tester-supply";

/**
 * A founder deciding whether to fund a plan is not worried about the money. They are worried they
 * will fund it and nobody will come. This number is the answer, so it has to read like something a
 * person feels rather than a field from a database.
 */
describe("formatDuration", () => {
  it("the real median reads as a human duration", () => {
    expect(formatDuration(204)).toBe("3 min 24 s");
  });

  it("under a minute stays in seconds — 'a few seconds' is the whole point", () => {
    expect(formatDuration(15)).toBe("15 seconds");
    expect(formatDuration(59)).toBe("59 seconds");
  });

  it("a whole number of minutes drops the seconds", () => {
    expect(formatDuration(120)).toBe("2 minutes");
  });

  it("no data reads as unknown, never as zero", () => {
    expect(formatDuration(null)).toBe("—");
  });
});
