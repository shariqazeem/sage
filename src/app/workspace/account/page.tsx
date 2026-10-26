import "../../app/app.css";
import "@/styles/workspace.css";
import "./account.css";
import Link from "next/link";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Briefcase, ExternalLink, Gauge, ShieldCheck } from "lucide-react";
import { workspaceContext } from "@/lib/workspaces/context";
import { founderChain, sameFounder } from "@/lib/auth/founder";
import { getWebTreasuryOn, listWebTreasuries, webTreasuryOpening } from "@/lib/treasury/web";
import { webTreasuryStatus } from "@/lib/treasury/launch";
import { activityRows, readAccountMoves, type ActivityRow } from "@/lib/treasury/account-activity";
import { listAccountMoves } from "@/lib/db/account-moves";
import { listCampaigns } from "@/lib/db/campaigns";
import { accountUnavailableBecause } from "@/lib/treasury/summary";
import { treasuryChainId } from "@/lib/privy/onboarding";
import { configuredLaunchChains, launchClosedReason } from "@/lib/launch/deployment-service";
import { accountNetworks, moreNetworks } from "@/lib/treasury/account-networks";
import { getDeputyOverview } from "@/lib/campaigns/overview";
import { billingAddress } from "@/lib/plans/billing";
import { chainConfig, explorerAddressUrl, isPausedNetwork, METIS_MAINNET_CHAIN_ID, pausedNetworkReason, STARKNET_MAINNET_KEY } from "@/lib/deputy/networks";
import { rewardAligned } from "@/lib/format";
import { starknetUsdcBalance } from "@/lib/starknet/balance";
import { starknetAddressUrl } from "@/lib/starknet/explorer";
import { CapEditor, CopyAddress, OpenAccount } from "@/components/workspace/account-live";
import { MoneyCard } from "@/components/account/money-card";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata = { title: "Account" };

/**
 * YOUR ACCOUNT (redrawn 24 Oct 2026): the money Sage pays your people from, in one card.
 *
 * An Ethereum-style sign-in (an email, or a wallet) gets an account Sage keeps for them on Metis: a
 * Privy-held wallet under a mandate. One card holds what it has (USDC, and the METIS its network fees
 * are paid in) and the three things a person does with it: add money (from an exchange, a wallet or
 * Ethereum), swap USDC and METIS, and send either one anywhere. Below it: the one limit the mandate is
 * built from, what moved (read from the chain), and the jobs it funds. Nothing here is a projection.
 *
 * A network that is paused (GOAT) stays listed while it holds money, with send as its only action. Arc and
 * Starknet are closed (26 Oct 2026: one network, Metis) and never appear. A Starknet session from before the
 * close has no Ethereum address for the mandate to reclaim to, so its wallet IS its account, and the page
 * says what still works there and where new work starts.
 */
export default async function AccountPage({ searchParams }: { searchParams: Promise<{ chain?: string; do?: string }> }) {
  const ctx = await workspaceContext();
  if (!ctx) redirect("/start?next=/workspace/account");
  const founder = ctx.address;
  if (founderChain(founder) === "starknet") return <StarknetAccount founder={founder} />;
  if (accountUnavailableBecause(founder) === "unconfigured") return <Unconfigured />;

  const sp = await searchParams;
  const home = treasuryChainId();
  const accounts = listWebTreasuries(founder);
  // The network policy decides what this page shows (account-networks.ts): primary networks once configured,
  // secondary ones only when held or asked for, testnets never. A paused network stays listed while held.
  const configured = configuredLaunchChains();
  const listable = [...new Set([...configured, home, METIS_MAINNET_CHAIN_ID, ...accounts.map((a) => a.chainId).filter(isPausedNetwork)])];
  const asked = Number(sp.chain);
  const nets = accountNetworks({ home, configured: listable, held: accounts.map((a) => a.chainId), asked: Number.isFinite(asked) ? asked : null });
  const chainId = nets.selected;
  const chain = chainConfig(chainId);
  const treasury = getWebTreasuryOn(founder, chainId);
  const more = moreNetworks({ configured, shown: [...nets.primary, ...nets.secondary] });

  const tab = (id: number) => {
    const has = accounts.some((a) => a.chainId === id);
    const state = isPausedNetwork(id) ? "paused" : has ? null : launchClosedReason(id) ? "opening soon" : "not opened";
    return (
      <Link key={id} href={id === home ? "/workspace/account" : `/workspace/account?chain=${id}`} className={`acct-net${id === chainId ? " on" : ""}`} aria-current={id === chainId ? "page" : undefined}>
        {chainConfig(id).name}
        {state && <span className="acct-net-k">{state}</span>}
      </Link>
    );
  };
  const tabs = nets.primary.length + nets.secondary.length > 1 || more.length > 0 ? (
    <nav className="acct-nets" aria-label="Networks">
      {nets.primary.map(tab)}
      {nets.secondary.map(tab)}
      {more.map((id) => (
        <Link key={id} href={`/workspace/account?chain=${id}`} className="acct-net ghost">+ {chainConfig(id).name}</Link>
      ))}
    </nav>
  ) : null;

  const head = (
    <header className="ws-head">
      <div>
        <span className="ws-eyebrow">Account · {chain.name}</span>
        <h1 className="ws-title">Your account</h1>
        <p className="ws-sub">The money Sage pays your people from. Add it, swap it, send it. Sage spends it only inside the limit you set.</p>
      </div>
      {tabs}
    </header>
  );

  if (!treasury && webTreasuryOpening(founder, chainId)) {
    // A new workspace opens its account after the response; the founder got here first.
    return (
      <main className="ws-shell">
        <meta httpEquiv="refresh" content="4" />
        {head}
        <section className="acct-card acct-state">
          <h2>Opening your account…</h2>
          <p>This takes a few seconds. The page refreshes itself.</p>
        </section>
      </main>
    );
  }

  if (!treasury) {
    const closed = launchClosedReason(chainId);
    return (
      <main className="ws-shell">
        {head}
        {closed ? (
          <section className="acct-card acct-state">
            <span className="ws-chip accent">opening soon</span>
            <h2>Your account opens here when Sage goes live on {chain.name}.</h2>
            <p>{closed} There is nothing to do now. When it opens, you add money to it with USDC or {chain.nativeSymbol} on the {chain.name} network, from an exchange or a wallet.</p>
            {chainId === METIS_MAINNET_CHAIN_ID && (
              <p className="faint">Getting ready? Binance, OKX and other exchanges let you withdraw METIS straight onto the Metis network. Inside Sage you can swap it to USDC and keep a little for network fees.</p>
            )}
          </section>
        ) : (
          <section className="acct-card acct-state">
            <h2>Open your account on {chain.name}</h2>
            <p>
              Sage keeps a wallet for you under a mandate it can&apos;t widen: it can fund your jobs up to the limit you set, and nothing else. You add money, swap and send from here, and money only ever leaves to an address you name.
              {chain.nativeSymbol === "USDC" ? ` On ${chain.name} USDC is the network fee too.` : ` Network fees are paid in ${chain.nativeSymbol} from the account.`}
            </p>
            <OpenAccount chainId={chainId} network={chain.name} />
          </section>
        )}
        <Explainer />
      </main>
    );
  }

  const [status, legs, qr] = await Promise.all([
    webTreasuryStatus(founder, chainId),
    readAccountMoves(treasury.privyWalletAddress, treasury.chainId, treasury.createdAt),
    QRCode.toString(treasury.privyWalletAddress, { type: "svg", margin: 1, color: { dark: "#1a1d21", light: "#ffffff" } }),
  ]);
  // Work launched FROM the account is posted by the account's own wallet (it owns the vault), so
  // both the founder's campaigns and the account wallet's campaigns belong here.
  const seen = new Set<string>();
  const running = [...getDeputyOverview(founder).campaigns, ...getDeputyOverview(treasury.privyWalletAddress).campaigns]
    .filter((c) => c.chainId === treasury.chainId && !seen.has(c.id) && seen.add(c.id));
  const vaults = new Set(
    listCampaigns()
      .filter((c) => c.vaultAddress && (sameFounder(c.posterWallet, founder) || sameFounder(c.posterWallet, treasury.privyWalletAddress)))
      .map((c) => (c.vaultAddress as string).toLowerCase()),
  );
  const sage = new Set([billingAddress()?.toLowerCase()].filter((a): a is string => !!a));
  const rows = activityRows({ chainId: treasury.chainId, legs, records: listAccountMoves(treasury.privyWalletAddress), vaults, sage, nativeSymbol: chain.nativeSymbol });
  const paused = pausedNetworkReason(treasury.chainId);
  const openTab = sp.do === "add" || sp.do === "swap" || sp.do === "send" ? sp.do : null;

  return (
    <main className="ws-shell">
      {head}
      {paused && (
        <section className="acct-paused">
          <b>Paused for new jobs.</b> {paused} Anything this account holds is still yours: send it to a wallet you control below.
        </section>
      )}
      <MoneyCard
        chainId={treasury.chainId}
        network={chain.name}
        address={treasury.privyWalletAddress}
        qrSvg={qr}
        explorerUrl={explorerAddressUrl(treasury.chainId, treasury.privyWalletAddress)}
        nativeSymbol={chain.nativeSymbol}
        usdcIsGas={chain.nativeSymbol === "USDC"}
        canSwap={status?.canSwap ?? false}
        paused={paused}
        initial={{
          usdc: status?.balanceUsd ?? 0,
          gasWei: status?.gasWei ?? null,
          gasUsd: status?.gasUsd ?? null,
          gasPriceWei: status?.gasPriceWei ?? null,
          launchFloorWei: status?.launchFloorWei ?? "0",
        }}
        openTab={openTab}
      />

      <div className="ws-grid acct-grid">
        <section className="ws-card">
          <div className="ws-card-h"><h2>Activity</h2><span className="ws-chip">read from the chain</span></div>
          {rows.length === 0 ? <p className="ac-empty">Nothing has moved yet. Money you add shows up here within a few seconds of landing.</p> : <ActivityList rows={rows} />}
        </section>
        <div>
          <section className="ws-card">
            <div className="ws-card-h"><h2><Gauge size={15} /> Your limit</h2></div>
            <CapEditor capUsd={status?.perCampaignCapUsd ?? treasury.perCampaignCapBase / 1e6} chainId={chainId} />
            <p className="ws-note">Sage can put up to this into any one job, and never moves money anywhere else. Leftover from a job comes back here.</p>
          </section>
          <section className="ws-card">
            <div className="ws-card-h"><h2><Briefcase size={15} /> Jobs from this account</h2><Link className="ws-chip" href="/workspace/jobs">all jobs</Link></div>
            {running.length === 0 ? (
              <p className="ac-empty">None yet. <Link href="/launch">Post a job</Link> and Sage funds it from here.</p>
            ) : (
              <ul className="ws-list">
                {running.slice(0, 6).map((c) => (
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
          <Explainer compact />
        </div>
      </div>
    </main>
  );
}

function ActivityList({ rows }: { rows: ActivityRow[] }) {
  return (
    <ul className="acct-moves">
      {rows.map((r) => (
        <li key={r.key} className={`acct-move ${r.tone}`}>
          <span className="acct-move-ic" aria-hidden>
            {r.kind === "swap" ? <ArrowLeftRight size={13} /> : r.tone === "in" ? <ArrowDownLeft size={13} /> : <ArrowUpRight size={13} />}
          </span>
          <span className="acct-move-main">
            <span className="acct-move-t">{r.title}</span>
            <span className="acct-move-d">{r.detail}{r.at ? ` · ${new Date(r.at * 1000).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : ""}</span>
          </span>
          <span className="acct-move-a mono">{r.amount}</span>
          <a className="acct-move-tx" href={r.txUrl} target="_blank" rel="noreferrer" aria-label="Open the transaction"><ExternalLink size={12} /></a>
        </li>
      ))}
    </ul>
  );
}

function Explainer({ compact = false }: { compact?: boolean }) {
  return (
    <section className="ws-card">
      <div className="ws-card-h"><h2><ShieldCheck size={15} /> How your account works</h2></div>
      <ul className="ac-facts">
        <li><b>A wallet Sage keeps for you</b>, born under a mandate: it can create a job&apos;s vault through Sage&apos;s factory, fund it up to your limit, and nothing else.</li>
        <li><b>Money leaves only to an address you name.</b> Each send or swap opens a one-time permit for that move alone, then the account locks again.</li>
        {!compact && <li><b>You pay the network fee</b>, in METIS on Metis: a fraction of a cent for most moves, about 0.05 METIS to launch a job.</li>}
        <li><b>Or let Sage run it.</b> With the account funded, <Link href="/workspace/autopilot">Autopilot</Link> decides what work to buy next, inside your limits.</li>
      </ul>
    </section>
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
          <span className="ws-eyebrow">Account · Starknet</span>
          <h1 className="ws-title">Your wallet is your account.</h1>
          <p className="ws-sub">You signed in with a Starknet wallet. Sage runs on Metis now: nothing new starts on Starknet, and everything you did here keeps its receipts.</p>
        </div>
      </header>

      <div className="ws-grid">
        <div>
          <section className="ws-card">
            <div className="ws-card-h"><h2>Signed in as</h2><span className="ws-chip live">Starknet</span></div>
            <div className="ac-id"><code>{founder}</code><CopyAddress address={founder} />{explorer ? <a href={explorer} target="_blank" rel="noreferrer">on Starkscan ↗</a> : null}</div>
            {balance !== null ? (
              <p className="acct-limit">
                <span className="acct-limit-v mono">{(Number(balance) / 1e6).toFixed(2)}</span>
                <span className="acct-limit-k">USDC on Starknet</span>
              </p>
            ) : null}
            <p className="ws-note">Funds work; receives nothing. What a job does not spend returns here when it ends.</p>
          </section>

          <section className="ws-card">
            <div className="ws-card-h"><h2>New work starts on {home.name}</h2><span className="ws-chip">Starknet closed</span></div>
            <ul className="ac-facts">
              <li><b>Your account.</b> Sage keeps an account for you on {home.name} and launches every job from it inside a mandate, so you fund once instead of signing each launch. It opens when you sign in with your email or MetaMask.</li>
              <li><b>What stays here.</b> Your Starknet jobs, vaults and receipts stay exactly as they are, and claim links still pay. <Link href="/docs/payments#account">How the account works →</Link></li>
            </ul>
          </section>
        </div>

        <div>
          <section className="ws-card">
            <div className="ws-card-h"><h2>Your work on Starknet</h2><Link className="ws-chip" href="/workspace/jobs">all jobs →</Link></div>
            {posted.length === 0 ? (
              <p className="ac-empty">Nothing here. New work starts on {home.name}: sign in with your email or MetaMask to post it.</p>
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
          <span className="ws-eyebrow">Account</span>
          <h1 className="ws-title">Not configured here.</h1>
          <p className="ws-sub">Accounts are wallets Privy holds under a mandate, and this deployment has no Privy app configured, so nothing can launch here until it is.</p>
        </div>
      </header>
    </main>
  );
}
