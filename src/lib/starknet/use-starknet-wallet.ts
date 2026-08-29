"use client";

import { useCallback, useEffect, useState } from "react";
import { createStore } from "@starknet-io/get-starknet-discovery";

/**
 * FINDING AND CONNECTING A STARKNET WALLET.
 *
 * Shared because two surfaces need it — a worker collecting a payout privately, and a founder
 * deploying and funding a vault — and because getting the discovery wrong is invisible: the button
 * simply never appears, which reads as "this feature does not exist" rather than "we failed to
 * look". That is exactly what happened when this logic lived inline and scanned only
 * `window.starknet_*`, which current wallets no longer write.
 *
 * TWO MECHANISMS, BOTH NEEDED. Modern wallets announce themselves through the wallet-standard
 * registry; older ones only inject a global. Deduplicated by NAME rather than object identity,
 * because one installed extension arrives through both routes as two different objects — which
 * rendered three buttons for a single wallet.
 */

const STARKNET_WALLET_API = "starknet:walletApi";

export interface StarknetWallet {
  id: string;
  name: string;
  icon?: string;
  request: (call: { type: string; params?: unknown }) => Promise<unknown>;
}

export function discoverStarknetWallets(): StarknetWallet[] {
  if (typeof window === "undefined") return [];
  const out: StarknetWallet[] = [];
  const seen = new Set<string>();
  const add = (w: StarknetWallet) => {
    const key = (w.name || w.id || "").toLowerCase().trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(w);
  };

  try {
    for (const w of createStore().getWallets()) {
      const feature = (w.features as Record<string, unknown> | undefined)?.[STARKNET_WALLET_API] as
        | { request?: StarknetWallet["request"] }
        | undefined;
      if (typeof feature?.request === "function") {
        add({ id: w.name, name: w.name, icon: w.icon, request: feature.request });
      }
    }
  } catch {
    /* no registry in this browser */
  }

  for (const key of Object.keys(window)) {
    if (!key.toLowerCase().startsWith("starknet")) continue;
    const w = (window as unknown as Record<string, unknown>)[key] as
      | (StarknetWallet & { name?: string })
      | undefined;
    if (w && typeof w.request === "function") {
      add({ id: key, name: w.name ?? key, icon: w.icon, request: w.request });
    }
  }
  return out;
}

export interface StarknetWalletApi {
  wallets: StarknetWallet[];
  /** The wallet the founder connected, and the address it returned. */
  connected: { wallet: StarknetWallet; address: string } | null;
  connecting: boolean;
  error: string | null;
  connect: (wallet: StarknetWallet) => Promise<string | null>;
  disconnect: () => void;
}

export function useStarknetWallet(): StarknetWalletApi {
  const [wallets, setWallets] = useState<StarknetWallet[]>([]);
  const [connected, setConnected] = useState<StarknetWalletApi["connected"]>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Subscribe rather than snapshot: an extension that finishes loading after hydration would
    // otherwise never appear, and the page would claim no wallet is installed.
    setWallets(discoverStarknetWallets());
    let stop: (() => void) | undefined;
    try {
      stop = createStore().subscribe(() => setWallets(discoverStarknetWallets()));
    } catch {
      /* no registry */
    }
    const t = setTimeout(() => setWallets(discoverStarknetWallets()), 800);
    return () => {
      clearTimeout(t);
      stop?.();
    };
  }, []);

  const connect = useCallback(async (wallet: StarknetWallet) => {
    setError(null);
    setConnecting(true);
    try {
      const accounts = (await wallet.request({ type: "wallet_requestAccounts" })) as string[];
      const address = accounts?.[0];
      if (!address) throw new Error("that wallet returned no account");
      setConnected({ wallet, address });
      return address;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(/rejected|denied/i.test(msg) ? "You cancelled the connection." : msg);
      return null;
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => setConnected(null), []);

  return { wallets, connected, connecting, error, connect, disconnect };
}
