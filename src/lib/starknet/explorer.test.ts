import { describe, expect, it } from "vitest";
import { STARKNET_EXPLORER, starknetAddressUrl, starknetTxUrl } from "./explorer";

/**
 * A LINK BUILT FROM AN EMPTY HASH IS A DEAD PAGE OFFERED TO SOMEONE WHO WAS JUST PAID.
 *
 * REPORTED after the first private collection: "View the transaction" opened
 * `https://voyager.online/tx/` with nothing after it. The claim page rendered the anchor
 * unconditionally, and the hash is empty whenever the CHAIN observes the collection before the
 * wallet returns — which is a real, successful outcome, not an error.
 */
describe("the Starknet explorer link", () => {
  it("points at starkscan, where Sage's own transactions are linked from", () => {
    expect(STARKNET_EXPLORER).toBe("https://starkscan.co");
    expect(starknetTxUrl("0xb4a7cb07289eb2137bf4e13726f406154c1fef48d20625687af5acbf60b735")).toBe(
      "https://starkscan.co/tx/0xb4a7cb07289eb2137bf4e13726f406154c1fef48d20625687af5acbf60b735",
    );
  });

  it("returns null rather than a link to nowhere", () => {
    for (const v of ["", "   ", null, undefined, "not-a-hash", "0x"]) {
      expect(starknetTxUrl(v), JSON.stringify(v)).toBeNull();
    }
  });

  it("does the same for an address", () => {
    expect(starknetAddressUrl("0x9bd1ea")).toBe("https://starkscan.co/contract/0x9bd1ea");
    expect(starknetAddressUrl("")).toBeNull();
  });

  it("trims, because a hash pasted with whitespace is still a hash", () => {
    expect(starknetTxUrl("  0xabc  ")).toBe("https://starkscan.co/tx/0xabc");
  });
});
