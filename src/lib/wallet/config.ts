import { defineChain } from "viem";

/**
 * Client-side Metis Sepolia chain definition for the founder's wallet. This is
 * the network the founder connects to and signs owner actions on (create / fund
 * / activate / revoke). Mirrors the server config in lib/deputy/chain.ts but is
 * client-safe (no `server-only`). RPC + explorer are overridable at build time.
 */
export const metisSepolia = defineChain({
  id: 59902,
  name: "Metis Sepolia",
  nativeCurrency: { name: "Metis", symbol: "tMETIS", decimals: 18 },
  rpcUrls: {
    default: {
      http: [
        process.env.NEXT_PUBLIC_METIS_SEPOLIA_RPC ??
          "https://sepolia.metisdevops.link",
      ],
    },
  },
  blockExplorers: {
    default: {
      name: "Metis Sepolia Explorer",
      url: "https://sepolia-explorer.metisdevops.link",
    },
  },
  testnet: true,
});
