"use client";

import { useEffect } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { createWalletClient, custom, type WalletClient } from "viem";

/**
 * THE WALLET AN EMAIL SIGN-IN HOLDS, made usable where the board needs a signer.
 *
 * A worker who signed in with an email has a Privy embedded wallet and a Sage session bound to it —
 * but the board only knew the injected provider (MetaMask et al.), so an email session read as
 * signed OUT and the one control that pays ("submit") never appeared. The evidence claim is signed
 * by the wallet that gets paid (EIP-712), so the embedded wallet must be able to sign, not merely
 * be known. This component mounts only when the login app is configured (Privy's hooks throw
 * outside their provider), reads the embedded wallet, and hands the card an address plus a viem
 * client over Privy's own EIP-1193 provider. Nothing else about the injected path changes.
 */
export interface EmbeddedWallet {
  address: `0x${string}`;
  /** A viem wallet client over the embedded wallet's provider — for typed-data signatures. */
  getWalletClient: () => Promise<WalletClient | null>;
}

export function EmbeddedWalletBridge({ onChange }: { onChange: (w: EmbeddedWallet | null) => void }) {
  const { ready, authenticated } = usePrivy();
  const { wallets } = useWallets();
  useEffect(() => {
    if (!ready || !authenticated) {
      onChange(null);
      return;
    }
    const w = wallets.find((x) => x.walletClientType === "privy") ?? wallets[0];
    if (!w || !/^0x[0-9a-fA-F]{40}$/.test(w.address)) {
      onChange(null);
      return;
    }
    const address = w.address as `0x${string}`;
    onChange({
      address,
      getWalletClient: async () => {
        try {
          const provider = await w.getEthereumProvider();
          return createWalletClient({ account: address, transport: custom(provider) });
        } catch {
          return null;
        }
      },
    });
  }, [ready, authenticated, wallets, onChange]);
  return null;
}
