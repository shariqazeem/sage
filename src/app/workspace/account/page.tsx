import "../../app/app.css";
import "@/styles/workspace.css";
import "./account.css";
import Link from "next/link";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { workspaceContext } from "@/lib/workspaces/context";
import { founderChain } from "@/lib/auth/founder";
import { getWebTreasuryOn, listWebTreasuries } from "@/lib/treasury/web";
import { webTreasuryStatus } from "@/lib/treasury/launch";
import { treasuryActivity } from "@/lib/treasury/activity";
import { accountUnavailableBecause } from "@/lib/treasury/summary";
import { treasuryChainId } from "@/lib/privy/onboarding";
import { configuredLaunchChains } from "@/lib/launch/deployment-service";
import { getDeputyOverview } from "@/lib/campaigns/overview";
import { ARC_LAUNCH_CHAIN, chainConfig, explorerAddressUrl, explorerTxUrl, STARKNET_MAINNET_KEY } from "@/lib/deputy/networks";
import { rewardAligned } from "@/lib/format";
import { starknetUsdcBalance } from "@/lib/starknet/balance";
import { starknetAddressUrl } from "@/lib/starknet/explorer";
import { AccountBalance, CopyAddress, OpenAccount, WithdrawForm } from "@/components/workspace/account-live";
import { BridgeIn } from "@/components/workspace/bridge-in";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = { title: "Your account" };

/**
 * YOUR ACCOUNT — one page, three honest shapes.
 *
 * An Ethereum sign-in (a wallet, or the wallet an email holds) gets the account Sage keeps for them:
 * a Privy wallet under the mandate, one per network. USDC in from any wallet or exchange, the agent
 * launches and pays from it inside the mandate, USDC out to any address through a one-time permit.
 * Everything here is read from the chain or the ledger; nothing is a projection. GOAT mainnet is
 * the account every founder gets; Arc, while it is on testnet, is a second tab that says "testnet"
 * and holds test USDC only — an explicit choice, never the default of a mainnet product.
 *
 * A Starknet sign-in has no Ethereum address for the mandate to reclaim to, so there is no Sage-
 * held account for it — and the page says that in those words, shows the wallet that IS their
 * account (what it holds, what it has posted), and names the door the fund-once account opens by.
 * It used to show a "Treasury" card with a create button that failed; that is the screen the
 * founder photographed on 2026-09-10.
 */
export default async function AccountPage({ searchParams }: { searchParams: Promise<{ chain?: string }> }) {
  const ctx = await workspaceContext();
  if (!ctx) redirect("/start?next=/workspace/account");
  const founder = ctx.address;
  if (founderChain(founder) === "starknet") return <StarknetAccount founder={founder} />;
  if (accountUnavailableBecause(founder) === "unconfigured") return <Unconfigured />;

  const sp = await searchParams;
  const home = treasuryChainId();
  const accounts = listWebTreasuries(founder);
  // The networks on offer: the home chain and Arc (testnet, explicitly), plus any chain the founder already holds an account on.
  const offered = [...new Set([home, ...configuredLaunchChains().filter((id) => id === ARC_LAUNCH_CHAIN), ...accounts.map((a) => a.chainId)])];
  const asked = Number(sp.chain);
  const chainId = offered.includes(asked) ? asked : home;
  const chain = chainConfig(chainId);
  const treasury = getWebTreasuryOn(founder, chainId);

  const tabs = offered.length > 1 ? (
    <nav className="ac-tabs" aria-label="Networks">
      {offered.map((id) => {
        const c = chainConfig(id);
        const has = accounts.some((a) => a.chainId === id);
        return (
          <Link key={id} href={id === home ? "/workspace/account" : `/workspace/account?chain=${id}`} className={`ac-tab${id === chainId ? " on" : ""}`} aria-current={id === chainId ? "page" : undefined}>
            <span>{c.chipLabel}</span>
            <span className="ac-tab-k">{c.isMainnet ? "mainnet · real USDC" : "testnet · test USDC"}{has ? "" : " · not opened"}</span>
          </Link>
        );
      })}
    </nav>
  ) : null;

  if (!treasury) {
    return (
      <main className="ws-shell">
        <header className="ws-head">
          <div>
            <span className="ws-eyebrow">Your account · {chain.name}{chain.isMainnet ? "" : " · testnet"}</span>
            <h1 className="ws-title">One wallet. Fund it once.</h1>
            <p className="ws-sub">Sage keeps a wallet for you under a mandate it cannot widen. Send USDC to it from any wallet or exchange; the agent launches and pays from it; withdraw to any address, any time.</p>
          </div>
        </header>
        {tabs}
        <div className="ws-grid">
          <div>
            <section className="ws-card">
              <div className="ws-card-h"><h2>Open your account on {chain.name}</h2><span className="ws-chip">{chain.isMainnet ? "mainnet" : "testnet"}</span></div>
              <p className="ws-note" style={{ margin: "0 0 12px" }}>
                {chain.isMainnet
                  ? <>Real USDC on {chain.name}. Launches there also need a little {chain.nativeSymbol} for gas; Sage covers the first launch.</>
                  : <>Test USDC only — {chain.name} is a testnet. There, USDC is the gas too, so the account never needs anything else. Circle&apos;s faucet hands out test USDC.</>}
              </p>
              <OpenAccount chainId={chainId} network={chain.name} isMainnet={chain.isMainnet} />
            </section>
          </div>
          <div>
            <section className="ws-card">
              <div className="ws-card-h"><h2>What it is</h2></div>
              <ul className="ac-facts">
                <li><b>A wallet held for you</b> by Privy, born under a mandate: create a campaign vault through Sage&apos;s factory, fund it up to your cap, activate it — and nothing else.</li>
                <li><b>Fund it once.</b> The agent deploys, funds and activates each campaign itself. No wallet popup per launch.</li>
                <li><b>Unspent money has one way out:</b> back to you. A withdrawal attaches a one-time permit for the exact address and amount, then the account re-locks.</li>
                <li><b>Or let Sage run it.</b> With the account funded, <Link href="/workspace/autopilot">the standing mandate</Link> decides what work to buy next, inside your ceilings.</li>
              </ul>
            </section>
          </div>
        </div>
      </main>
    );
  }

  const [status, moves, qr] = await Promise.all([
    webTreasuryStatus(founder, chainId),
    treasuryActivity(treasury.privyWalletAddress, treasury.chainId, treasury.createdAt),
    QRCode.toString(treasury.privyWalletAddress, { type: "svg", margin: 1, color: { dark: "#1a1d21", light: "#ffffff" } }),
  ]);
  // Work launched FROM the account is posted by the account's own wallet (it owns the vault), so
  // both the founder's campaigns and the account wallet's campaigns belong here.
  const seen = new Set<string>();
  const running = [...getDeputyOverview(founder).campaigns, ...getDeputyOverview(treasury.privyWalletAddress).campaigns]
    .filter((c) => c.chainId === treasury.chainId && !seen.has(c.id) && seen.add(c.id));
  const balanceUsd = status?.balanceUsd ?? 0;
  const usdcIsGas = chain.nativeSymbol === "USDC";
  return (
    <main className="ws-shell">
      <header className="ws-head">
        <div>
          <span className="ws-eyebrow">Your account · {chain.name}{chain.isMainnet ? "" : " · testnet"}</span>
          <h1 className="ws-title">One wallet. Fund it once.</h1>
          <p className="ws-sub">
            USDC in from any wallet or exchange. Sage launches and pays from it, inside your mandate. USDC out to any address, whenever you like.
            {usdcIsGas ? ` On ${chain.name}, USDC is the gas too, so this is all it ever needs.` : ` Launches on ${chain.name} also need a little ${chain.nativeSymbol} for gas; Sage covers the first one.`}
          </p>
        </div>
      </header>
      {tabs}

      <div className="ws-grid">
        <div>
          <section className="ws-card">
            <div className="ws-card-h"><h2>Fund it</h2><span className={`ws-chip${chain.isMainnet ? " live" : ""}`}>{chain.chipLabel}{chain.isMainnet ? "" : " · test USDC"}</span></div>
            <div className="ac-fund">
              <div className="ac-qr" dangerouslySetInnerHTML={{ __html: qr }} />
              <div>
                <div className="ac-addr"><code>{treasury.privyWalletAddress}</code><CopyAddress address={treasury.privyWalletAddress} /></div>
                <p className="ac-how">
                  Send USDC on {chain.name} to this address, from any wallet or exchange that supports it.
                  {chain.isMainnet ? "" : <> This is a testnet: get test USDC at <a href="https://faucet.circle.com" target="_blank" rel="noreferrer">faucet.circle.com</a>, pick {chain.name}, paste the address.</>}
                  {" "}<a href={explorerAddressUrl(treasury.chainId, treasury.privyWalletAddress)} target="_blank" rel="noreferrer">on the explorer ↗</a>
                </p>
              </div>
            </div>
            {treasury.chainId === ARC_LAUNCH_CHAIN ? <BridgeIn account={treasury.privyWalletAddress} destinationChain="Arc_Testnet" testnet={!chain.isMainnet} /> : null}
          </section>

          <section className="ws-card">
            <div className="ws-card-h"><h2>Balance</h2></div>
            <AccountBalance initialUsd={balanceUsd} network={chain.name} chainId={chainId} />
            <p className="ws-note" style={{ margin: "8px 0 0" }}>The mandate lets Sage put up to ${status?.perCampaignCapUsd?.toFixed(2)} into one campaign. Unspent money can only ever come back here or go where you send it below.{!usdcIsGas && status?.gasNative ? ` Gas: ${status.gasNative} ${chain.nativeSymbol}${status.enoughGas === false ? " — not enough to launch yet" : ""}.` : ""}</p>
          </section>

          <section className="ws-card">
            <div className="ws-card-h"><h2>Withdraw</h2></div>
            <WithdrawForm balanceUsd={balanceUsd} network={chain.name} chainId={chainId} />
          </section>
        </div>

        <div>
          <section className="ws-card">
            <div className="ws-card-h"><h2>Running from this account</h2>{chainId === home ? <Link className="ws-chip" href="/workspace/autopilot">let Sage run it →</Link> : null}</div>
            {running.length === 0 ? (
              <p className="ac-empty">Nothing yet. <Link href="/launch">Post work</Link>{chainId === home ? <>, or fund the account and <Link href="/workspace/autopilot">let Sage decide</Link> what to buy</> : null}.</p>
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

/**
 * The Starknet founder's account is the wallet they signed in with. What it holds, what it has
 * posted, and — plainly — why the fund-once account is not on this rail yet.
 */
async function StarknetAccount({ founder }: { founder: string }) {
  const home = chainConfig(treasuryChainId());
  const [balance, overview] = await Promise.all([starknetUsdcBalance(founder), Promise.resolve(getDeputyOverview(founder))]);
  const posted = overview.campaigns.filter((c) => c.chainId === STARKNET_MAINNET_KEY);
  const explorer = starknetAddressUrl(founder);
  return (
    <main className="ws-shell">
      <header className="ws-head">
        <div>
          <span className="ws-eyebrow">Your account · Starknet</span>
          <h1 className="ws-title">Your wallet is your account.</h1>
          <p className="ws-sub">You signed in with a Starknet wallet. Work you post is funded from it, each launch signed by you, and every payout settles through the Cairo vault — privately, when you ask.</p>
        </div>
      </header>

      <div className="ws-grid">
        <div>
          <section className="ws-card">
            <div className="ws-card-h"><h2>Signed in as</h2><span className="ws-chip live">Starknet</span></div>
            <div className="ac-id"><code>{founder}</code><CopyAddress address={founder} />{explorer ? <a href={explorer} target="_blank" rel="noreferrer">on Starkscan ↗</a> : null}</div>
            {balance !== null ? (
              <div className="ac-balance" style={{ marginTop: 14 }}>
                <span className="ac-balance-n mono">{(Number(balance) / 1e6).toFixed(2)}</span>
                <span className="ac-balance-u">USDC on Starknet</span>
              </div>
            ) : null}
            <p className="ws-note" style={{ margin: "10px 0 0" }}>Funds work; receives nothing. What a campaign does not spend returns here when it ends.</p>
          </section>

          <section className="ws-card">
            <div className="ws-card-h"><h2>Fund once, let Sage launch</h2><span className="ws-chip">not on Starknet yet</span></div>
            <ul className="ac-facts">
              <li><b>What it is.</b> Sage can hold an account for you and launch every campaign from it inside a mandate, so you fund once instead of signing each launch — and <Link href="/workspace/autopilot">let it decide</Link> what work to buy next.</li>
              <li><b>Where it lives.</b> That account is a wallet on {home.name}, reclaiming only to an Ethereum address. It opens with an email or an Ethereum wallet sign-in.</li>
              <li><b>What changes for you.</b> Nothing. Your Starknet work, your vaults and your receipts stay exactly as they are. <Link href="/docs/operator">How the account works →</Link></li>
            </ul>
          </section>
        </div>

        <div>
          <section className="ws-card">
            <div className="ws-card-h"><h2>Your work on Starknet</h2><Link className="ws-chip" href="/dashboard">all work →</Link></div>
            {posted.length === 0 ? (
              <p className="ac-empty">Nothing yet. <Link href="/launch">Post work</Link> — a gig, a milestone grant or a testing run, funded from this wallet.</p>
            ) : (
              <ul className="ws-list">
                {posted.map((c) => (
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
        </div>
      </div>
    </main>
  );
}

function Unconfigured() {
  return (
    <main className="ws-shell">
      <header className="ws-head">
        <div>
          <span className="ws-eyebrow">Your account</span>
          <h1 className="ws-title">Not configured here.</h1>
          <p className="ws-sub">Accounts are wallets Privy holds under a mandate, and this deployment has no Privy app configured. <Link href="/launch">Post work</Link> from your own wallet instead.</p>
        </div>
      </header>
    </main>
  );
}
