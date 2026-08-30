"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";

import { useStarknetWallet } from "@/lib/starknet/use-starknet-wallet";
import { useFounderSession } from "@/lib/auth/use-founder-session";
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
  vaultAddress,
  explorerUrl,
}: {
  vaultAddress: string;
  explorerUrl?: string;
}) {
  const wallet = useStarknetWallet();
  const founder = useFounderSession();
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
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(/reject|denied|cancel/i.test(msg) ? "You cancelled the signature." : msg);
      } finally {
        setBusy(false);
      }
    },
    [vaultAddress],
  );

  if (txHash) {
    return (
      <div className="cw-danger">
        <div className="cw-danger-h">Campaign stopped</div>
        <p>The remaining USDC has been returned to your wallet.</p>
        {explorerUrl && (
          <a href={`${explorerUrl}/tx/${txHash}`} target="_blank" rel="noreferrer noopener">
            View the transaction
          </a>
        )}
      </div>
    );
  }

  return (
    <div className="cw-danger">
      <div className="cw-danger-h">
        <AlertTriangle size={15} aria-hidden /> Stop campaign &amp; withdraw
      </div>
      <p>
        Permanently end this campaign and return the remaining USDC to your wallet. This can&apos;t
        be undone, and any not-yet-approved submissions won&apos;t be paid.
      </p>

      {state ? (
        <p className="mono cw-danger-bal">
          ${state.balance} USDC in the vault · {state.status}
        </p>
      ) : error ? (
        <div className="cw-err" role="alert">
          {error}
        </div>
      ) : (
        <p className="mono cw-danger-bal">reading vault balance…</p>
      )}

      {!confirming ? (
        <button className="cw-danger-btn" onClick={() => setConfirming(true)} disabled={!state}>
          Stop &amp; withdraw
        </button>
      ) : wallet.connected ? (
        sameFelt(wallet.connected.address, state?.owner) ? (
          <>
            <button
              className="cw-danger-btn"
              disabled={busy}
              onClick={() => void stopAndWithdraw(wallet.connected!.wallet)}
            >
              {busy ? "Waiting for your wallet…" : "Yes — stop & withdraw"}
            </button>
            <button className="cw-cancel" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </>
        ) : (
          <div className="cw-err" role="alert">
            That wallet does not own this vault. The contract returns funds only to the owner, so
            signing with another account cannot work — switch accounts and try again.
          </div>
        )
      ) : (
        <WalletConnect
          options={wallet.wallets.map((w) => ({
            id: w.id,
            name: w.name,
            icon: w.icon,
            onSelect: () => void wallet.connect(w),
          }))}
          explainer={
            <>
              Connect the wallet that <b>owns this vault</b> to sign the withdrawal.
              {founder.chain === "starknet" && founder.address ? (
                <> You signed in as {founder.address.slice(0, 10)}…</>
              ) : null}
            </>
          }
          busy={wallet.connecting}
          busyLabel="Waiting for your wallet…"
          error={wallet.error}
          emptyMessage="No Starknet wallet found in this browser."
          installHints={[{ name: "Ready", url: "https://www.ready.co" }]}
        />
      )}

      <p className="cw-danger-note">
        Signed by your wallet on Starknet. Funds return only to the vault owner — enforced on-chain.
      </p>
    </div>
  );
}
