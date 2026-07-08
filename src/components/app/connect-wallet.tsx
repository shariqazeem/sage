"use client";

import { Wallet as WalletIcon } from "lucide-react";
import { short } from "@/lib/format";
import { useWallet } from "@/lib/wallet/use-wallet";

/**
 * Connect-wallet control. Reflects the four real states: no wallet installed,
 * disconnected, connected-but-wrong-network, and connected-on-Metis. The founder
 * connects here to own their vault (create / fund / activate / revoke).
 */
export function ConnectWallet({ className = "" }: { className?: string }) {
  const { address, connect, connecting, available, onMetis, switchToMetis } =
    useWallet();

  if (address && !onMetis) {
    return (
      <button
        className={`sage-connect warn ${className}`}
        onClick={switchToMetis}
      >
        Wrong network · switch to Metis
      </button>
    );
  }
  if (address) {
    return (
      <span className={`sage-connect on ${className}`}>
        <span className="dot" />
        {short(address)}
      </span>
    );
  }
  return (
    <button
      className={`sage-connect ${className}`}
      onClick={connect}
      disabled={connecting}
    >
      <WalletIcon size={14} />
      {connecting ? "Connecting…" : available ? "Connect wallet" : "Install a wallet"}
    </button>
  );
}
