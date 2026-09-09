import type { Metadata } from "next";
import Link from "next/link";
import { siteUrl } from "@/lib/site";
import { Doc, Next } from "../parts";

export const metadata: Metadata = {
  title: "Sage on Arc — one account, fund it from anywhere, withdraw anywhere",
  description:
    "Sage keeps a wallet for you on Arc, Circle's chain, where USDC is the gas. Send USDC to it from any wallet or exchange; the agent launches and pays from it inside your mandate; withdraw to any address.",
  alternates: { canonical: `${siteUrl()}/docs/arc` },
};

export default function ArcDoc() {
  return (
    <Doc crumb="Money">
      <h1>Sage on Arc</h1>

      <div className="prose-answer">
        <p>
          <strong>One account, on one chain, that anyone can fund.</strong> When you sign in, Sage keeps a
          wallet for you on Arc — Circle&apos;s chain, where USDC is the gas. Send USDC to it from any wallet
          or exchange, from anywhere. The agent launches work and pays people from it, inside a mandate it
          cannot widen. Withdraw to any address, any time. Nothing else to buy, hold, or find.
        </p>
      </div>

      <h2>Why Arc is the default</h2>
      <ul>
        <li><strong>USDC is the gas.</strong> On every other chain a funded account still needed a second token — BTC on GOAT, ETH elsewhere — before it could move. On Arc the USDC you deposit pays for its own transactions. Funding is the whole setup.</li>
        <li><strong>The same money everywhere.</strong> The account holds USDC; the vaults hold USDC; the receipts are in USDC; a worker is paid in USDC. No wrapped anything, no bridge in the middle of a payout.</li>
        <li><strong>Stablecoin-native rails.</strong> Circle&apos;s tooling on Arc is built for exactly this: programmable dollars, payments, treasuries.</li>
      </ul>

      <h2>What the account is</h2>
      <p>
        A wallet held by Privy for you, born under a <em>mandate</em>: an on-chain policy that lets the
        agent create a campaign vault through Sage&apos;s factory, fund it up to your per-campaign cap,
        and activate it — and nothing else. Unspent money can only return to you. A withdrawal attaches a
        one-time permit for the exact address and amount you named, then the account re-locks to the
        mandate, whatever happened.
      </p>
      <ul>
        <li><strong>Fund it</strong> — the address and a QR code on <Link href="/workspace/account">your account page</Link>. On testnet, test USDC comes from Circle&apos;s faucet.</li>
        <li><strong>Use it</strong> — <Link href="/launch">post work</Link>, or <Link href="/workspace/autopilot">let Sage run it</Link>: the agent proposes each move with its reason and launches inside your ceilings.</li>
        <li><strong>Withdraw</strong> — to any address on the chain. The activity list is read from the chain itself, not from a table of ours.</li>
      </ul>

      <h2>What is proven on Arc testnet</h2>
      <ul>
        <li>The V2 CampaignVault factory is deployed at <code>0xfAc019eF6d8B36FE33233244ff0b97f0D9e99B8c</code>.</li>
        <li>An account launched a gig from its own wallet — create, approve, fund, activate, four transactions signed inside the mandate — and a worker who submitted a public page was judged and paid on chain, with a receipt. Nobody touched a key.</li>
        <li>An account withdrew to another address through a scoped permit and re-locked.</li>
      </ul>
      <p>
        Arc mainnet is not open yet. The day it opens, the same account, mandate and receipts move there
        with one registry entry and one factory deploy. GOAT Network and Starknet stay exactly as they are:
        GOAT holds the first forty-one real payouts and remains available behind an explicit choice;
        Starknet is the private rail. Nothing about a campaign already running on either changes.
      </p>

      <h2>For teams and organisations</h2>
      <p>
        A workspace owner&apos;s account is the organisation&apos;s wallet. Members are paid from vaults the
        account funds; the owner sees every move, every receipt, and can withdraw what is unspent. A
        cooperative in Kingston, a programme funding forty MSMEs, a company paying contributors across
        the world — the same account, funded in USDC from wherever the money is.
      </p>

      <Next items={[{ href: "/docs/settlement", title: "Settlement & proof" }, { href: "/workspace/account", title: "Your account" }]} />
    </Doc>
  );
}
