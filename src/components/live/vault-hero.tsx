"use client";

import Link from "next/link";
import type { WorkspaceMission, WorkspaceSubmission } from "@/components/campaign/campaign-workspace";

/**
 * THE VAULT, DRAWN. One bar is the money the founder locked; it is cut into the missions' allocations
 * exactly (Σ reward × slots = funded, in 6-decimal base units — the budget invariant, visible), each
 * slot a cell; a paid cell is drained, and its coin sits in the released tray with the receipt behind
 * it. The cap lines are the vault's own rules: the reward per mission is fixed on-chain, the agent
 * can only ask for a slot, never an amount. Nothing here animates that did not happen.
 */
const usd = (base: number) => `$${(base / 1e6).toFixed(2)}`;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function VaultHero({ missions, submissions, fundedBase, paidBase, remainingBase, vaultExplorerUrl, rail }: {
  missions: WorkspaceMission[];
  submissions: WorkspaceSubmission[];
  fundedBase: number;
  paidBase: number;
  remainingBase: number;
  vaultExplorerUrl: string;
  rail: "evm" | "starknet";
}) {
  const allocated = missions.reduce((n, m) => n + m.rewardBase * m.maxCompletions, 0);
  const total = Math.max(fundedBase, allocated, 1);
  const paid = submissions.filter((s) => s.state === "paid").sort((a, b) => a.at - b.at);
  const settling = submissions.filter((s) => s.state === "verified").length;
  const unallocated = fundedBase - allocated;
  let cursor = 0;
  return (
    <section className="vh" aria-label="The vault">
      <div className="vh-bar" role="img" aria-label={`${usd(fundedBase)} locked in the vault, ${usd(paidBase)} released, ${usd(remainingBase)} remaining`}>
        {missions.map((m, i) => {
          const w = (m.rewardBase * m.maxCompletions) / total;
          const left = cursor; cursor += w;
          return (
            <div key={i} className="vh-seg" style={{ left: `${left * 100}%`, width: `${w * 100}%`, animationDelay: `${i * 90}ms` }} title={`${m.title} — ${usd(m.rewardBase)} × ${m.maxCompletions}`}>
              {Array.from({ length: m.maxCompletions }).map((_, k) => (
                <span key={k} className={`vh-cell${k < m.paid ? " drained" : ""}`} data-amt={usd(m.rewardBase)} style={{ animationDelay: `${i * 90 + k * 40}ms` }} />
              ))}
            </div>
          );
        })}
        {unallocated > 0 && <div className="vh-seg free" style={{ left: `${(allocated / total) * 100}%`, width: `${(unallocated / total) * 100}%` }} title={`${usd(unallocated)} unallocated`} />}
      </div>
      <div className="vh-caps" aria-hidden>
        {(() => { let c = 0; return missions.map((m, i) => { const w = (m.rewardBase * m.maxCompletions) / total; const left = c; c += w; return (
          <span key={i} className="vh-cap" style={{ left: `${left * 100}%`, width: `${w * 100}%` }}><b>{usd(m.rewardBase)}</b> × {m.maxCompletions} · {m.paid} paid<i>{m.title}</i></span>
        ); }); })()}
      </div>
      <div className="vh-legend">
        <span><b className="mono">{usd(fundedBase)}</b> locked on-chain{vaultExplorerUrl && <> · <a href={vaultExplorerUrl} target="_blank" rel="noreferrer">the vault</a></>}</span>
        <span>{missions.length} mission{missions.length === 1 ? "" : "s"} · allocated exactly, to the base unit{unallocated > 0 ? "" : " — nothing left over"}</span>
        <span>{rail === "starknet" ? "Cairo vault · private payouts" : "CampaignVault · GOAT"}</span>
      </div>
      <div className="vh-tray">
        <div className="vh-tray-h"><span>Released</span><b className="mono vh-paid">{usd(paidBase)}</b>{settling > 0 && <em>{settling} settling</em>}<span className="vh-rem">remaining <b className="mono">{usd(remainingBase)}</b></span></div>
        {paid.length === 0 ? (
          <p className="vh-empty">No coin has left the vault yet. Each one will sit here with its receipt.</p>
        ) : (
          <ol className="vh-coins" aria-label="Payouts, in order">
            {paid.map((s, i) => (
              <li key={s.id} style={{ animationDelay: `${i * 60}ms` }}>
                {s.proofTx ? <Link href={`/proof/${s.proofTx}`} className="vh-coin" title={`${usd(s.rewardBase ?? 0)} to ${short(s.wallet)} · ${s.missionTitle}`}>{usd(s.rewardBase ?? 0)}</Link> : <span className="vh-coin" title={`${usd(s.rewardBase ?? 0)} to ${short(s.wallet)}`}>{usd(s.rewardBase ?? 0)}</span>}
                <span className="vh-coin-who">{short(s.wallet)}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
