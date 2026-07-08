"use client";

import { useCallback, useEffect, useState } from "react";
import {
  createWalletClient,
  custom,
  type Address,
  type EIP1193Provider,
  type WalletClient,
} from "viem";
import { metisSepolia } from "./config";

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

function getProvider(): EIP1193Provider | null {
  if (typeof window === "undefined") return null;
  return window.ethereum ?? null;
}

export interface WalletApi {
  address: Address | null;
  chainId: number | null;
  connecting: boolean;
  /** an injected wallet is present in the browser. */
  available: boolean;
  /** connected AND on Metis Sepolia. */
  onMetis: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  switchToMetis: () => Promise<void>;
  /** a viem WalletClient bound to the connected account (null if not connected). */
  getWalletClient: () => WalletClient | null;
}

/**
 * Minimal, dependency-free wallet connection over the injected EIP-1193 provider
 * (MetaMask et al), scoped to Metis Sepolia. Restores an existing connection on
 * mount and tracks account / chain changes. Kept viem-native (no wagmi) so it
 * shares the same client stack as the rest of the app.
 */
export function useWallet(): WalletApi {
  const [address, setAddress] = useState<Address | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    const p = getProvider();
    setAvailable(!!p);
    if (!p) return;

    void p
      .request({ method: "eth_accounts" })
      .then((accs) => {
        const a = (accs as string[])[0];
        if (a) setAddress(a as Address);
      })
      .catch(() => {});
    void p
      .request({ method: "eth_chainId" })
      .then((id) => setChainId(parseInt(id as string, 16)))
      .catch(() => {});

    const onAccounts = (accs: unknown) =>
      setAddress(((accs as string[])[0] as Address) ?? null);
    const onChain = (id: unknown) => setChainId(parseInt(id as string, 16));
    p.on("accountsChanged", onAccounts);
    p.on("chainChanged", onChain);
    return () => {
      p.removeListener("accountsChanged", onAccounts);
      p.removeListener("chainChanged", onChain);
    };
  }, []);

  const connect = useCallback(async () => {
    const p = getProvider();
    if (!p) {
      window.open("https://metamask.io/download/", "_blank", "noopener");
      return;
    }
    setConnecting(true);
    try {
      const accs = await p.request({ method: "eth_requestAccounts" });
      setAddress(((accs as string[])[0] as Address) ?? null);
      const id = await p.request({ method: "eth_chainId" });
      setChainId(parseInt(id as string, 16));
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setAddress(null);
  }, []);

  const switchToMetis = useCallback(async () => {
    const p = getProvider();
    if (!p) return;
    const hexId = `0x${metisSepolia.id.toString(16)}`;
    try {
      await p.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: hexId }],
      });
    } catch {
      // 4902 (unknown chain) or similar — add it, then it becomes selected.
      await p.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: hexId,
            chainName: metisSepolia.name,
            nativeCurrency: metisSepolia.nativeCurrency,
            rpcUrls: metisSepolia.rpcUrls.default.http,
            blockExplorerUrls: [metisSepolia.blockExplorers.default.url],
          },
        ],
      });
    }
  }, []);

  const getWalletClient = useCallback((): WalletClient | null => {
    const p = getProvider();
    if (!p || !address) return null;
    return createWalletClient({
      account: address,
      chain: metisSepolia,
      transport: custom(p),
    });
  }, [address]);

  return {
    address,
    chainId,
    connecting,
    available,
    onMetis: chainId === metisSepolia.id,
    connect,
    disconnect,
    switchToMetis,
    getWalletClient,
  };
}
