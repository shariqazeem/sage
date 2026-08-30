"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, ExternalLink, Loader2 } from "lucide-react";

import { useStarknetWallet } from "@/lib/starknet/use-starknet-wallet";
import { WalletConnect } from "@/components/wallet/wallet-connect";
import { sameFelt } from "@/lib/starknet/felt";

/**
 * STOPPING A STARKNET CAMPAIGN AND TAKING THE REMAINDER BACK.
 *
 * The EVM card is viem all the way down — it calls `getAddress` on the vault, which throws on a
 * felt, so the balance read never resolved and the card sat on "reading vault balance…" while
 * telling a founder to connect a wallet they already had. Their own money, unreachable through the
 * only control offered for it.
 *
 * Two calls in one signature: `revoke` first so nothing can be paid after the founder decides to
 * stop, then `withdraw_remaining`, which the contract sends only to the owner. Both are
 * owner-gated on chain, so this component is a convenience, never the guarantee.
 */

const STATUS_LABEL: Record<number, string> = { 0: "paused", 1: "active", 2: "revoked" };

export function StarknetStopWithdrawCard({
  campaignId,
  vaultAddress,
  explorerUrl,
}: {
  campaignId: string;
  vaultAddress: string;
  explorerUrl?: string;
}) {
  const wallet = useStarknetWallet();
  const [confirming, setConfirming] = useState(false);
  const [state, setState] = useState<{ balance: string; status: string; owner: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  // Read through Sage's server rather than a browser RPC: one place holds the node URL, and a
  // failed read here must say so instead of spinning forever.
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch(`/api/starknet/vault?address=${encodeURIComponent(vaultAddress)}`, {
          cache: "no-store",
        });
        const d = (await res.json()) as {
          ok?: boolean;
          balanceUsd?: string;
          status?: number;
          owner?: string;
          error?: string;
        };
        if (!alive) return;
        if (!d.ok) {
          setError(d.error ?? "Could not read this vault from Starknet.");
          return;
        }
        setState({
          balance: d.balanceUsd ?? "0.00",
          status: STATUS_LABEL[d.status ?? -1] ?? "unknown",
          owner: d.owner ?? "",
        });
      } catch {
        if (alive) setError("Could not reach Sage to read the vault.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [vaultAddress]);

  const stopAndWithdraw = useCallback(
    async (w: { request: (c: { type: string; params?: unknown }) => Promise<unknown> }) => {
      setBusy(true);
      setError(null);
      try {
        const r = (await w.request({
          type: "wallet_addInvokeTransaction",
          params: {
            calls: [
              { contract_address: vaultAddress, entry_point: "revoke", calldata: [] },
              { contract_address: vaultAddress, entry_point: "withdraw_remaining", calldata: [] },
            ],
          },
        })) as { transaction_hash?: string };
        setTxHash(r?.transaction_hash ?? null);
        // The chain is the truth, but the DB is what the board and the sweep read. Without this a
        // stopped campaign still reads "live" and keeps taking submissions it will never pay.
        void fetch(`/api/campaigns/${campaignId}/stop`, { method: "POST" }).catch(() => {});
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(/reject|denied|cancel/i.test(msg) ? "You cancelled the signature." : msg);
      } finally {
        setBusy(false);
      }
    },
    [vaultAddress, campaignId],
  );

  const ownerMismatch =
    !!wallet.connected && !!state?.owner && !sameFelt(wallet.connected.address, state.owner);

  return (
    <div
      className="sage-agent-card"
      style={{ marginTop: 18, borderColor: "rgba(180,83,9,0.28)", background: "rgba(180,83,9,0.04)" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600, fontSize: 14, color: "#b45309" }}>
        <AlertTriangle size={15} strokeWidth={2} />
        Stop campaign &amp; withdraw
      </div>
      <p style={{ margin: "8px 0 0", fontSize: 13.5, lineHeight: 1.5, color: "var(--ink-muted, #4a473f)" }}>
        Permanently end this campaign and return the remaining USDC to your wallet. This can&apos;t be
        undone, and any not-yet-approved submissions won&apos;t be paid.
      </p>

      <div className="mono" style={{ marginTop: 12, fontSize: 13 }}>
        {state ? (
          <>
            <b style={{ fontSize: 15 }}>{state.balance} USDC</b> withdrawable
            {state.status === "revoked" ? " · campaign already stopped" : ""}
          </>
        ) : error ? (
          <span style={{ color: "#b45309" }}>{error}</span>
        ) : (
          <span style={{ color: "var(--ink-faint, #8a8578)" }}>reading vault balance…</span>
        )}
      </div>

      {ownerMismatch && (
        <div className="mono" style={{ marginTop: 8, fontSize: 12, color: "#b45309" }}>
          Connect the owner wallet {state?.owner.slice(0, 6)}…{state?.owner.slice(-4)} to withdraw.
        </div>
      )}

      {txHash ? (
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 14, fontSize: 13.5, color: "#15803d", fontWeight: 500 }}>
          <Check size={15} strokeWidth={2.6} /> Withdrawn to your wallet.
          {explorerUrl && (
            <a
              href={`${explorerUrl}/tx/${txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="cw-link mono"
              style={{ marginLeft: 4 }}
            >
              view tx <ExternalLink size={12} />
            </a>
          )}
        </div>
      ) : !confirming ? (
        <button
          className="cw-btn-danger"
          onClick={() => setConfirming(true)}
          disabled={!state}
          style={{ ...dangerBtn, marginTop: 14 }}
        >
          Stop &amp; withdraw{state && state.balance !== "0.00" ? ` ${state.balance} USDC` : ""}
        </button>
      ) : wallet.connected ? (
        <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
          <button
            className="cw-btn-danger"
            onClick={() => void stopAndWithdraw(wallet.connected!.wallet)}
            disabled={busy || ownerMismatch}
            style={dangerBtn}
          >
            {busy ? <Loader2 size={14} className="spin" /> : <AlertTriangle size={14} />}
            {busy ? "Waiting for your wallet…" : "Yes — stop & withdraw"}
          </button>
          <button onClick={() => setConfirming(false)} disabled={busy} style={ghostBtn}>
            Cancel
          </button>
        </div>
      ) : (
        <div style={{ marginTop: 14 }}>
          <WalletConnect
            options={wallet.wallets.map((w) => ({
              id: w.id,
              name: w.name,
              icon: w.icon,
              onSelect: () => void wallet.connect(w),
            }))}
            explainer={<>Connect the wallet that <b>owns this vault</b> to sign the withdrawal.</>}
            busy={wallet.connecting}
            busyLabel="Waiting for your wallet…"
            error={wallet.error}
            emptyMessage="No Starknet wallet found in this browser."
            installHints={[{ name: "Ready", url: "https://www.ready.co" }]}
          />
        </div>
      )}

      {error && state && (
        <div className="mono" style={{ marginTop: 10, fontSize: 12.5, color: "#b45309" }}>
          {error}
        </div>
      )}
      <div className="mono" style={{ marginTop: 10, fontSize: 11, color: "var(--ink-faint, #8a8578)" }}>
        Signed by your wallet on Starknet. Funds return only to the vault owner — enforced on-chain.
      </div>
    </div>
  );
}

/** Identical to the EVM card's, so the two controls cannot drift apart visually. */
const dangerBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  padding: "10px 16px",
  borderRadius: 10,
  border: "1px solid rgba(180,83,9,0.4)",
  background: "#b45309",
  color: "#fff",
  fontWeight: 600,
  fontSize: 13.5,
  cursor: "pointer",
};
const ghostBtn: React.CSSProperties = {
  padding: "10px 16px",
  borderRadius: 10,
  border: "1px solid var(--border, rgba(23,23,21,0.14))",
  background: "transparent",
  color: "var(--ink, #1a1d21)",
  fontWeight: 500,
  fontSize: 13.5,
  cursor: "pointer",
};
