import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { submissionState } from "./views";
import type { DecisionBrief } from "@/lib/deputy/brain-core";

const brief = (recommendation: "pay" | "hold"): DecisionBrief =>
  ({ recommendation }) as unknown as DecisionBrief;

describe("agent-api submissionState — one truthful reduction", () => {
  it("paid once settled with a tx", () => {
    expect(submissionState({ status: "paid", payoutTx: "0xabc" }, brief("pay"))).toBe("paid");
  });
  it("reviewing when there is no decision yet", () => {
    expect(submissionState({ status: "pending", payoutTx: null }, null)).toBe("reviewing");
  });
  it("verified when decided pay but not yet settled", () => {
    expect(submissionState({ status: "pending", payoutTx: null }, brief("pay"))).toBe("verified");
  });
  it("held when decided hold", () => {
    expect(submissionState({ status: "pending", payoutTx: null }, brief("hold"))).toBe("held");
  });
  it("never reports paid without a tx", () => {
    expect(submissionState({ status: "paid", payoutTx: null }, brief("pay"))).not.toBe("paid");
  });
});

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".ts") || p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

describe("agent API cannot sign, settle, or move funds (structural)", () => {
  const dir = join(process.cwd(), "src/app/api/agent");
  const files = walk(dir);
  // The agent surface is READ + inspection-start only. It must never touch a signer, a vault
  // write, the payout function, or a private key. This locks that in at the import level.
  const FORBIDDEN: [RegExp, string][] = [
    [/\bsendVaultWrite\b/, "vault write"],
    [/\brequestPayout\b/, "payout call"],
    [/settleSubmission|settleWithRecovery|runDeputyOnSubmission/, "settlement"],
    [/privateKeyToAccount|loadOperatorKey|OPERATOR_PRIVATE_KEY|GOAT_AGENT_PRIVATE_KEY/, "private key"],
    [/from ["']@\/lib\/deputy\/signer["']/, "signer import"],
  ];

  it("has agent routes to check", () => expect(files.length).toBeGreaterThan(0));

  for (const f of files) {
    const rel = f.slice(f.indexOf("src/"));
    it(`${rel} imports no signing/settlement/key primitive`, () => {
      const src = readFileSync(f, "utf8");
      for (const [re, label] of FORBIDDEN) {
        expect(re.test(src), `${rel} must not reference ${label}`).toBe(false);
      }
    });
  }
});
