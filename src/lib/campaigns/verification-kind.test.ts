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
    // the public board gets V2MissionView (which carries the kind) straight from v2Economics; the
    // marketplace's own mapper reads the kind from the raw contract
    const market = readFileSync(resolve(process.cwd(), "src/lib/campaigns/marketplace.ts"), "utf8");
    expect(market).toMatch(/verificationKindOf\(m\.verificationContract\)/);
    const econ = readFileSync(resolve(process.cwd(), "src/lib/campaigns/v2-economics.ts"), "utf8");
    expect(econ).toMatch(/verificationKind: verificationKindOf\(m\.verificationContract\)/);
  });
});
