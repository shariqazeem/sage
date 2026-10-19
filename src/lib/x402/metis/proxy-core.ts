import { isAddressEqual, type Address, type Hex } from "viem";
import {
  METIS_CHAIN_ID,
  PERMIT2_ADDRESS,
  PERMIT2_DOMAIN_SEPARATOR_1088,
  WITNESS_TYPEHASH,
  WITNESS_TYPE_STRING,
  proxyBuildByRuntimeHash,
  type ProxyBuild,
} from "./constants";

/**
 * IS THE CONFIGURED PROXY ONE THAT CAN PAY? Pure judgment of what chain.ts reads; the facilitator stays
 * closed (503) unless every answer is right.
 *
 * Code at the address is not enough, and this is the case that proves it: the canonical x402 proxy
 * deployed on Metis has code, the right PERMIT2() and the right WITNESS_TYPEHASH(), and can never
 * settle, because Andromeda lacks the MCOPY its string encoder uses. So the check is functional:
 * WITNESS_TYPE_STRING() returns a string through the very encoder settle() uses to pass that string to
 * Permit2, and it reverts exactly when settle would.
 *
 * The runtime hash must also be one of the two known builds. The payer signs Permit2 permits naming
 * this address as the only spender, so whatever code lives there can move whatever they authorized.
 * A look-alike that answered the three views correctly and sent funds elsewhere would pass a purely
 * functional check; it cannot pass this one.
 */

export interface ProxyProbe {
  /** eth_chainId of the RPC the facilitator reads and writes through. */
  chainId: number;
  /** keccak256 of the code at the configured proxy, or null when there is none. */
  proxyCodeHash: Hex | null;
  /** Whether Permit2 has code at its canonical address. */
  permit2HasCode: boolean;
  /** Permit2.DOMAIN_SEPARATOR(), or null if the read failed. */
  permit2DomainSeparator: Hex | null;
  /** proxy.PERMIT2(), or null if the call reverted. */
  proxyPermit2: Address | null;
  /** proxy.WITNESS_TYPEHASH(), or null if the call reverted. */
  proxyWitnessTypehash: Hex | null;
  /** proxy.WITNESS_TYPE_STRING(), or null if the call reverted. */
  proxyWitnessTypeString: string | null;
}

export type ProxyVerdict = { ok: true; build: ProxyBuild } | { ok: false; message: string };

export function judgeProxyProbe(proxy: Address, probe: ProxyProbe): ProxyVerdict {
  if (probe.chainId !== METIS_CHAIN_ID) {
    return { ok: false, message: `the Metis RPC answers chain ${probe.chainId}, not ${METIS_CHAIN_ID}` };
  }
  if (!probe.permit2HasCode) {
    return { ok: false, message: `no Permit2 code at ${PERMIT2_ADDRESS} on Metis` };
  }
  if (probe.permit2DomainSeparator?.toLowerCase() !== PERMIT2_DOMAIN_SEPARATOR_1088) {
    return { ok: false, message: "Permit2's DOMAIN_SEPARATOR on this RPC is not the one built for chain 1088" };
  }
  if (probe.proxyCodeHash === null) {
    return {
      ok: false,
      message: `no code at X402_METIS_PERMIT2_PROXY_ADDRESS (${proxy}); deploy it with contracts/script/deploy-x402-permit2-proxy-metis.mjs`,
    };
  }
  const build = proxyBuildByRuntimeHash(probe.proxyCodeHash);
  if (!build) {
    return {
      ok: false,
      message: `the code at ${proxy} is not a known x402ExactPermit2Proxy build (runtime hash ${probe.proxyCodeHash})`,
    };
  }
  if (!probe.proxyPermit2 || !isAddressEqual(probe.proxyPermit2, PERMIT2_ADDRESS)) {
    return { ok: false, message: `the proxy at ${proxy} does not point at the canonical Permit2` };
  }
  if (probe.proxyWitnessTypehash?.toLowerCase() !== WITNESS_TYPEHASH) {
    return { ok: false, message: `the proxy at ${proxy} has an unexpected WITNESS_TYPEHASH` };
  }
  if (probe.proxyWitnessTypeString !== WITNESS_TYPE_STRING) {
    return {
      ok: false,
      message:
        `the ${build.name} proxy at ${proxy} cannot execute its settle path on this chain ` +
        `(WITNESS_TYPE_STRING() ${probe.proxyWitnessTypeString === null ? "reverted" : "answered wrongly"}); ` +
        "Metis Andromeda has no MCOPY, so deploy the paris build",
    };
  }
  return { ok: true, build };
}
