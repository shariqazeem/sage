import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * strk20.json exists twice on purpose: the repo root is the submission artifact, public/ is
 * what https://sagepays.xyz/strk20.json serves. Two copies of a qualifying manifest that can
 * disagree is exactly the drift shape this codebase keeps paying for — so the suite reads both.
 */
describe("the STRK20 manifest", () => {
  it("serves byte-identical content from the repo root and public/", () => {
    const root = readFileSync(join(process.cwd(), "strk20.json"), "utf8");
    const served = readFileSync(join(process.cwd(), "public", "strk20.json"), "utf8");
    expect(served).toBe(root);
  });
});
