import "../../app/app.css";
import "@/styles/workspace.css";
import "./account.css";
import Link from "next/link";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { workspaceContext } from "@/lib/workspaces/context";
import { getFounderAddress } from "@/lib/auth/founder";
import { getWebTreasury } from "@/lib/treasury/web";
import { webTreasuryStatus } from "@/lib/treasury/launch";
import { treasuryActivity } from "@/lib/treasury/activity";
import { getDeputyOverview } from "@/lib/campaigns/overview";
import { chainConfig, explorerAddressUrl, explorerTxUrl } from "@/lib/deputy/networks";
import { rewardAligned } from "@/lib/format";
import { TreasuryCard } from "@/components/workspace/treasury-card";
import { AccountBalance, CopyAddress, WithdrawForm } from "@/components/workspace/account-live";
import { BridgeIn } from "@/components/workspace/bridge-in";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = { title: "Your account" };

/**
 * ONE WALLET, ANYONE CAN FUND IT. The account is the founder's Sage wallet on Arc: USDC in from any
 * wallet or exchange, the agent launches and pays from it inside the mandate, USDC out to any address
 * the founder names. Everything on this page is read from the chain or the ledger; nothing is a
 * projection.
 */
export default async function AccountPage() {
  const ctx = await workspaceContext();
  if (!ctx) redirect("/start");
  const founder = await getFounderAddress();
  if (!founder) redirect("/start");
  const treasury = getWebTreasury(founder);
  if (!treasury) {
    return (
      <main className="ws-shell">
        <header className="ws-head">
          <div>
            <span className="ws-eyebrow">Your account</span>
            <h1 className="ws-title">One wallet. Fund it from anywhere.</h1>
            <p className="ws-sub">Sage keeps a wallet for you on Arc. Send USDC to it from any wallet or exchange; the agent launches and pays from it; withdraw to any address, any time.</p>
          </div>
        </header>
        <div className="ws-grid"><div><TreasuryCard /></div></div>
      </main>
    );
  }
  const chain = chainConfig(treasury.chainId);
  const [status, moves, qr] = await Promise.all([
    webTreasuryStatus(founder),
    treasuryActivity(treasury.privyWalletAddress, treasury.chainId, treasury.createdAt),
    QRCode.toString(treasury.privyWalletAddress, { type: "svg", margin: 1, color: { dark: "#1a1d21", light: "#ffffff" } }),
  ]);
  const running = getDeputyOverview(founder).campaigns.filter((c) => c.chainId === treasury.chainId);
  const balanceUsd = status?.balanceUsd ?? 0;
  return (
    <main className="ws-shell">
      <header className="ws-head">
        <div>
          <span className="ws-eyebrow">Your account · {chain.name}</span>
          <h1 className="ws-title">One wallet. Fund it from anywhere.</h1>
          <p className="ws-sub">USDC in from any wallet or exchange. Sage launches and pays from it, inside your mandate. USDC out to any address, whenever you like.{chain.nativeSymbol === "USDC" ? " On Arc, USDC is the gas too, so this is all it ever needs." : ""}</p>
        </div>
      </header>

      <div className="ws-grid">
        <div>
          <section className="ws-card">
            <div className="ws-card-h"><h2>Fund it</h2><span className="ws-chip live">{chain.chipLabel}</span></div>
            <div className="ac-fund">
              <div className="ac-qr" dangerouslySetInnerHTML={{ __html: qr }} />
              <div>
                <div className="ac-addr"><code>{treasury.privyWalletAddress}</code><CopyAddress address={treasury.privyWalletAddress} /></div>
                <p className="ac-how">
                  Send USDC on {chain.name} to this address, from any wallet or exchange that supports it, from anywhere in the world.
                  {chain.isMainnet ? "" : <> This is a testnet: get test USDC at <a href="https://faucet.circle.com" target="_blank" rel="noreferrer">faucet.circle.com</a>, pick {chain.name}, paste the address.</>}
                  {" "}<a href={explorerAddressUrl(treasury.chainId, treasury.privyWalletAddress)} target="_blank" rel="noreferrer">on the explorer ↗</a>
                </p>
              </div>
            </div>
            {treasury.chainId === 5042002 ? <BridgeIn account={treasury.privyWalletAddress} destinationChain="Arc_Testnet" testnet={!chain.isMainnet} /> : null}
          </section>

          <section className="ws-card">
            <div className="ws-card-h"><h2>Balance</h2></div>
            <AccountBalance initialUsd={balanceUsd} network={chain.name} />
            <p className="ws-note" style={{ margin: "8px 0 0" }}>The mandate lets Sage put up to ${status?.perCampaignCapUsd?.toFixed(2)} into one campaign. Unspent money can only ever come back here or go where you send it below.</p>
          </section>

          <section className="ws-card">
            <div className="ws-card-h"><h2>Withdraw</h2></div>
            <WithdrawForm balanceUsd={balanceUsd} network={chain.name} />
          </section>
        </div>

        <div>
          <section className="ws-card">
            <div className="ws-card-h"><h2>Running from this account</h2><Link className="ws-chip" href="/workspace/autopilot">let Sage run it →</Link></div>
            {running.length === 0 ? (
              <p className="ac-empty">Nothing yet. <Link href="/launch">Post work</Link>, or fund the account and let Sage decide what to buy.</p>
            ) : (
              <ul className="ws-list">
                {running.map((c) => (
                  <li className="ws-row" key={c.id}>
                    <div className="ws-row-main">
                      <p className="ws-row-title"><Link href={`/c/${c.id}`}>{c.title}</Link></p>
                      <p className="ws-row-meta">{c.status} · {rewardAligned(c.rewardBase, c.chainId)} each · {c.paid}/{c.totalCompletions} paid{c.pending ? ` · ${c.pending} in review` : ""}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="ws-card">
            <div className="ws-card-h"><h2>Activity</h2><span className="ws-chip">read from the chain</span></div>
            {moves.length === 0 ? (
              <p className="ac-empty">No USDC has moved yet.</p>
            ) : (
              <ul className="ac-moves">
                {moves.map((m) => (
                  <li className={`ac-move is-${m.direction}`} key={`${m.txHash}:${m.direction}:${m.counterparty}`}>
                    <i>{m.direction === "in" ? "+" : "−"}</i>
                    <span><span className="mono">{(m.amountBase / 1e6).toFixed(2)} USDC</span> {m.direction === "in" ? "from" : "to"} <span className="mono">{m.counterparty.slice(0, 6)}…{m.counterparty.slice(-4)}</span>{m.at ? <span className="ac-when"> · {new Date(m.at * 1000).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span> : null}</span>
                    <a href={explorerTxUrl(treasury.chainId, m.txHash)} target="_blank" rel="noreferrer">tx ↗</a>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
