"use client";

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
export function FounderSignIn({
  explainer,
  onSignedIn,
}: {
  explainer?: React.ReactNode;
  onSignedIn?: () => void;
}) {
  const evm = useSiwe();
  const starknet = useStarknetSiwe();

  const options: WalletOption[] = [];

  // The EVM provider is injected and unnamed, so it is listed once — the browser picks which.
  if (evm.address || typeof window === "undefined" || (window as { ethereum?: unknown }).ethereum) {
    options.push({
      id: "evm",
      name: evm.address ? "your Ethereum wallet" : "MetaMask",
      onSelect: async () => {
        const ok = evm.address ? await evm.signIn() : (await evm.connect(), false);
        if (ok) onSignedIn?.();
      },
    });
  }

  for (const w of starknet.wallets) {
    options.push({
      id: `sn:${w.id}`,
      name: w.name,
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
