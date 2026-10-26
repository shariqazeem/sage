"use client";

import { useEffect, useState } from "react";

import { EmailSignIn } from "@/components/auth/email-sign-in";
import { useSiwe } from "@/lib/auth/use-siwe";
import { short } from "@/lib/format";
import { WalletConnect, type WalletOption } from "./wallet-connect";

/** Whether the email door exists on this deployment (its Privy app id is public, and inlined at build). */
const EMAIL_DOOR = !!process.env.NEXT_PUBLIC_PRIVY_LOGIN_APP_ID?.trim();

/**
 * SIGNING IN: an email, or MetaMask (any Ethereum wallet). Both doors, at every sign-in moment.
 *
 * Two doors lead into Sage, and they lead to the same place: an email (Privy), or an Ethereum wallet's
 * one free signature (SIWE). Either way the founder is an Ethereum address, their account opens on
 * Metis, and everything after it (launching, the account, plans) is the same screen (26 Oct 2026, the
 * founder's rule: "if we connect with email or MetaMask, things should be the same on both"). So the
 * email door is offered here too, above the wallet, wherever a page asks someone to sign in; it used to
 * appear only on /start, and every other prompt offered a wallet alone. `email={false}` is for a page
 * that draws its own email door (the first run). Linking a second wallet (`bind`) is wallets only.
 *
 * Starknet wallets were offered here too until Starknet was closed on 26 Oct 2026 (networks.ts
 * CLOSED_NETWORKS). They are not a second list behind "more options": a sign-in that cannot hold an
 * account on Metis is a door into a different product.
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
  intent = "signin",
  email = true,
}: {
  explainer?: React.ReactNode;
  onSignedIn?: () => void;
  /** `bind`: the proven wallet joins the account already signed in; the session is not replaced. */
  intent?: "signin" | "bind";
  /** Offer the email door above the wallet (default). False on a page that draws its own. */
  email?: boolean;
}) {
  const evm = useSiwe();

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

  // A sign-in was refused because another account is signed in here. Switching is now offered by
  // name, and only a second, explicit choice replaces that session.
  const switching = intent === "signin" && !!evm.conflict && !!evm.address;
  if (mounted && (evm.address || evmName)) {
    options.push({
      id: "evm",
      name:
        switching && evm.address
          ? `Switch to ${short(evm.address)}`
          : (evmName ?? "your Ethereum wallet"),
      onSelect: async () => {
        const ok = evm.address
          ? await evm.signIn({ mode: intent, replace: switching })
          : (await evm.connect(), false);
        if (ok) onSignedIn?.();
      },
    });
  }

  const emailDoor = EMAIL_DOOR && email && intent === "signin";
  return (
    <>
      {emailDoor && (
        <>
          <EmailSignIn onSignedIn={() => onSignedIn?.()} />
          <div className="es-or">
            <span>or use MetaMask</span>
          </div>
        </>
      )}
      <WalletConnect
        options={options}
        explainer={
          explainer ?? (
            <>
              Sign in with <b>MetaMask</b> or any Ethereum wallet. It is one
              free signature: no transaction, and nothing moves.
            </>
          )
        }
        busy={evm.signingIn}
        busyLabel="Waiting for your wallet…"
        error={
          switching && evm.conflict
            ? `You're signed in as ${short(evm.conflict)}. Choose the wallet again to switch accounts.`
            : null
        }
        emptyMessage="No wallet found in this browser."
        installHints={[
          { name: "MetaMask", url: "https://metamask.io/download" },
        ]}
      />
    </>
  );
}
