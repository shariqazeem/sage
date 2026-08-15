"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createWalletClient,
  custom,
  type Address,
  type EIP1193Provider,
  type WalletClient,
} from "viem";
import { metisSepolia } from "./config";
import { viemChainFor } from "@/lib/deputy/networks";

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

/**
 * FINDING THE WALLET, WHEN THE BROWSER HAS SEVERAL AND THEY ARE STILL ARRIVING.
 *
 * `window.ethereum` is a single slot that every injected wallet races to claim, and whoever writes
 * last wins. Reading it once at mount fails two ordinary situations: a browser with several wallet
 * extensions where the winner is not the one the person actually uses, and a wallet that injects
 * AFTER React has mounted — the hook sets `available: false`, never looks again, and no amount of
 * reconnecting changes anything, because nothing is listening.
 *
 * Measured 2026-08-15: a founder mid-deploy reconnected their wallet repeatedly and kept getting
 * "your wallet is not connected", with the vault already live on chain and the signature waiting.
 *
 * EIP-6963 is the standard answer: wallets ANNOUNCE themselves on an event, so discovery is
 * event-driven instead of a single lucky read. We keep every announced provider, prefer one that
 * already has an authorized account for this site (the wallet the person actually uses here), and
 * fall back to the legacy `providers[]` array and finally the bare `window.ethereum`.
 */
const announced: EIP1193Provider[] = [];

function candidateProviders(): EIP1193Provider[] {
  if (typeof window === "undefined") return [];
  const w = window as unknown as {
    ethereum?: EIP1193Provider & { providers?: EIP1193Provider[] };
  };
  const legacy = w.ethereum?.providers ?? [];
  const bare = w.ethereum ? [w.ethereum] : [];
  // announced first: an explicit EIP-6963 announcement beats whoever won the global slot
  return [...new Set([...announced, ...legacy, ...bare])];
}

function getProvider(): EIP1193Provider | null {
  return candidateProviders()[0] ?? null;
}

/** Ask every candidate which one already has an account authorized for this site. */
async function authorizedProvider(): Promise<{ provider: EIP1193Provider; address: string } | null> {
  for (const p of candidateProviders()) {
    try {
      const accs = (await p.request({ method: "eth_accounts" })) as string[];
      if (accs?.[0]) return { provider: p, address: accs[0] };
    } catch {
      /* a provider that will not answer is simply not the one */
    }
  }
  return null;
}

export interface WalletApi {
  address: Address | null;
  chainId: number | null;
  connecting: boolean;
  /** an injected wallet is present in the browser. */
  available: boolean;
  /** connected AND on Metis Sepolia. */
  onMetis: boolean;
  /** connected AND on the given chain. */
  onChain: (chainId: number) => boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  switchToMetis: () => Promise<void>;
  /** switch the wallet to any Deputy-supported chain (Metis Sepolia, GOAT, …). */
  switchToChain: (chainId: number) => Promise<void>;
  /** a viem WalletClient bound to the connected account (null if not connected).
   *  Pass a chainId to bind it to that chain; defaults to Metis Sepolia. */
  getWalletClient: (chainId?: number) => WalletClient | null;
}

/**
 * Minimal, dependency-free wallet connection over the injected EIP-1193 provider
 * (MetaMask et al). Restores an existing connection on mount and tracks account /
 * chain changes. Chain-parametric: defaults to Metis Sepolia so every pre-existing
 * caller is untouched, and `switchToChain` / `getWalletClient(chainId)` let the
 * launch wizard deploy on GOAT mainnet too. Kept viem-native (no wagmi).
 */
export function useWallet(): WalletApi {
  const [address, setAddress] = useState<Address | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [available, setAvailable] = useState(false);
  // Synchronous guard: `connecting` is async React state, so a fast double-click
  // can fire eth_requestAccounts twice (the double-MetaMask-prompt bug from the
  // control fixture) before it flips. This ref blocks the re-entrant call.
  const connectingRef = useRef(false);
  /** the provider discovery actually bound to — the one holding this site's account. Every signing
   *  path must use THIS one, not whoever happens to own `window.ethereum` at the moment of the call. */
  const providerRef = useRef<EIP1193Provider | null>(null);

  useEffect(() => {
    let bound: EIP1193Provider | null = null;
    const onAccounts = (accs: unknown) =>
      setAddress(((accs as string[])[0] as Address) ?? null);
    const onChain = (id: unknown) => setChainId(parseInt(id as string, 16));

    // Re-run discovery whenever a wallet announces itself, so a LATE injection is picked up
    // instead of missed forever. Announcements are idempotent; wallets re-announce on request.
    const onAnnounce = (e: Event) => {
      const detail = (e as CustomEvent<{ provider?: EIP1193Provider }>).detail;
      if (detail?.provider && !announced.includes(detail.provider)) {
        announced.push(detail.provider);
        void discover();
      }
    };

    const discover = async () => {
      setAvailable(candidateProviders().length > 0);
      const found = await authorizedProvider();
      const p = found?.provider ?? getProvider();
      if (!p) return;
      if (found) setAddress(found.address as Address);
      try {
        setChainId(parseInt((await p.request({ method: "eth_chainId" })) as string, 16));
      } catch {
        /* chain unreadable; the wallet still works for signing */
      }
      providerRef.current = p;
      if (bound !== p) {
        bound?.removeListener("accountsChanged", onAccounts);
        bound?.removeListener("chainChanged", onChain);
        p.on("accountsChanged", onAccounts);
        p.on("chainChanged", onChain);
        bound = p;
      }
    };

    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    void discover();
    // A wallet that neither announces nor is present yet still injects eventually; a few cheap
    // re-checks cover it without polling forever.
    const retries = [300, 1000, 2500].map((ms) => setTimeout(() => void discover(), ms));

    return () => {
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
      for (const t of retries) clearTimeout(t);
      bound?.removeListener("accountsChanged", onAccounts);
      bound?.removeListener("chainChanged", onChain);
    };
  }, []);

  const connect = useCallback(async () => {
    if (connectingRef.current) return; // ignore a re-entrant click while connecting
    const p = providerRef.current ?? getProvider();
    if (!p) {
      window.open("https://metamask.io/download/", "_blank", "noopener");
      return;
    }
    connectingRef.current = true;
    setConnecting(true);
    try {
      const accs = await p.request({ method: "eth_requestAccounts" });
      setAddress(((accs as string[])[0] as Address) ?? null);
      const id = await p.request({ method: "eth_chainId" });
      setChainId(parseInt(id as string, 16));
    } finally {
      connectingRef.current = false;
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setAddress(null);
  }, []);

  const switchToChain = useCallback(async (targetChainId: number) => {
    const p = getProvider();
    if (!p) return;
    const chain = viemChainFor(targetChainId);
    const hexId = `0x${targetChainId.toString(16)}`;
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
            chainName: chain.name,
            nativeCurrency: chain.nativeCurrency,
            rpcUrls: chain.rpcUrls.default.http,
            blockExplorerUrls: chain.blockExplorers
              ? [chain.blockExplorers.default.url]
              : [],
          },
        ],
      });
    }
  }, []);

  const switchToMetis = useCallback(
    () => switchToChain(metisSepolia.id),
    [switchToChain],
  );

  const getWalletClient = useCallback(
    (targetChainId?: number): WalletClient | null => {
      const p = providerRef.current ?? getProvider();
      if (!p || !address) return null;
      return createWalletClient({
        account: address,
        chain: targetChainId ? viemChainFor(targetChainId) : metisSepolia,
        transport: custom(p),
      });
    },
    [address],
  );

  return {
    address,
    chainId,
    connecting,
    available,
    onMetis: chainId === metisSepolia.id,
    onChain: (id: number) => chainId === id,
    connect,
    disconnect,
    switchToMetis,
    switchToChain,
    getWalletClient,
  };
}
