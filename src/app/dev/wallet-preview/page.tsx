"use client";

import { notFound } from "next/navigation";

import { WalletConnect } from "@/components/wallet/wallet-connect";
import "@/styles/wallet-connect.css";

/**
 * Every state of the wallet-connect surface on one page, for reviewing it as a design rather than
 * as code. Development only — a preview route on a production payments site is a page that looks
 * like a real wallet prompt and is not one.
 */
export default function WalletPreview() {
  if (process.env.NODE_ENV === "production") notFound();

  const icon = (bg: string, ch: string) =>
    `data:image/svg+xml,${encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="9" fill="${bg}"/><text x="20" y="27" font-size="20" fill="#fff" text-anchor="middle" font-family="sans-serif">${ch}</text></svg>`,
    )}`;

  const two = [
    { id: "ready", name: "Ready", icon: icon("#1a1d21", "R"), onSelect: () => {} },
    { id: "braavos", name: "Braavos", icon: icon("#c2410c", "B"), onSelect: () => {} },
  ];

  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: "48px 24px 96px" }}>
      <h1 style={{ fontSize: 22, fontWeight: 640, marginBottom: 6 }}>Connecting a wallet</h1>
      <p style={{ fontSize: 14, color: "var(--ink-muted)", marginBottom: 36 }}>
        Both rails render through one component, so the moment feels the same whichever chain pays.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 28 }}>
        <Case title="Two wallets — a choice, not two calls to action">
          <WalletConnect
            options={two}
            explainer={
              <>
                This campaign pays on Starknet, so sign in with a Starknet wallet — <b>that is the
                address you&rsquo;ll be paid at.</b>
              </>
            }
          />
        </Case>

        <Case title="One wallet — one action, so it keeps primary weight">
          <WalletConnect
            options={[two[0]]}
            explainer={
              <>
                Connect the wallet that will <b>own this vault</b> and fund it. Sage never holds it.
              </>
            }
          />
        </Case>

        <Case title="No wallet — same shape, so the layout does not jump">
          <WalletConnect
            options={[]}
            explainer={<>This campaign pays on Starknet, so sign in with a Starknet wallet.</>}
            emptyMessage="No Starknet wallet found in this browser."
            installHints={[
              { name: "Ready", url: "https://www.ready.co" },
              { name: "Braavos", url: "https://braavos.app" },
            ]}
          />
        </Case>

        <Case title="Waiting on the wallet">
          <WalletConnect options={two} explainer={<>Confirm in your wallet to continue.</>} busy busyLabel="Waiting for your wallet…" />
        </Case>

        <Case title="Refused">
          <WalletConnect
            options={two}
            explainer={<>This campaign pays on Starknet.</>}
            error="You cancelled the signature."
          />
        </Case>

        <Case title="EVM rail — the same language, one injected provider">
          <WalletConnect
            options={[{ id: "injected", name: "your wallet", onSelect: () => {} }]}
            explainer={
              <>
                Connect your wallet and sign a message to submit — <b>that is the address
                you&rsquo;ll be paid at.</b>
              </>
            }
          />
        </Case>
      </div>
    </main>
  );
}

function Case({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <div
        style={{
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          color: "var(--ink-faint)",
          marginBottom: 12,
        }}
      >
        {title}
      </div>
      <div style={{ border: "1px solid var(--border)", borderRadius: 16, padding: 22, background: "var(--surface)" }}>
        {children}
      </div>
    </section>
  );
}
