import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A proof of personhood without a proof of wallet control states nothing useful — the PAIR is the
 * claim. This route once read the wallet from the request body, which let anyone bind a proof to an
 * address they did not control, including someone else's. The submit door beside it already derived
 * the wallet from the session, so identity was the one place held to a weaker standard than the
 * money path.
 */
describe("identity binds only to a wallet the caller controls", () => {
  const src = readFileSync(resolve(process.cwd(), "src/app/api/identity/route.ts"), "utf8");
  /**
   * Read the CODE, not the prose. The first version of this assertion failed on the comment that
   * explains what was removed, because the phrase it forbids is in that explanation — a test that
   * can be fooled by a sentence is not checking the thing it claims to check.
   */
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const post = code.slice(code.indexOf("export async function POST"));

  it("reads the wallet from the session, never from the request body", () => {
    expect(post).toMatch(/getSessionAddress\(\)/);
    expect(post).toMatch(/getStarknetSessionAddress\(\)/);
    expect(post).not.toMatch(/body\.wallet/);
  });

  it("refuses rather than guessing when nobody is signed in", () => {
    expect(post).toMatch(/if \(!wallet\)/);
    expect(post).toMatch(/status: 401/);
  });

  it("covers both rails, so a Starknet worker is not locked out of standing", () => {
    const evmAt = post.indexOf("getSessionAddress()");
    const strkAt = post.indexOf("getStarknetSessionAddress()");
    expect(evmAt).toBeGreaterThan(-1);
    expect(strkAt).toBeGreaterThan(evmAt);
  });
});
