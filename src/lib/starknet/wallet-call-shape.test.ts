import { describe, expect, it } from "vitest";

import {
  addMissionCall,
  fundVaultCalls,
  toWalletCalls,
  deployVaultCall,
  type StarknetCall,
} from "./vault-calls";

/**
 * TWO CONVENTIONS FOR ONE IDEA, AND THEY ARE NOT INTERCHANGEABLE.
 *
 * starknet.js takes `{ contractAddress, entrypoint }`; the browser wallet RPC
 * (`wallet_addInvokeTransaction`) takes `{ contract_address, entry_point }` and rejects the other
 * outright. Ready answered a camelCase payload with `INVALID_REQUEST_PAYLOAD` at the exact moment a
 * founder pressed "Fund $1.00 and go live" — every call correct, every address correct, and the
 * whole deployment refused on field names.
 */

const sample: StarknetCall[] = [
  { contractAddress: "0xaaa", entrypoint: "approve", calldata: ["0x1", "0x2"] },
  { contractAddress: "0xbbb", entrypoint: "fund", calldata: ["0x3"] },
];

describe("toWalletCalls", () => {
  it("renames both fields to what a wallet expects", () => {
    const [first] = toWalletCalls(sample);
    expect(first).toEqual({
      contract_address: "0xaaa",
      entry_point: "approve",
      calldata: ["0x1", "0x2"],
    });
  });

  it("leaves NO camelCase key behind — that is what the wallet rejected", () => {
    for (const c of toWalletCalls(sample)) {
      expect(Object.keys(c).sort()).toEqual(["calldata", "contract_address", "entry_point"]);
    }
  });

  it("preserves order, because a deploy must precede the fund that depends on it", () => {
    expect(toWalletCalls(sample).map((c) => c.entry_point)).toEqual(["approve", "fund"]);
  });

  it("carries calldata through untouched", () => {
    expect(toWalletCalls(sample)[0].calldata).toEqual(["0x1", "0x2"]);
  });
});

describe("every builder's output survives the conversion", () => {
  // The real payload a founder signs: deploy, approve, fund, then one add_mission per mission.
  const real: StarknetCall[] = [
    deployVaultCall({
      classHash: "0x603be1eb",
      salt: "0x1",
      constructorCalldata: ["0x1", "0x2"],
    }),
    ...fundVaultCalls({ vaultAddress: "0xabc1", token: "0xdef2", amountBase: BigInt(1_000_000) }),
    addMissionCall({
      vaultAddress: "0xabc1",
      missionId: "0x9",
      rewardBase: BigInt(500_000),
      maxCompletions: 1,
    }),
  ];

  it("produces only wallet-shaped calls, with string calldata throughout", () => {
    for (const c of toWalletCalls(real)) {
      expect(c.contract_address).toMatch(/^0x[0-9a-f]+$/i);
      expect(typeof c.entry_point).toBe("string");
      // A BigInt here would not survive being posted to the wallet.
      for (const felt of c.calldata) expect(typeof felt).toBe("string");
    }
  });
});
