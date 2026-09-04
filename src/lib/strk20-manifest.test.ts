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

/**
 * THE SCORED KEYS. The organiser's README (read 2026-09-05): `transactions` and `demo_video` are
 * "to be scored"; `demo_url` is optional. The manifest carried the video under `demo_url` only, so a
 * scorer reading it by its schema found no video — one line between scored and unscored.
 */
describe("the STRK20 manifest carries what the panel scores", () => {
  const m = JSON.parse(readFileSync(join(process.cwd(), "strk20.json"), "utf8")) as Record<string, unknown>;
  it("names the demo video under the scored key, not only the optional one", () => {
    expect(typeof m.demo_video).toBe("string");
    expect(m.demo_video as string).toMatch(/^https:\/\//);
  });
  it("lists at least three mainnet transactions and the contracts they ran through", () => {
    expect(Array.isArray(m.transactions)).toBe(true);
    expect((m.transactions as string[]).length).toBeGreaterThanOrEqual(3);
    for (const tx of m.transactions as string[]) expect(tx).toMatch(/^0x[0-9a-f]{50,64}$/);
    expect((m.contracts as string[]).length).toBeGreaterThanOrEqual(1);
  });
});
