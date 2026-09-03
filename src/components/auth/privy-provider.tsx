"use client";

import { PrivyProvider } from "@privy-io/react-auth";

/**
 * Wraps the app in Privy ONLY when a login app is configured; otherwise it renders children and the
 * email door simply does not appear. The accent, logo and light theme are Sage's own.
 */
export function SagePrivyProvider({ appId, children }: { appId: string | null; children: React.ReactNode }) {
  if (!appId) return <>{children}</>;
  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ["email", "google", "wallet"],
        appearance: { theme: "light", accentColor: "#c2410c", logo: "https://sagepays.xyz/icon.png", walletChainType: "ethereum-only" },
        embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
