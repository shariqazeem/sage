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
          <strong>One account, on one chain, that anyone can fund.</strong> Sage can keep a wallet for
          you on Arc — Circle&apos;s chain, where USDC is the gas. Send USDC to it from any wallet or
          exchange, from anywhere. The agent launches work and pays people from it, inside a mandate it
          cannot widen. Withdraw to any address, any time. Nothing else to buy, hold, or find.
        </p>
      </div>

      <p>
        <strong>Where this stands today.</strong> Sage runs on Arc mainnet, in real USDC: the account, the
        mandate and the receipts, the same as on GOAT Network. The first payout settled on 10 October 2026.
        An Ethereum sign-in (a wallet, or the one an email holds) can keep one account per network: GOAT
        Network and Arc are the two tabs of <Link href="/workspace/account">your account page</Link>, and
        Starknet is the private rail.
      </p>

      <h2>Why Arc</h2>
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
        <li><strong>Fund it</strong> — the address and a QR code on <Link href="/workspace/account?chain=5042">the Arc tab of your account page</Link>. Send USDC on Arc from any wallet or exchange that supports it.</li>
        <li><strong>Use it</strong> — <Link href="/launch">post work</Link>, or <Link href="/workspace/autopilot">let Sage run it</Link>: the agent proposes each move with its reason and launches inside your ceilings.</li>
        <li><strong>Withdraw</strong> — to any address on the chain. The activity list is read from the chain itself, not from a table of ours.</li>
      </ul>

      <h2>What is proven on Arc mainnet</h2>
      <ul>
        <li>The V2 CampaignVault factory is deployed at <code>0xdD9a45c181dD95e48CDdC0149C8b821D604C45C9</code>, the same contract as on GOAT Network.</li>
        <li>An account launched a gig from its own wallet — create, approve, fund, activate, signed inside the mandate — and a worker who submitted a public page was judged and paid $1.01 in real USDC, with <Link href="/proof/0x83aef6d39781b020de1421ca8e7042fe8a6af781fe31a249e3fe9f5d9ebff522">a receipt</Link>. Nobody touched a key and nobody approved the payment.</li>
      </ul>
      <p>
        GOAT Network and Starknet stay exactly as they are: GOAT holds the first forty-one real payouts,
        Starknet is the private rail. Nothing about a campaign already running on either changes.
      </p>

      <h2>For teams and organisations</h2>
      <p>
        A workspace owner&apos;s account is the organisation&apos;s wallet. Members are paid from vaults the
        account funds; the owner sees every move, every receipt, and can withdraw what is unspent. A
        cooperative in Kingston, a programme funding forty MSMEs, a company paying contributors across
        the world — the same account, funded in USDC from wherever the money is.
      </p>

      <Next items={[{ href: "/docs/settlement", title: "Settlement & proof" }, { href: "/workspace/account?chain=5042", title: "Your account on Arc" }]} />
    </Doc>
  );
}
