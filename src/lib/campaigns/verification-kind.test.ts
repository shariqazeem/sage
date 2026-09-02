import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { verificationKindOf } from "./v2-economics";

describe("the board's evidence coaching follows the operator's contract", () => {
  it("reads a kind only from a real contract", () => {
    expect(verificationKindOf({ kind: "artifact_url", allowedHosts: [], markerKind: "wallet" })).toBe("artifact_url");
    expect(verificationKindOf({ kind: "onchain_tx", chainId: 2345 })).toBe("onchain_tx");
    expect(verificationKindOf({ kind: "something_else" })).toBeUndefined();
    expect(verificationKindOf(null)).toBeUndefined();
    expect(verificationKindOf("artifact_url")).toBeUndefined();
  });
  it("an artifact gig's board asks for the page YOU created, and every mapper passes the kind through", () => {
    const board = readFileSync(resolve(process.cwd(), "src/components/campaigns/v2-board.tsx"), "utf8");
    expect(board).toMatch(/kind === "artifact_url"/);
    expect(board).toMatch(/a public page <b>you created<\/b>/);
    for (const f of ["src/lib/campaigns/marketplace.ts", "src/app/campaign/[id]/page.tsx"]) {
      const src = readFileSync(resolve(process.cwd(), f), "utf8");
      expect(src, f).toMatch(/verificationKind/);
    }
  });
});
