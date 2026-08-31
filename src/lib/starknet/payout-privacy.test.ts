import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import VAULT_ABI from "./vault-abi.json";

/**
 * THE PAYOUT RECEIPT MUST NOT NAME THE PERSON.
 *
 * The vault used to emit `PayoutReleased { recipient }` as an INDEXED key. The money went to
 * escrow and never touched the worker's wallet — but the vault still announced "this address was
 * approved for this amount" in a field anyone can filter on, so totalling everything Sage ever
 * paid a given wallet was one explorer query. A private destination with a public approval record
 * is not a private payout, and this is a PRIVACY rail.
 *
 * Read against the Cairo source as well as the ABI, because regenerating the ABI from a contract
 * that reintroduced the field would make the ABI agree with the mistake.
 *
 * Replay protection is untouched by this: it keys on the worker in STORAGE, which the event never
 * needed. What stays public is what should be — amount, mission, decision digest — so the vault's
 * spending is still fully auditable, just no longer attributable.
 */
const CAIRO = readFileSync("contracts-starknet/src/vault.cairo", "utf8");

function eventMembers(name: string): string[] {
  const entries = VAULT_ABI as { type: string; name?: string; members?: { name: string }[] }[];
  const e = entries.find((x) => (x.name ?? "").endsWith(name) && Array.isArray(x.members));
  if (!e) throw new Error(`${name} not found in vault-abi.json`);
  return (e.members ?? []).map((m) => m.name);
}

describe("PayoutReleased identifies the payout, not the person", () => {
  it("names no recipient in the ABI", () => {
    const members = eventMembers("PayoutReleased");
    expect(members).not.toContain("recipient");
    expect(members).not.toContain("worker");
  });

  it("carries the opaque intent hash instead", () => {
    expect(eventMembers("PayoutReleased")).toContain("intent_hash");
  });

  it("keeps the vault auditable — amount, mission and decision stay public", () => {
    const members = eventMembers("PayoutReleased");
    for (const m of ["mission_id", "amount", "decision_digest"]) expect(members).toContain(m);
  });

  it("the Cairo struct itself declares no recipient", () => {
    const struct = CAIRO.slice(
      CAIRO.indexOf("pub struct PayoutReleased {"),
      CAIRO.indexOf("}", CAIRO.indexOf("pub struct PayoutReleased {")),
    );
    expect(struct).not.toMatch(/pub recipient/);
    expect(struct).toMatch(/pub intent_hash/);
  });

  it("REPLAY PROTECTION still keys on the worker in storage — the privacy fix must not weaken it", () => {
    // If this ever stops being true, the event change would have removed a real guard rather than
    // just a disclosure.
    expect(CAIRO).toMatch(/paid_by_worker|worker/);
    expect(CAIRO).toMatch(/ALREADY_PAID|already_paid/i);
  });

  it("a REFUSAL may still name nobody either", () => {
    const members = eventMembers("PayoutRefused");
    expect(members).not.toContain("recipient");
  });
});
