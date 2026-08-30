import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REFUSAL, refusalReason } from "./vault";

/**
 * THE REASON A PAYOUT WAS REFUSED IS READ OFF A NUMBER.
 *
 * The vault answers a refused payout with a CODE rather than reverting, deliberately: the reason
 * lands on chain where anyone can read it. On this side that code is looked up in a hand-written
 * map, and nothing connected the two — so inserting a code in vault.cairo would silently shift
 * every explanation after it by one. A recipient who hit the daily cap would be told the vault
 * cannot afford them; a founder debugging an unpaid mission would be sent after the wrong thing.
 *
 * This rail has already lost a week to a checked-in artifact drifting from the deployed contract
 * (the ABI). Reading the contract itself is the only version of this test that cannot go stale.
 */

const CAIRO = readFileSync(join(process.cwd(), "contracts-starknet/src/vault.cairo"), "utf8");

/** The refusal module in vault.cairo, parsed as the source of truth. */
function cairoRefusalCodes(): Map<number, string> {
  const mod = /pub mod refusal \{([\s\S]*?)\n\}/.exec(CAIRO);
  if (!mod) throw new Error("could not find `pub mod refusal` in vault.cairo");
  const out = new Map<number, string>();
  for (const m of mod[1].matchAll(/pub const ([A-Z_]+): u8 = (\d+);/g)) {
    out.set(Number(m[2]), m[1]);
  }
  return out;
}

describe("the refusal map matches the contract it explains", () => {
  const cairo = cairoRefusalCodes();

  it("parsed the contract at all — an empty read would make every check below vacuous", () => {
    expect(cairo.size).toBeGreaterThanOrEqual(12);
    expect(cairo.get(0)).toBe("NONE");
  });

  it("covers every code the vault can return, with no gaps", () => {
    const codes = [...cairo.keys()].sort((a, b) => a - b);
    expect(codes).toEqual(Array.from({ length: codes.length }, (_, i) => i));
    for (const code of codes) {
      expect(REFUSAL[code as keyof typeof REFUSAL], `code ${code} (${cairo.get(code)})`).toBeTruthy();
    }
  });

  it("invents no code the vault cannot return", () => {
    for (const key of Object.keys(REFUSAL)) {
      expect(cairo.has(Number(key)), `REFUSAL has ${key}, vault.cairo does not`).toBe(true);
    }
  });

  it("explains each code as the thing the contract actually named", () => {
    // Not a spelling check — a semantic one. Each contract constant must appear in its own
    // sentence, so a shifted map (every reason off by one) fails here rather than in a receipt.
    const mustMention: Record<string, RegExp> = {
      NONE: /paid/i,
      NOT_ACTIVE: /not active/i,
      NOT_OPERATOR: /operator/i,
      NO_SUCH_MISSION: /no such mission/i,
      ZERO_RECIPIENT: /recipient.*empty/i,
      MISSING_DIGESTS: /decision|intent|commitment/i,
      ALREADY_PAID: /already paid/i,
      MISSION_FULL: /already paid|every completion/i,
      INTENT_REPLAYED: /already settled/i,
      OVER_BUDGET: /budget/i,
      OVER_DAILY_CAP: /daily/i,
      INSUFFICIENT_BALANCE: /enough/i,
    };
    for (const [code, name] of cairo) {
      const re = mustMention[name];
      expect(re, `vault.cairo gained ${name} — give it a sentence in REFUSAL and a rule here`).toBeTruthy();
      expect(refusalReason(code), `code ${code} (${name})`).toMatch(re);
    }
  });

  it("never invents an explanation for a code it does not know", () => {
    expect(refusalReason(99)).toBe("refused (code 99)");
    expect(refusalReason(-1)).toBe("refused (code -1)");
  });

  it("code 0 is the only one that means the money moved", () => {
    // Everything downstream keys "did this pay?" off the code being 0. Any other code that read as
    // success would mark an unpaid submission settled.
    const paid = [...cairo.keys()].filter((c) => /paid/i.test(refusalReason(c)) && !/already|every/i.test(refusalReason(c)));
    expect(paid).toEqual([0]);
  });
});
