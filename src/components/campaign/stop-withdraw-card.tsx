"use client";

import { useCallback, useEffect, useState } from "react";
import { createPublicClient, http, getAddress, erc20Abi, formatUnits, type Abi } from "viem";
import { AlertTriangle, Loader2, Check, ExternalLink } from "lucide-react";
import { useWallet } from "@/lib/wallet/use-wallet";
import { viemChainFor, chainConfig } from "@/lib/deputy/networks";

/**
 * Owner-only "Stop campaign & withdraw" control. The founder's OWN browser wallet signs
 * `revoke()` then `withdrawRemaining()` on their CampaignVault — the contract's onlyOwner +
 * "funds go only to i_owner" are the real guarantees, so nobody can drain a vault they don't
 * own and money can only ever return to the owner. Client-safe minimal ABI (the server
 * `campaign-vault.ts` export is server-only). Reads the TRUE withdrawable amount on-chain
 * (`balanceOf(vault)`), not the DB approximation.
 */

const VAULT_ABI = [
  { type: "function", name: "revoke", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "withdrawRemaining", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "getState", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "getOwner", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "getToken", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const satisfies Abi;

const STATE_REVOKED = 4;

export function StopWithdrawCard({
  campaignId,
  vaultAddress,
  chainId,
  explorerUrl,
  viaAccount = false,
}: {
  campaignId: string;
  vaultAddress: string;
  chainId: number;
  explorerUrl?: string;
  /** the founder's account owns the vault: Sage stops it through the account, no browser wallet involved */
  viaAccount?: boolean;
}) {
  if (viaAccount) return <StopViaAccountCard campaignId={campaignId} chainId={chainId} explorerUrl={explorerUrl} />;
  return <StopWithWalletCard campaignId={campaignId} vaultAddress={vaultAddress} chainId={chainId} explorerUrl={explorerUrl} />;
}

/**
 * The vault belongs to the account Sage holds for the founder, so the stop is signed there: a scoped
 * stop policy, revoke, withdrawRemaining back to the account, re-lock. One confirmation, no wallet.
 */
function StopViaAccountCard({ campaignId, chainId, explorerUrl }: { campaignId: string; chainId: number; explorerUrl?: string }) {
  const cfg = chainConfig(chainId);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ withdrawTx: string | null; revokeTx: string | null; recoveredBase: string; alreadyRevoked: boolean } | null>(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/campaigns/${campaignId}/stop`, { method: "POST" });
      const j = (await r.json()) as { ok?: boolean; error?: string; viaAccount?: { withdrawTx: string | null; revokeTx: string | null; recoveredBase: string; alreadyRevoked: boolean } | null };
      if (!r.ok || !j.ok) { setError(j.error ?? "Could not stop the campaign."); return; }
      setDone(j.viaAccount ?? { withdrawTx: null, revokeTx: null, recoveredBase: "0", alreadyRevoked: false });
      setConfirming(false);
    } catch {
      setError("Could not reach Sage.");
    } finally {
      setBusy(false);
    }
  };
  const recovered = done ? (Number(done.recoveredBase) / 1e6).toFixed(2) : null;
  const tx = done?.withdrawTx ?? done?.revokeTx ?? null;
  return (
    <div className="sage-agent-card" style={{ marginTop: 18, borderColor: "rgba(180,83,9,0.28)", background: "rgba(180,83,9,0.04)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600, fontSize: 14, color: "#b45309" }}>
        <AlertTriangle size={15} strokeWidth={2} />
        Stop campaign &amp; return the rest to your account
      </div>
      <p style={{ margin: "8px 0 0", fontSize: 13.5, lineHeight: 1.5, color: "var(--ink-muted, #4a473f)" }}>
        Your account launched this campaign, so it owns the vault. Sage stops the vault through the account and the remaining USDC returns to the account. This can&apos;t be undone, and any not-yet-approved submissions won&apos;t be paid.
      </p>
      {done ? (
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 14, fontSize: 13.5, color: "#15803d", fontWeight: 500, flexWrap: "wrap" }}>
          <Check size={15} strokeWidth={2.6} /> Stopped.{recovered && recovered !== "0.00" ? ` ${recovered} USDC returned to your account.` : " Nothing was left in the vault."}
          {tx && explorerUrl && (
            <a href={`${explorerUrl}/tx/${tx}`} target="_blank" rel="noopener noreferrer" className="cw-link mono" style={{ marginLeft: 4 }}>
              view tx <ExternalLink size={12} />
            </a>
          )}
        </div>
      ) : confirming ? (
        <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
          <button className="cw-btn-danger" onClick={() => void run()} disabled={busy} style={dangerBtn}>
            {busy ? <Loader2 size={14} className="spin" /> : <AlertTriangle size={14} />}
            {busy ? "Stopping through your account…" : "Yes — stop it"}
          </button>
          <button onClick={() => { setConfirming(false); setError(null); }} disabled={busy} style={ghostBtn}>Cancel</button>
        </div>
      ) : (
        <button className="cw-btn-danger" onClick={() => setConfirming(true)} style={{ ...dangerBtn, marginTop: 14 }}>Stop &amp; return the rest</button>
      )}
      {error && <div className="mono" style={{ marginTop: 10, fontSize: 12.5, color: "#b45309" }}>{error}</div>}
      <div className="mono" style={{ marginTop: 10, fontSize: 11, color: "var(--ink-faint, #8a8578)" }}>
        Signed by your account on {cfg.name} under a one-time stop permit, then re-locked to the mandate.
      </div>
    </div>
  );
}

function StopWithWalletCard({
  campaignId,
  vaultAddress,
  chainId,
  explorerUrl,
}: {
  campaignId: string;
  vaultAddress: string;
  chainId: number;
  explorerUrl?: string;
}) {
  const wallet = useWallet();
  const cfg = chainConfig(chainId);
  const [remaining, setRemaining] = useState<string | null>(null);
  const [owner, setOwner] = useState<string | null>(null);
  const [state, setState] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<null | "revoke" | "withdraw">(null);
  const [error, setError] = useState<string | null>(null);
  const [doneTx, setDoneTx] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const pub = createPublicClient({ chain: viemChainFor(chainId), transport: http() });
      const vault = getAddress(vaultAddress);
      const [st, own, token] = await Promise.all([
        pub.readContract({ address: vault, abi: VAULT_ABI, functionName: "getState" }),
        pub.readContract({ address: vault, abi: VAULT_ABI, functionName: "getOwner" }),
        pub.readContract({ address: vault, abi: VAULT_ABI, functionName: "getToken" }),
      ]);
      const bal = (await pub.readContract({ address: token as `0x${string}`, abi: erc20Abi, functionName: "balanceOf", args: [vault] })) as bigint;
      setState(Number(st));
      setOwner((own as string).toLowerCase());
      setRemaining(formatUnits(bal, 6));
    } catch {
      /* transient RPC — the action re-reads fresh on click */
    }
  }, [vaultAddress, chainId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const connected = wallet.address?.toLowerCase() ?? null;
  const ownerMismatch = !!owner && !!connected && owner !== connected;

  const run = useCallback(async () => {
    setError(null);
    setDoneTx(null);
    if (!wallet.address) {
      setError("Connect your wallet to withdraw.");
      return;
    }
    try {
      if (!wallet.onChain(chainId)) await wallet.switchToChain(chainId);
      const wc = wallet.getWalletClient(chainId);
      if (!wc) {
        setError("Wallet not available on this network.");
        return;
      }
      const acct = getAddress(wallet.address);
      const chain = viemChainFor(chainId);
      const vault = getAddress(vaultAddress);
      const pub = createPublicClient({ chain, transport: http() });

      // 1) revoke (terminal) — skip if already revoked (revoke is idempotent, but we save a tx).
      const st = Number(await pub.readContract({ address: vault, abi: VAULT_ABI, functionName: "getState" }));
      if (st !== STATE_REVOKED) {
        setBusy("revoke");
        const tx = await wc.writeContract({ address: vault, abi: VAULT_ABI, functionName: "revoke", args: [], account: acct, chain });
        await pub.waitForTransactionReceipt({ hash: tx });
      }
      // the vault is now stopped on-chain — catalogue it as cancelled (owner-gated server-side).
      void fetch(`/api/campaigns/${campaignId}/stop`, { method: "POST" }).catch(() => {});

      // 2) withdrawRemaining → returns the whole balance to the owner (the connected founder wallet).
      const token = (await pub.readContract({ address: vault, abi: VAULT_ABI, functionName: "getToken" })) as `0x${string}`;
      const bal = (await pub.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [vault] })) as bigint;
      if (bal === BigInt(0)) {
        setBusy(null);
        setConfirming(false);
        await refresh();
        setError("Campaign stopped. There was no USDC left in the vault to withdraw.");
        return;
      }
      setBusy("withdraw");
      const wtx = await wc.writeContract({ address: vault, abi: VAULT_ABI, functionName: "withdrawRemaining", args: [], account: acct, chain });
      await pub.waitForTransactionReceipt({ hash: wtx });
      setDoneTx(wtx);
      setBusy(null);
      setConfirming(false);
      await refresh();
    } catch (e) {
      setBusy(null);
      const msg = String((e as { shortMessage?: string; message?: string })?.shortMessage ?? (e as Error)?.message ?? e);
      if (/user rejected|denied|rejected the request/i.test(msg)) setError("You declined the confirmation — nothing changed.");
      else if (/NotWithdrawable/i.test(msg)) setError("The vault isn't withdrawable yet (it must be stopped or past its duration).");
      else if (/NothingToWithdraw/i.test(msg)) setError("Nothing left to withdraw.");
      else if (/NotAuthorized|onlyOwner/i.test(msg)) setError("Only the vault owner can do this — connect the owner wallet.");
      else setError(`Couldn't complete it: ${msg.slice(0, 160)}`);
    }
  }, [wallet, chainId, vaultAddress, campaignId, refresh]);

  const busyLabel = busy === "revoke" ? "Stopping campaign…" : busy === "withdraw" ? "Returning your USDC…" : null;

  return (
    <div className="sage-agent-card" style={{ marginTop: 18, borderColor: "rgba(180,83,9,0.28)", background: "rgba(180,83,9,0.04)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600, fontSize: 14, color: "#b45309" }}>
        <AlertTriangle size={15} strokeWidth={2} />
        Stop campaign &amp; withdraw
      </div>
      <p style={{ margin: "8px 0 0", fontSize: 13.5, lineHeight: 1.5, color: "var(--ink-muted, #4a473f)" }}>
        Permanently end this campaign and return the remaining USDC to your wallet. This can&apos;t be
        undone, and any not-yet-approved submissions won&apos;t be paid.
      </p>

      <div className="mono" style={{ marginTop: 12, fontSize: 13 }}>
        {remaining != null ? (
          <>
            <b style={{ fontSize: 15 }}>{remaining} USDC</b> withdrawable
            {state === STATE_REVOKED ? " · campaign already stopped" : ""}
          </>
        ) : (
          <span style={{ color: "var(--ink-faint, #8a8578)" }}>reading vault balance…</span>
        )}
      </div>

      {ownerMismatch && (
        <div className="mono" style={{ marginTop: 8, fontSize: 12, color: "#b45309" }}>
          Connect the owner wallet {owner?.slice(0, 6)}…{owner?.slice(-4)} to withdraw.
        </div>
      )}

      {doneTx ? (
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 14, fontSize: 13.5, color: "#15803d", fontWeight: 500 }}>
          <Check size={15} strokeWidth={2.6} /> Withdrawn to your wallet.
          {explorerUrl && (
            <a href={`${explorerUrl}/tx/${doneTx}`} target="_blank" rel="noopener noreferrer" className="cw-link mono" style={{ marginLeft: 4 }}>
              view tx <ExternalLink size={12} />
            </a>
          )}
        </div>
      ) : confirming ? (
        <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
          <button className="cw-btn-danger" onClick={run} disabled={!!busy || ownerMismatch} style={dangerBtn}>
            {busy ? <Loader2 size={14} className="spin" /> : <AlertTriangle size={14} />}
            {busyLabel ?? "Yes — stop & withdraw"}
          </button>
          <button onClick={() => { setConfirming(false); setError(null); }} disabled={!!busy} style={ghostBtn}>
            Cancel
          </button>
        </div>
      ) : (
        <button className="cw-btn-danger" onClick={() => setConfirming(true)} disabled={ownerMismatch} style={{ ...dangerBtn, marginTop: 14 }}>
          Stop &amp; withdraw{remaining && remaining !== "0" ? ` ${remaining} USDC` : ""}
        </button>
      )}

      {error && (
        <div className="mono" style={{ marginTop: 10, fontSize: 12.5, color: "#b45309" }}>
          {error}
        </div>
      )}
      <div className="mono" style={{ marginTop: 10, fontSize: 11, color: "var(--ink-faint, #8a8578)" }}>
        Signed by your wallet on {cfg.name}. Funds return only to the vault owner — enforced on-chain.
      </div>
    </div>
  );
}

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
