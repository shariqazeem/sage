import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * EVERY DOOR THAT CAN PAY SCREENS THE RECIPIENT.
 *
 * The pipeline, the admin release and the chat release ran the sanctions screen. The web founder's
 * "approve" did not, so approving held work could pay a listed address (found 5 Nov 2026).
 */
const DOORS = [
  "src/app/api/campaigns/[id]/submissions/[sid]/decide/route.ts",
  "src/lib/campaigns/review-actions.ts",
  "src/lib/deputy/pipeline.ts",
];

describe("every door that pays screens the recipient first", () => {
  for (const path of DOORS) {
    it(`${path} screens before it can settle`, () => {
      const src = readFileSync(resolve(process.cwd(), path), "utf8");
      const screen = src.indexOf("isSanctionedWallet(");
      const settle = src.search(/settleByRail\(|await settle\(|settleApprovedSubmission\(/);
      expect(screen).toBeGreaterThan(0);
      expect(settle).toBeGreaterThan(screen);
    });
  }
});
