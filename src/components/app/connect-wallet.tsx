"use client";

import { Wallet as WalletIcon } from "lucide-react";
import { short } from "@/lib/format";
import { useWallet } from "@/lib/wallet/use-wallet";
import { useFounderSession } from "@/lib/auth/use-founder-session";
import { chainConfig, DEFAULT_CHAIN_ID } from "@/lib/deputy/networks";

/**
 * Connect-wallet control. Reflects the four real states: no wallet installed,
 * disconnected, connected-but-wrong-network, and connected-on-the-target-chain.
 * The founder connects here to own their vault (create / fund / activate / revoke).
 *
 * Chain-aware: pass the campaign's `chainId` so the wrong-network prompt names the
 * chain the founder actually needs (e.g. "switch to GOAT Mainnet"), never a hardcoded
 * "Metis". Defaults to the platform default chain when no campaign context exists.
 *
 * A FOUNDER SIGNED IN ON STARKNET IS ALREADY CONNECTED, and this must say so. Every state below
 * is about the EVM wallet, because that is what the EVM deploy flow needs — but read by someone
 * holding only Ready, "Connect wallet" is simply wrong: they are signed in, and the button offers
 * them a chain they do not use. It showed the one door they cannot walk through.
 */
export function ConnectWallet({
  className = "",
  chainId = DEFAULT_CHAIN_ID,
}: {
  className?: string;
  chainId?: number;
}) {
  const { address, connect, connecting, available, onChain, switchToChain } =
    useWallet();
  const founder = useFounderSession();

  // Signed in on Starknet with no EVM wallet attached: show who they are, and do not offer a
  // network they have no reason to join. The EVM prompts below still apply the moment an EVM
  // wallet IS connected, because the deploy flow needs the cookie and the wallet to agree.
  if (!address && founder.chain === "starknet" && founder.address) {
    return (
      <span className={`sage-connect on ${className}`}>
        <span className="dot" />
        {short(founder.address)}
      </span>
    );
  }

  if (address && !onChain(chainId)) {
    return (
      <button
        className={`sage-connect warn ${className}`}
        onClick={() => void switchToChain(chainId)}
      >
        Wrong network · switch to {chainConfig(chainId).chipLabel}
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
