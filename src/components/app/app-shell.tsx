"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Bot,
  Wallet,
  ShieldCheck,
  BadgeCheck,
  ArrowUpRight,
  Coins,
  Banknote,
  Gauge,
  Users,
  Power,
  HandCoins,
  Check,
  X,
  Lock,
  Clock,
  Calendar,
  ArrowDown,
  Loader2,
} from "lucide-react";
import { usd, short, cap, since } from "@/lib/format";
import type { VaultStateView, PayoutReceipt } from "@/lib/deputy/chain";
import type { DeputyOverview } from "@/lib/campaigns/overview";
import type { AgentIdentity } from "@/lib/erc8004/identity";
import type { AgentReputation } from "@/lib/erc8004/reputation-core";
import { NetworkChip } from "@/components/app/network-chip";
import { explorerTxUrl } from "@/lib/deputy/networks";
import { settlementLabel } from "@/lib/campaigns/labels";
import { useSiwe } from "@/lib/auth/use-siwe";
import { BudgetRing } from "@/components/app/budget-ring";
import { DeputyDetail } from "@/components/app/deputy-detail";
import { CampaignList } from "@/components/app/campaign-list";
import { CampaignDetail } from "@/components/app/campaign-detail";
import { CampaignCreate } from "@/components/app/campaign-create";
import { CapControl } from "@/components/app/cap-control";
import { CountUp } from "@/components/app/count-up";
import { BreakIt } from "@/components/hire/break-it";
import { CopyButton } from "@/components/hire/copy-button";
import { ConnectWallet } from "@/components/app/connect-wallet";
import { PnLPanel, type PnLView } from "@/components/agents/pnl-panel";
import { Ticker } from "@/components/app/ticker";

type Tab = "agents" | "wallet" | "policies" | "proof";

export interface X402Status {
  live: boolean;
  feesPaid: number;
  feesPaidUsd: number;
  feesPending: number;
}

interface Props {
  vault: VaultStateView | null;
  vendors: string[];
  overview: DeputyOverview;
  identity: AgentIdentity;
  reputation: AgentReputation;
  pnl: PnLView;
  history: PayoutReceipt[];
  network: { name: string; chainId: number; explorer: string };
  vaultAddress: string | null;
  usdcAddress: string | null;
  x402: X402Status;
  /** true when the displayed vault is the founder's own (not the demo vault). */
  ownVault?: boolean;
  /** land a just-onboarded founder straight in a pre-filled first campaign. */
  startInCreate?: boolean;
}

/** The ready-to-run draft a fresh founder lands in after onboarding — no empty tab. */
const ONBOARDING_TEMPLATE = {
  title: "Test my app — 0.5 USDC",
  description:
    "Try my app and tell me what broke. Paid in USDC on approval — the Deputy verifies each entry against the criteria below before anything settles.",
  criteria:
    "Tried the app and completed the core flow\nLeft a genuine note on friction or a bug you hit\nEvidence link resolves (a screenshot, recording, or short write-up)",
  rewardUsd: "0.5",
};

const TABS: { key: Tab; label: string; Icon: typeof Bot }[] = [
  { key: "agents", label: "Agents", Icon: Bot },
  { key: "wallet", label: "Wallet", Icon: Wallet },
  { key: "policies", label: "Policies", Icon: ShieldCheck },
  { key: "proof", label: "Proof", Icon: BadgeCheck },
];

export function AppShell({
  vault,
  vendors,
  overview,
  history,
  network,
  vaultAddress,
  usdcAddress,
  identity,
  reputation,
  pnl,
  x402,
  ownVault = false,
  startInCreate = false,
}: Props) {
  const siwe = useSiwe();
  const [tab, setTab] = useState<Tab>("agents");
  const [detailOpen, setDetailOpen] = useState(false);
  const [campaignView, setCampaignView] = useState<
    { mode: "detail"; id: string } | { mode: "create"; template?: boolean } | null
  >(startInCreate ? { mode: "create", template: true } : null);
  const [live, setLive] = useState<DeputyOverview>(overview);
  // Direction the next tab-view enters from (iOS segmented-control feel).
  const [enterDir, setEnterDir] = useState<"left" | "right">("right");

  const revoked = vault?.status === "revoked";
  // The ring shows the vault's real remaining balance. Payouts happen in the
  // campaign review queue, which reads the true on-chain value back.
  const remaining = vault?.remaining ?? 0;

  // Refresh the founder's real campaign overview after a client SIWE sign-in or
  // when returning from a campaign action, so counts stay live without a reload.
  const refreshOverview = useCallback(async () => {
    try {
      const res = await fetch("/api/deputy/overview", { cache: "no-store" });
      if (res.ok) setLive((await res.json()) as DeputyOverview);
    } catch {
      /* keep the last-known overview */
    }
  }, []);

  useEffect(() => {
    if (siwe.authed) void refreshOverview();
  }, [siwe.authed, refreshOverview]);

  function openDeputy() {
    setDetailOpen(true);
  }
  const openCampaign = (id: string) => setCampaignView({ mode: "detail", id });
  const newCampaign = () => setCampaignView({ mode: "create" });
  const closeCampaign = () => {
    setCampaignView(null);
    void refreshOverview();
  };
  const onCampaignCreated = (id: string) => {
    void refreshOverview();
    setCampaignView({ mode: "detail", id });
  };
  const goTab = (key: Tab) => {
    const from = TABS.findIndex((t) => t.key === tab);
    const to = TABS.findIndex((t) => t.key === key);
    setEnterDir(to < from ? "left" : "right");
    setDetailOpen(false);
    setCampaignView(null);
    setTab(key);
  };

  return (
    <>
      <div className="sb-shell sage-shell-enter">
        <Ticker />
        <header className="sb-top">
          <div className="sb-brand">
            <span className="sb-mark">S</span> Sage
          </div>
          <div className="sb-top-right">
            <button
              className="sb-topbtn"
              onClick={() => goTab("agents")}
            >
              <HandCoins size={13} /> Campaigns
            </button>
            <ConnectWallet />
            <span className="sb-net">
              <span className="dot" /> {network.name}
            </span>
          </div>
        </header>

        {campaignView ? (
          campaignView.mode === "detail" ? (
            <CampaignDetail campaignId={campaignView.id} onBack={closeCampaign} />
          ) : (
            <CampaignCreate
              onBack={closeCampaign}
              onCreated={onCampaignCreated}
              template={campaignView.template ? ONBOARDING_TEMPLATE : undefined}
            />
          )
        ) : detailOpen && vault ? (
          <DeputyDetail
            vault={vault}
            journal={live.journal}
            onBack={() => setDetailOpen(false)}
          />
        ) : (
          <div
            key={tab}
            className={`sage-tabview${enterDir === "left" ? " from-left" : ""}`}
          >
            {/* AGENTS */}
            {tab === "agents" && (
              <section className="sage-stagger">
                {vault ? (
                  <>
                    <div className="sage-agent-card">
                      <div className="sage-agent-top">
                        <div className="sage-dep-id">
                          <span className="sage-dep-icon">
                            <Bot size={22} />
                          </span>
                          <div>
                            <div className="sage-dep-name">Payout Deputy</div>
                            <div className="sage-dep-sub">Reward campaigns · USDC</div>
                          </div>
                        </div>
                        <span className={`sage-status ${revoked ? "dan" : "pos"}`}>
                          <span className="dot" />
                          {revoked ? "Revoked" : "Watching for work"}
                        </span>
                      </div>

                      <div className="sage-ring-wrap">
                        <BudgetRing
                          remaining={remaining}
                          budget={vault.budget}
                          size={250}
                          danger={revoked}
                        />
                      </div>

                      {live.hasCampaigns && (
                        <div className="sage-reward" style={{ cursor: "default" }}>
                          <div className="sage-reward-id">
                            <span className="sage-reward-ico">
                              <HandCoins size={17} />
                            </span>
                            <div className="sage-reward-txt">
                              <div className="sage-reward-title">
                                {live.totalPending > 0
                                  ? `${live.totalPending} submission${live.totalPending === 1 ? "" : "s"} awaiting review`
                                  : "All caught up — no submissions to review"}
                              </div>
                              <div className="sage-reward-sub mono">
                                {live.campaigns.length} campaign
                                {live.campaigns.length === 1 ? "" : "s"} ·{" "}
                                {live.totalPaid} paid ·{" "}
                                {usd(live.paidAmountBase / 1_000_000)} released
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      <div className="sage-card-foot">
                        <button className="sage-foot-link" onClick={openDeputy}>
                          Open work journal <ArrowUpRight size={14} />
                        </button>
                        <button
                          className="sage-foot-muted"
                          onClick={() => goTab("wallet")}
                        >
                          Same balance in Wallet →
                        </button>
                      </div>
                    </div>

                    {siwe.authed ? (
                      <CampaignList
                        campaigns={live.campaigns}
                        onOpen={openCampaign}
                        onNew={newCampaign}
                      />
                    ) : (
                      <div className="sage-gate" style={{ marginTop: 20 }}>
                        <p>
                          Sign in with your wallet to create and review campaigns.
                          Signing proves you control the wallet — it moves no funds.
                        </p>
                        <button
                          className="sage-btn sage-btn-primary"
                          onClick={() => void siwe.signIn()}
                          disabled={siwe.signingIn}
                        >
                          {siwe.signingIn ? (
                            <>
                              <Loader2 size={15} className="sage-spin2" /> Signing…
                            </>
                          ) : siwe.address ? (
                            <>
                              <ShieldCheck size={15} /> Sign in as {short(siwe.address)}
                            </>
                          ) : (
                            "Connect wallet"
                          )}
                        </button>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="sb-card sb-empty">
                    No Deputy is live on this network yet. Deploy a Policy Vault to
                    begin.
                  </div>
                )}
              </section>
            )}

            {/* WALLET */}
            {tab === "wallet" && (
              <section className="sage-stagger">
                {vault ? (
                  <>
                    <div className="sage-wallet-hero">
                      <div className="k">Total in wallet</div>
                      <div className="v mono">
                        <CountUp value={remaining} format={usd} />
                      </div>
                      <div className="sub mono">USDC · your Deputy&apos;s wallet</div>
                      <div className="sage-wallet-meter">
                        <span
                          style={{
                            width: `${Math.round(
                              (vault.budget > 0 ? remaining / vault.budget : 0) *
                                100,
                            )}%`,
                          }}
                        />
                      </div>
                      <div className="sage-wallet-legend">
                        <span>{usd(vault.spent)} released</span>
                        <span>{usd(vault.budget)} funded</span>
                      </div>
                    </div>

                    {/* RAIL 2 — the operator fees line (real GOAT x402 payments only) */}
                    {(x402.feesPaid > 0 || x402.feesPending > 0) && (
                      <div className="sage-x402-fees mono">
                        <span className="k">Operator fees · x402</span>
                        <span className="v">
                          {usd(x402.feesPaidUsd)} paid
                          {x402.feesPending > 0
                            ? ` · ${x402.feesPending} pending`
                            : ""}
                        </span>
                      </div>
                    )}

                    {/* per-campaign money view — committed vs settled */}
                    <div className="sage-hist-label">Campaigns</div>
                    {live.hasCampaigns ? (
                      <div className="sage-txlist">
                        {live.campaigns.map((c) => {
                          const committed =
                            c.maxRecipients > 0 ? c.rewardBase * c.maxRecipients : 0;
                          const settled = c.paid * c.rewardBase;
                          const pct =
                            c.maxRecipients > 0
                              ? Math.min(1, c.paid / c.maxRecipients)
                              : 0;
                          return (
                            <div className="sage-wcamp" key={c.id}>
                              <div className="sage-wcamp-top">
                                <span className="sage-wcamp-title">{c.title}</span>
                                <span className="mono sage-wcamp-settled">
                                  {usd(settled / 1_000_000)}
                                </span>
                              </div>
                              <div className="sage-wcamp-meta mono">
                                {committed > 0
                                  ? `${usd(committed / 1_000_000)} committed`
                                  : "open budget"}{" "}
                                · {c.paid}
                                {c.maxRecipients > 0 ? `/${c.maxRecipients}` : ""} paid
                              </div>
                              {c.maxRecipients > 0 && (
                                <div className="sage-wcamp-bar">
                                  <span style={{ width: `${pct * 100}%` }} />
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="sb-card sb-empty">
                        No campaigns yet — create one in the Agents tab.
                      </div>
                    )}

                    <div className="sage-hist-label">
                      {ownVault ? "Settled payouts" : "Transaction history"}
                    </div>
                    {ownVault ? (
                      live.settledPayouts.length ? (
                        <div className="sage-txlist">
                          {live.settledPayouts.slice(0, 12).map((p) => (
                            <div className="sage-tx-row" key={p.txHash}>
                              <span className="sage-tx-ico pos">
                                <Check size={14} strokeWidth={3} />
                              </span>
                              <div className="sage-tx-main">
                                <div className="sage-tx-top">
                                  <span className="sage-tx-title">
                                    {settlementLabel(p.campaignTitle, p.wallet)}
                                  </span>
                                  <span className="mono sage-tx-amt">
                                    {usd(p.amountBase / 1_000_000)}
                                  </span>
                                </div>
                                <div className="sage-tx-sub">
                                  <a href={`/proof/${p.txHash}`}>proof</a>
                                  <a
                                    className="mono"
                                    href={explorerTxUrl(p.chainId, p.txHash)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  >
                                    {short(p.txHash)}
                                  </a>
                                  <NetworkChip chainId={p.chainId} size="xs" />
                                  <span className="mono sage-tx-ago">
                                    {since(p.at)}
                                  </span>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="sb-card sb-empty">
                          No payouts yet. Approve a submission in Agents to release the
                          first.
                        </div>
                      )
                    ) : history.length ? (
                      <div className="sage-txlist">
                        {history.slice(0, 8).map((r, i) => {
                          const ref = live.intentLabels[r.intentHash.toLowerCase()];
                          const title = ref
                            ? settlementLabel(ref.campaignTitle, ref.wallet)
                            : r.settled
                              ? "Payout settled"
                              : "Attempt blocked";
                          return (
                            <div className="sage-tx-row" key={`${r.txHash}-${i}`}>
                              <span
                                className={`sage-tx-ico ${r.settled ? "pos" : "dan"}`}
                              >
                                {r.settled ? (
                                  <Check size={14} strokeWidth={3} />
                                ) : (
                                  <X size={14} strokeWidth={2.6} />
                                )}
                              </span>
                              <div className="sage-tx-main">
                                <div className="sage-tx-top">
                                  <span
                                    className={`sage-tx-title${r.settled ? "" : " dan"}`}
                                  >
                                    {title}
                                  </span>
                                  {r.settled && (
                                    <span className="mono sage-tx-amt">
                                      {usd(r.amount)}
                                    </span>
                                  )}
                                </div>
                                <div className="sage-tx-sub">
                                  <span className="mono">→ {short(r.recipient)}</span>
                                  {r.settled && <a href={`/proof/${r.txHash}`}>proof</a>}
                                  <a
                                    className="mono"
                                    href={r.explorerUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  >
                                    {short(r.txHash)}
                                  </a>
                                  <NetworkChip chainId={r.chainId} size="xs" />
                                  <span className="mono sage-tx-ago">
                                    {since(r.timestamp)}
                                  </span>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="sb-card sb-empty">No transactions yet.</div>
                    )}

                    <a
                      className="sage-btn sage-btn-ghost"
                      href={vault.explorerUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ width: "100%", marginTop: 14 }}
                    >
                      View every transaction on the explorer <ArrowUpRight size={16} />
                    </a>
                  </>
                ) : (
                  <div className="sb-card sb-empty">No wallet funded yet.</div>
                )}
              </section>
            )}

            {/* POLICIES */}
            {tab === "policies" && (
              <section className="sage-stagger">
                {vault ? (
                  <>
                    <div className="sage-pol-intro">
                      <p>
                        The rules limit what your Deputy can do — and what{" "}
                        <em>you</em> can do. You cannot loosen your own leash.
                      </p>
                      <span className={`sage-status ${revoked ? "dan" : "pos"}`}>
                        <span className="dot" />
                        {revoked ? "Revoked" : cap(vault.status)}
                      </span>
                    </div>

                    <div className="sage-pol-list">
                      {/* budget ceiling · immutable */}
                      <div className="sage-pol">
                        <div className="sage-pol-top">
                          <span className="sage-pol-ico">
                            <Coins size={17} />
                          </span>
                          <div className="sage-pol-head">
                            <div className="sage-pol-name">Budget ceiling</div>
                            <span className="sage-pol-chip gray">
                              <Lock size={11} /> Immutable
                            </span>
                          </div>
                          <span className="sage-pol-val mono">{usd(vault.budget)}</span>
                        </div>
                        <div className="sage-pol-desc">
                          Set once when the vault was funded. It can never change — not
                          even by you. The hard cap on total spend.
                        </div>
                      </div>

                      {/* per-payout cap · tighten only */}
                      <div className="sage-pol">
                        <div className="sage-pol-top">
                          <span className="sage-pol-ico">
                            <Banknote size={17} />
                          </span>
                          <div className="sage-pol-head">
                            <div className="sage-pol-name">Per-payout cap</div>
                            <span className="sage-pol-chip indigo">
                              <ArrowDown size={11} /> Tighten only
                            </span>
                          </div>
                          <CapControl
                            kind="perTx"
                            currentCap={vault.perTxCap}
                            vault={vaultAddress}
                            ownVault={ownVault}
                          />
                        </div>
                        <div className="sage-pol-desc">
                          The most any single payout can be. Lower it whenever you like;
                          it can never go back up.
                        </div>
                      </div>

                      {/* velocity cap · tighten only */}
                      <div className="sage-pol">
                        <div className="sage-pol-top">
                          <span className="sage-pol-ico">
                            <Gauge size={17} />
                          </span>
                          <div className="sage-pol-head">
                            <div className="sage-pol-name">24h velocity cap</div>
                            <span className="sage-pol-chip indigo">
                              <ArrowDown size={11} /> Tighten only
                            </span>
                          </div>
                          <CapControl
                            kind="velocity"
                            currentCap={vault.velocityCap}
                            vault={vaultAddress}
                            ownVault={ownVault}
                          />
                        </div>
                        <div className="sage-pol-desc">
                          Max spend in any rolling 24 hours. Lowerable only.
                        </div>
                      </div>

                      {/* approved recipients · timelocked adds */}
                      <div className="sage-pol">
                        <div className="sage-pol-top">
                          <span className="sage-pol-ico">
                            <Users size={17} />
                          </span>
                          <div className="sage-pol-head">
                            <div className="sage-pol-name">Approved recipients</div>
                            <span className="sage-pol-chip amber">
                              <Clock size={11} /> Timelocked adds · instant removals
                            </span>
                          </div>
                          <span className="sage-pol-val mono">
                            {(ownVault ? live.approvedRecipients : vendors.length) ||
                              "—"}
                          </span>
                        </div>
                        <div className="sage-pol-desc">
                          {ownVault
                            ? live.approvedRecipients > 0
                              ? `${live.approvedRecipients} recipient${live.approvedRecipients === 1 ? "" : "s"} approved through your campaigns. `
                              : "No recipients approved yet — a recipient is allowlisted when you approve their submission. "
                            : vendors.length
                              ? `${vendors.join(", ")}. `
                              : ""}
                          A wallet not on this list cannot be paid, full stop. New adds
                          wait out a timelock; removals take effect instantly.
                        </div>
                      </div>

                      {/* duration · immutable */}
                      <div className="sage-pol">
                        <div className="sage-pol-top">
                          <span className="sage-pol-ico">
                            <Calendar size={17} />
                          </span>
                          <div className="sage-pol-head">
                            <div className="sage-pol-name">Duration</div>
                            <span className="sage-pol-chip gray">
                              <Lock size={11} /> Immutable
                            </span>
                          </div>
                          <span className="sage-pol-val mono">14-day term</span>
                        </div>
                        <div className="sage-pol-desc">
                          The vault auto-expires after its term. After that, every payout
                          fails.
                        </div>
                      </div>

                      {/* kill switch · terminal */}
                      <div className="sage-pol dan">
                        <div className="sage-pol-top">
                          <span className="sage-pol-ico dan">
                            <Power size={17} />
                          </span>
                          <div className="sage-pol-head">
                            <div className="sage-pol-name dan">Kill switch</div>
                            <span className="sage-pol-chip red">
                              <Power size={11} /> Terminal · irreversible
                            </span>
                          </div>
                          <span
                            className={`sage-pol-val${revoked ? " dan" : ""}`}
                          >
                            {revoked ? "Revoked" : "Armed"}
                          </span>
                        </div>
                        <div className="sage-pol-desc">
                          Revoke stops every future payout the instant you do it, for
                          good. Try it for real on a disposable vault in the Proof tab —
                          your live one is never touched.
                        </div>
                      </div>
                    </div>

                    <div className="sb-policy-foot" style={{ marginTop: 14 }}>
                      <ShieldCheck size={16} style={{ color: "var(--pos)", flex: "none" }} />
                      Every rule here is enforced by the contract, not the AI. The agent
                      proposes; the vault decides.
                    </div>
                  </>
                ) : (
                  <div className="sb-card sb-empty">No policy is live yet.</div>
                )}
              </section>
            )}

            {/* PROOF */}
            {tab === "proof" && (
              <section className="sage-stagger">
                <div className="sb-tabhead">
                  <h1>Proof</h1>
                  <p>Every limit and every action is verifiable on-chain.</p>
                </div>

                {/* ERC-8004 agent identity — reputation = real settled payouts */}
                <div className="sage-agent-card" style={{ marginBottom: 22 }}>
                  <div className="sage-agent-top">
                    <div className="sage-dep-id">
                      <span className="sage-dep-icon">
                        <BadgeCheck size={22} />
                      </span>
                      <div>
                        <div className="sage-dep-name">Agent identity</div>
                        <div className="sage-dep-sub">
                          ERC-8004 · {identity.network}
                        </div>
                      </div>
                    </div>
                    <span className={`sage-status ${identity.registered ? "pos" : ""}`}>
                      <span className="dot" />
                      {identity.registered ? "Registered" : "Pending"}
                    </span>
                  </div>

                  {identity.registered ? (
                    <>
                      <div className="sb-detail-stats" style={{ marginTop: 14 }}>
                        <span>
                          <b className="mono">{identity.name}</b> name
                        </span>
                        <span>
                          <b className="mono">#{identity.agentId}</b> agent id
                        </span>
                      </div>
                      <div className="sage-linkrow" style={{ marginTop: 12 }}>
                        <span className="sage-link-chip mono">
                          {short(identity.address ?? "")}
                        </span>
                        <a
                          className="sage-copy"
                          href={`${identity.explorer}/address/${identity.address}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label="View on GOAT explorer"
                        >
                          <ArrowUpRight size={14} />
                        </a>
                      </div>
                      <p className="sage-hint" style={{ marginTop: 12 }}>
                        Reputation is built only from real settled payouts.{" "}
                        <a
                          href={identity.scanUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: "var(--accent)" }}
                        >
                          View on 8004scan →
                        </a>
                      </p>
                    </>
                  ) : (
                    <>
                      <p
                        className="sage-hint"
                        style={{ marginTop: 12, lineHeight: 1.55 }}
                      >
                        The Deputy&apos;s identity registers on {identity.network}{" "}
                        (chain {identity.chainId}). Once minted it appears here and
                        on 8004scan — with a reputation built only from real settled
                        payouts, nothing self-asserted.
                      </p>
                      <div className="sb-detail-stats" style={{ marginTop: 12 }}>
                        <span>
                          registry <b className="mono">{short(identity.registry)}</b>
                        </span>
                        <span>
                          chain <b className="mono">{identity.chainId}</b>
                        </span>
                      </div>
                      <a
                        className="sage-hint"
                        href={identity.scanUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          marginTop: 10,
                          display: "inline-block",
                          color: "var(--accent)",
                        }}
                      >
                        Preview 8004scan →
                      </a>
                    </>
                  )}

                  <div className="sb-detail-stats" style={{ marginTop: 16 }}>
                    <span>
                      <b className="mono">{usd(reputation.settledTotalBase / 1e6)}</b>{" "}
                      settled
                    </span>
                    <span>
                      <b className="mono">{reputation.payoutCount}</b> payouts
                    </span>
                    <span>
                      <b className="mono">{reputation.blockedCount}</b> blocked
                    </span>
                  </div>
                  <a
                    className="sage-hint"
                    href="/agents/sage"
                    style={{
                      marginTop: 10,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      color: "var(--accent)",
                    }}
                  >
                    View public track record <ArrowUpRight size={14} />
                  </a>
                </div>

                {/* the Deputy's P&L — earned fees vs its own input costs, real rows */}
                <div className="sage-agent-card" style={{ marginBottom: 22 }}>
                  <div className="sage-agent-top" style={{ marginBottom: 12 }}>
                    <div className="sage-dep-id">
                      <span className="sage-dep-icon">
                        <Coins size={20} />
                      </span>
                      <div>
                        <div className="sage-dep-name">Agent P&amp;L</div>
                        <div className="sage-dep-sub">Summed from real rows</div>
                      </div>
                    </div>
                  </div>
                  <PnLPanel pnl={pnl} />
                </div>

                <div className="hproof" style={{ marginBottom: 22 }}>
                  <div className="hproof-row">
                    <span className="hproof-k">Policy Vault</span>
                    <span className="hproof-v">
                      {vaultAddress ? (
                        <>
                          <span className="addr mono">{short(vaultAddress)}</span>
                          <CopyButton value={vaultAddress} label="vault address" />
                          <a
                            className="hext"
                            href={`${network.explorer}/address/${vaultAddress}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label="View on explorer"
                          >
                            <ArrowUpRight size={14} />
                          </a>
                        </>
                      ) : (
                        <span className="muted">Not configured</span>
                      )}
                    </span>
                  </div>
                  {usdcAddress && (
                    <div className="hproof-row">
                      <span className="hproof-k">Settlement token</span>
                      <span className="hproof-v">
                        <span className="addr mono">{short(usdcAddress)}</span>
                        <CopyButton value={usdcAddress} label="token address" />
                        <a
                          className="hext"
                          href={`${network.explorer}/address/${usdcAddress}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label="View on explorer"
                        >
                          <ArrowUpRight size={14} />
                        </a>
                      </span>
                    </div>
                  )}
                  <div className="hproof-row">
                    <span className="hproof-k">Network</span>
                    <span className="hproof-v">
                      {network.name} <span className="muted">· chain {network.chainId}</span>
                    </span>
                  </div>
                  <div className="hproof-row">
                    <span className="hproof-k">Status</span>
                    <span className="hproof-v">
                      {revoked ? (
                        <span className="sage-badge dan">Revoked</span>
                      ) : vault ? (
                        <span className="sage-badge pos">{cap(vault.status)}</span>
                      ) : (
                        <span className="sage-badge neutral">Unavailable</span>
                      )}
                    </span>
                  </div>
                </div>

                {/* x402 payment rails — live/pending + real fees paid, no simulation */}
                <div className="sb-sec-label">x402 payment rails</div>
                <div className={`sage-x402-status ${x402.live ? "live" : "pending"}`}>
                  <span className="sage-x402-status-dot" />
                  <div className="sage-x402-status-body">
                    <div className="sage-x402-status-head">
                      {x402.live
                        ? "x402 rails live · GOAT facilitator"
                        : "x402 rails — pending merchant approval"}
                    </div>
                    <div className="sage-x402-status-sub mono">
                      Verification &amp; operator fee · 0.1 USDC · chain 2345
                      {x402.feesPaid > 0
                        ? ` · ${usd(x402.feesPaidUsd)} fees paid`
                        : ""}
                      {x402.feesPending > 0 ? ` · ${x402.feesPending} pending` : ""}
                    </div>
                  </div>
                </div>

                <div className="sb-sec-label">Try to break it</div>
                <BreakIt remaining={remaining} network={network} />
              </section>
            )}
          </div>
        )}
      </div>

      {/* tab bar */}
      <nav className="sb-tabbar">
        {TABS.map(({ key, label, Icon }) => (
          <button
            key={key}
            className={`sb-tab${tab === key && !detailOpen && !campaignView ? " on" : ""}`}
            onClick={() => goTab(key)}
          >
            <Icon size={19} />
            {label}
          </button>
        ))}
      </nav>
    </>
  );
}
