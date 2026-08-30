import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";

import VAULT_ABI from "./vault-abi.json";
import CLAIMS_ABI from "./claims-abi.json";

/**
 * THE HAND-COPIED ABI DRIFTED FROM THE CONTRACT, AND NOTHING NOTICED.
 *
 * Two getters were added to the Cairo vault and the TypeScript copy was never regenerated. Every
 * read of a Starknet vault then threw, and the founder was told "The vault on chain does not match
 * this plan (vault_unreadable)" about a vault that was flawless: right class, right money, right
 * campaign id. The mismatch was entirely on our side, and the message blamed theirs.
 *
 * Nothing generates these files, so this compares them against the compiled artifact. It skips
 * when the contracts have not been built, because a TypeScript-only checkout is a normal state —
 * but on any machine that has built them, drift fails here instead of in a founder's wallet.
 */

const ARTIFACT = (name: string) =>
  `contracts-starknet/target/dev/sage_claims_${name}.contract_class.json`;

const fnNames = (abi: unknown): string[] => {
  const entries = abi as { type: string; name?: string; items?: { type: string; name: string }[] }[];
  const out = new Set<string>();
  for (const e of entries) {
    if (e.type === "interface") for (const i of e.items ?? []) if (i.type === "function") out.add(i.name);
    if (e.type === "function" && e.name) out.add(e.name);
  }
  return [...out].sort();
};

const compiledAbi = (name: string): unknown | null => {
  const path = ARTIFACT(name);
  if (!existsSync(path)) return null;
  const cls = JSON.parse(readFileSync(path, "utf8")) as { abi: unknown };
  return typeof cls.abi === "string" ? JSON.parse(cls.abi) : cls.abi;
};

describe.each([
  ["SageVault", VAULT_ABI],
  ["SageClaims", CLAIMS_ABI],
])("%s ABI", (name, checkedIn) => {
  it("exposes every function the compiled contract does", () => {
    const compiled = compiledAbi(name);
    if (!compiled) return; // contracts not built in this checkout
    const missing = fnNames(compiled).filter((f) => !fnNames(checkedIn).includes(f));
    expect(missing, `missing from src/lib/starknet — regenerate the ABI`).toEqual([]);
  });

  it("claims no function the contract does not have", () => {
    // The other direction matters too: a call to something that no longer exists throws at the
    // worst moment, on a read of a real vault.
    const compiled = compiledAbi(name);
    if (!compiled) return;
    const extra = fnNames(checkedIn).filter((f) => !fnNames(compiled).includes(f));
    expect(extra, `not in the compiled contract`).toEqual([]);
  });
});

describe("the vault ABI specifically", () => {
  it("can read the plan a vault was funded for", () => {
    // The two getters whose absence produced "vault_unreadable" on a correct vault.
    for (const fn of ["get_campaign_id_hash", "get_mission_plan_digest"]) {
      expect(fnNames(VAULT_ABI)).toContain(fn);
    }
  });
});
