"use client";

import { useEffect, useState } from "react";

import { useSiwe } from "@/lib/auth/use-siwe";
import { useStarknetSiwe } from "@/lib/auth/use-starknet-siwe";
import { WalletConnect, type WalletOption } from "./wallet-connect";

/**
 * SIGNING IN AS A FOUNDER, WITH WHATEVER WALLET YOU ALREADY HAVE.
 *
 * Sage was built EVM-first and its SIWE session quietly became the account system, so a founder
 * arriving with a Starknet wallet could not start at all — not because anything about their
 * campaign needed Ethereum, but because the sign-in had been written when only one chain existed.
 * Someone holding Ready would have bounced off the front door before seeing the product.
 *
 * Both families are offered in ONE list, through the same component every other wallet moment
 * uses. Not two sections labelled by chain: a person is picking the wallet they own, and which
 * cryptographic family it belongs to is Sage's problem, not a category they should have to
 * navigate.
 */
/**
 * The injected EVM provider's own name, when it says one.
 *
 * "your Ethereum wallet" is what a person reads when we could simply have looked. Most wallets set
 * a flag on `window.ethereum`; the ones that do not still get an honest generic label.
 */
function injectedEvmName(): string | null {
  const eth = (window as { ethereum?: Record<string, unknown> }).ethereum;
  if (!eth) return null;
  const named: [string, string][] = [
    ["isMetaMask", "MetaMask"],
    ["isRabby", "Rabby"],
    ["isCoinbaseWallet", "Coinbase Wallet"],
    ["isBraveWallet", "Brave Wallet"],
    ["isTrust", "Trust Wallet"],
  ];
  // Rabby and others also set isMetaMask for compatibility, so the more specific flags win.
  for (const [flag, label] of named.slice(1)) if (eth[flag]) return label;
  if (eth.isMetaMask) return "MetaMask";
  return "your Ethereum wallet";
}

export function FounderSignIn({
  explainer,
  onSignedIn,
}: {
  explainer?: React.ReactNode;
  onSignedIn?: () => void;
}) {
  const evm = useSiwe();
  const starknet = useStarknetSiwe();

  /**
   * WHICH WALLETS EXIST IS A CLIENT FACT, AND MUST NOT BE GUESSED DURING RENDER.
   *
   * The first version asked `typeof window === "undefined" || window.ethereum`, which is TRUE on
   * the server and FALSE in a browser without MetaMask — so the server rendered a MetaMask row the
   * client then removed, and React threw a hydration mismatch on the exact screen a founder lands
   * on first. Nothing is decided until after mount, so both passes agree.
   */
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const options: WalletOption[] = [];
  const evmName = mounted ? injectedEvmName() : null;

  /**
   * ONE EXTENSION CAN APPEAR TWICE, AND MUST NOT LOOK LIKE TWO WALLETS.
   *
   * MetaMask provides `window.ethereum` AND registers a Starknet wallet through its snap, so it
   * arrived in this list once as a vague "your Ethereum wallet" and again as "MetaMask" — two rows
   * for one extension, neither saying which chain it would sign on. Where a name appears on both
   * sides it is disambiguated by the network, which is the only thing that actually differs.
   */
  const collides = (name: string) =>
    !!evmName && starknet.wallets.some((w) => w.name.toLowerCase() === evmName.toLowerCase())
      ? `${name} (Starknet)`
      : name;

  if (mounted && (evm.address || evmName)) {
    const base = evmName ?? "your Ethereum wallet";
    options.push({
      id: "evm",
      name: starknet.wallets.some((w) => w.name.toLowerCase() === base.toLowerCase())
        ? `${base} (Ethereum)`
        : base,
      onSelect: async () => {
        const ok = evm.address ? await evm.signIn() : (await evm.connect(), false);
        if (ok) onSignedIn?.();
      },
    });
  }

  for (const w of starknet.wallets) {
    options.push({
      id: `sn:${w.id}`,
      name: collides(w.name),
      icon: w.icon,
      onSelect: async () => {
        if (await starknet.signIn(w)) onSignedIn?.();
      },
    });
  }

  return (
    <WalletConnect
      options={options}
      explainer={
        explainer ?? (
          <>
            Sign in with any wallet you already have — <b>Ethereum or Starknet.</b> This is your
            Sage account; it is not where a campaign gets funded.
          </>
        )
      }
      busy={evm.signingIn || starknet.signingIn}
      busyLabel="Waiting for your wallet…"
      error={starknet.error}
      emptyMessage="No wallet found in this browser."
      installHints={[
        { name: "MetaMask", url: "https://metamask.io/download" },
        { name: "Ready", url: "https://www.ready.co" },
      ]}
    />
  );
}
