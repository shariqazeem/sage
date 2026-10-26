"use client";

import { PrivyProvider, usePrivy } from "@privy-io/react-auth";
import { useEffect } from "react";
import { SIGNED_OUT_EVENT } from "@/lib/auth/use-founder-session";
import { DEFAULT_EVM_LAUNCH_CHAIN, viemChainFor } from "@/lib/deputy/networks";

/**
 * Wraps the app in Privy ONLY when a login app is configured; otherwise it renders children and the
 * email door simply does not appear. The accent, logo and light theme are Sage's own.
 */
/**
 * ENDS PRIVY'S SESSION WHEN SAGE'S ENDS. Sage's sign-out cleared its own cookies and nothing else,
 * so Privy stayed authenticated in the browser: the next "Continue with email" reused that session
 * and signed the SAME person straight back in, with no email and no code. Nobody could leave, and
 * nobody could switch accounts. This listens for the sign-out Sage broadcasts and logs Privy out
 * too. It lives here because Privy's hooks throw outside the provider.
 */
function EndPrivySessionOnSignOut() {
  const { ready, authenticated, logout } = usePrivy();
  useEffect(() => {
    const onSignedOut = () => {
      if (ready && authenticated) void logout().catch(() => undefined);
    };
    window.addEventListener(SIGNED_OUT_EVENT, onSignedOut);
    return () => window.removeEventListener(SIGNED_OUT_EVENT, onSignedOut);
  }, [ready, authenticated, logout]);
  return null;
}

export function SagePrivyProvider({ appId, children }: { appId: string | null; children: React.ReactNode }) {
  if (!appId) return <>{children}</>;
  return (
    <PrivyProvider
      appId={appId}
      config={{
        // The email door is email (or Google), nothing else. A wallet signs in through the MetaMask door
        // (one signature, SIWE), so a wallet never has two ways in that could disagree (26 Oct 2026).
        loginMethods: ["email", "google"],
        appearance: { theme: "light", accentColor: "#c2410c", logo: "https://sagepays.xyz/icon.png", walletChainType: "ethereum-only" },
        embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } },
        // One network: the embedded wallet knows Metis, the network everything runs on. It signs no
        // transaction (jobs launch from the account Sage keeps on Metis), so nothing else is needed.
        defaultChain: viemChainFor(DEFAULT_EVM_LAUNCH_CHAIN),
        supportedChains: [viemChainFor(DEFAULT_EVM_LAUNCH_CHAIN)],
      }}
    >
      <EndPrivySessionOnSignOut />
      {children}
    </PrivyProvider>
  );
}
