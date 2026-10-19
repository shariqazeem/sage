"use client";

import { PrivyProvider, usePrivy } from "@privy-io/react-auth";
import { useEffect } from "react";
import { SIGNED_OUT_EVENT } from "@/lib/auth/use-founder-session";
import { chainConfig, DEFAULT_EVM_LAUNCH_CHAIN, PRIMARY_NETWORKS, SECONDARY_NETWORKS, viemChainFor } from "@/lib/deputy/networks";

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
        loginMethods: ["email", "google", "wallet"],
        appearance: { theme: "light", accentColor: "#c2410c", logo: "https://sagepays.xyz/icon.png", walletChainType: "ethereum-only" },
        embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } },
        // the networks the embedded wallet signs for: every EVM network Sage settles on, primary first
        // (GOAT, Metis), then secondary (Arc). A payout's chain is never a stranger to it. No testnets.
        defaultChain: viemChainFor(DEFAULT_EVM_LAUNCH_CHAIN),
        supportedChains: [...PRIMARY_NETWORKS, ...SECONDARY_NETWORKS].filter((id) => chainConfig(id).evm && chainConfig(id).chainId === id).map((id) => viemChainFor(id)),
      }}
    >
      <EndPrivySessionOnSignOut />
      {children}
    </PrivyProvider>
  );
}
