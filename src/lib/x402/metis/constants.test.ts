import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  concat,
  encodeAbiParameters,
  getAddress,
  getCreate2Address,
  hashTypedData,
  keccak256,
  toHex,
  type Hex,
} from "viem";
import {
  CREATE2_DEPLOYER,
  M_USDC,
  PERMIT2_ADDRESS,
  PERMIT2_DOMAIN,
  PERMIT2_DOMAIN_SEPARATOR_1088,
  PERMIT2_WITNESS_TYPES,
  PROXY_BUILDS,
  PROXY_SALT,
  WITNESS_TYPEHASH,
  WITNESS_TYPE_STRING,
  proxyBuildByRuntimeHash,
} from "./constants";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const initcode = (rel: string): Hex => {
  const h = read(rel).trim();
  return (h.startsWith("0x") ? h : `0x${h}`) as Hex;
};

describe("the EIP-712 encoding is Permit2's own", () => {
  it("WITNESS_TYPEHASH is keccak256 of the Witness type", () => {
    expect(WITNESS_TYPEHASH).toBe(keccak256(toHex("Witness(address to,uint256 validAfter)")));
  });

  it("the pinned domain separator is the one Permit2 builds for chain 1088", () => {
    const typeHash = keccak256(toHex("EIP712Domain(string name,uint256 chainId,address verifyingContract)"));
    const separator = keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "address" }],
        [typeHash, keccak256(toHex("Permit2")), BigInt(1088), PERMIT2_ADDRESS],
      ),
    );
    expect(separator).toBe(PERMIT2_DOMAIN_SEPARATOR_1088);
  });

  it("viem's digest of the payer's message equals Permit2's permitWitnessTransferFrom hash", () => {
    const m = {
      permitted: { token: M_USDC.address, amount: BigInt(10_000) },
      spender: PROXY_BUILDS.paris.address,
      nonce: BigInt("33247007178036348590600198031289925668252061821958005840077069883511451257277"),
      deadline: BigInt(1_792_400_300),
      witness: { to: getAddress("0x209693bc6afc0c5328ba36faf03c514ef312287c"), validAfter: BigInt(0) },
    };
    // Uniswap/permit2 PermitHash.hashWithWitness + EIP712._hashTypedData, by hand.
    const stub = "PermitWitnessTransferFrom(TokenPermissions permitted,address spender,uint256 nonce,uint256 deadline,";
    const typeHash = keccak256(toHex(stub + WITNESS_TYPE_STRING));
    const tokenPermissions = keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "address" }, { type: "uint256" }],
        [keccak256(toHex("TokenPermissions(address token,uint256 amount)")), m.permitted.token, m.permitted.amount],
      ),
    );
    const witness = keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "address" }, { type: "uint256" }],
        [WITNESS_TYPEHASH, m.witness.to, m.witness.validAfter],
      ),
    );
    const struct = keccak256(
      encodeAbiParameters(
        [{ type: "bytes32" }, { type: "bytes32" }, { type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes32" }],
        [typeHash, tokenPermissions, m.spender, m.nonce, m.deadline, witness],
      ),
    );
    const onChain = keccak256(concat(["0x1901", PERMIT2_DOMAIN_SEPARATOR_1088, struct]));
    const viemDigest = hashTypedData({
      domain: PERMIT2_DOMAIN,
      types: PERMIT2_WITNESS_TYPES,
      primaryType: "PermitWitnessTransferFrom",
      message: m,
    });
    expect(viemDigest).toBe(onChain);
  });
});

/** A byte-aligned position of `needle` (hex, no 0x) in `hex`, at or after byte `from`. */
function byteIndex(hex: string, needle: string, from: number): number {
  for (let i = hex.indexOf(needle, from * 2); i !== -1; i = hex.indexOf(needle, i + 1)) {
    if (i % 2 === 0) return i / 2;
  }
  return -1;
}

/**
 * The CODE of an initcode, constructor and runtime, without the data solc appends. Data is not
 * executed and may hold any byte (the ReentrancyGuard slot constant contains 0x5f, which is not a
 * PUSH0), so only code is scanned. Layout of both builds: [constructor][runtime code][0xfe][data:
 * the witness type string, then constants][ctor arg]. The runtime starts at the second
 * free-memory-pointer prologue (6080604052; the constructor's own is 60a0604052).
 */
function codeRegions(initcode: Hex): Buffer[] {
  const hex = initcode.slice(2);
  const runtimeAt = byteIndex(hex, "6080604052", 1);
  const dataAt = byteIndex(hex, toHex("Witness witness)").slice(2), runtimeAt);
  if (runtimeAt < 0 || dataAt < 0) throw new Error("unexpected initcode layout");
  const bytes = Buffer.from(hex, "hex");
  return [bytes.subarray(0, runtimeAt), bytes.subarray(runtimeAt, dataAt)];
}

/** Walk code as an EVM would, skipping PUSH data, and collect the opcodes Andromeda lacks. */
function missingOnMetis(code: Hex): string[] {
  const names: Record<number, string> = {
    0x5f: "PUSH0",
    0x5c: "TLOAD",
    0x5d: "TSTORE",
    0x5e: "MCOPY",
    0x48: "BASEFEE",
    0x49: "BLOBHASH",
    0x4a: "BLOBBASEFEE",
  };
  const found = new Set<string>();
  for (const region of codeRegions(code)) {
    let i = 0;
    for (; i < region.length; i++) {
      const op = region[i]!;
      if (names[op]) found.add(names[op]);
      if (op >= 0x60 && op <= 0x7f) i += op - 0x5f;
    }
    // A walk that is really over code ends exactly on the region's last byte; a PUSH running past the
    // end would mean the region boundary was guessed wrong and the scan proves nothing.
    if (i !== region.length) throw new Error("the code region does not end on an instruction boundary");
  }
  // the runtime code ends with solc's designated INVALID before its data
  const runtime = codeRegions(code)[1]!;
  if (runtime[runtime.length - 1] !== 0xfe) throw new Error("the runtime code does not end with INVALID");
  return [...found].sort();
}

describe("the vendored proxy initcode", () => {
  for (const build of Object.values(PROXY_BUILDS)) {
    it(`${build.name}: hashes to the pinned initCodeHash and lands at the pinned CREATE2 address`, () => {
      const code = initcode(build.initCodeFile);
      expect(keccak256(code)).toBe(build.initCodeHash);
      expect(getCreate2Address({ from: CREATE2_DEPLOYER, salt: PROXY_SALT, bytecodeHash: build.initCodeHash })).toBe(
        build.address,
      );
      // the constructor argument is the canonical Permit2
      expect(code.slice(-64)).toBe(PERMIT2_ADDRESS.slice(2).toLowerCase().padStart(64, "0"));
    });
  }

  it("the canonical build is the x402 deployment (0x402085…0001), and it needs MCOPY", () => {
    expect(PROXY_BUILDS.canonical.address).toBe("0x402085c248EeA27D92E8b30b2C58ed07f9E20001");
    expect(missingOnMetis(initcode(PROXY_BUILDS.canonical.initCodeFile))).toContain("MCOPY");
  });

  it("the paris build uses none of the opcodes Metis Andromeda lacks", () => {
    expect(missingOnMetis(initcode(PROXY_BUILDS.paris.initCodeFile))).toEqual([]);
  });

  it("a runtime hash maps to its build, and nothing else maps", () => {
    expect(proxyBuildByRuntimeHash(PROXY_BUILDS.paris.runtimeCodeHash.toUpperCase().replace("0X", "0x"))?.name).toBe(
      "paris",
    );
    expect(proxyBuildByRuntimeHash(PROXY_BUILDS.canonical.runtimeCodeHash)?.name).toBe("canonical");
    expect(proxyBuildByRuntimeHash(keccak256("0x00"))).toBeNull();
  });
});

describe("the deploy script and this module agree (two lists that must not drift)", () => {
  const script = read("contracts/script/deploy-x402-permit2-proxy-metis.mjs");
  const constant = (name: string): string => {
    const m = new RegExp(`const ${name} =\\s*"([^"]+)"`).exec(script);
    if (!m) throw new Error(`${name} not found in the deploy script`);
    return m[1]!;
  };

  it("same Permit2, domain separator, deployer, salt and witness types", () => {
    expect(getAddress(constant("PERMIT2"))).toBe(PERMIT2_ADDRESS);
    expect(constant("PERMIT2_DOMAIN_SEPARATOR_1088")).toBe(PERMIT2_DOMAIN_SEPARATOR_1088);
    expect(getAddress(constant("CREATE2_DEPLOYER"))).toBe(CREATE2_DEPLOYER);
    expect(constant("PROXY_SALT")).toBe(PROXY_SALT);
    expect(constant("WITNESS_TYPE_STRING")).toBe(WITNESS_TYPE_STRING);
    expect(constant("WITNESS_TYPEHASH")).toBe(WITNESS_TYPEHASH);
  });

  for (const build of Object.values(PROXY_BUILDS)) {
    it(`same ${build.name} build`, () => {
      const m = new RegExp(
        `${build.name}: \\{\\s*address: "([^"]+)",\\s*initCodeHash: "([^"]+)",\\s*runtimeCodeHash: "([^"]+)",\\s*file: "([^"]+)"`,
      ).exec(script);
      if (!m) throw new Error(`the ${build.name} build is not in the deploy script`);
      expect(getAddress(m[1]!)).toBe(build.address);
      expect(m[2]).toBe(build.initCodeHash);
      expect(m[3]).toBe(build.runtimeCodeHash);
      expect(`contracts/script/${m[4]}`).toBe(build.initCodeFile);
    });
  }
});
