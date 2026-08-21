import type { Metadata } from "next";
import Link from "next/link";
import { siteUrl } from "@/lib/site";
import { Doc, Next } from "../parts";

export const metadata: Metadata = {
  title: "Interfaces — web, walletless Telegram, and the agent API",
  description:
    "Two front doors, one engine: a browser wallet on sagepays.xyz, or the entire loop walletless from Telegram. Sage is also callable by other agents over MCP, with an ERC-8004 identity and an x402 payment rail.",
  alternates: { canonical: `${siteUrl()}/docs/interfaces` },
};

export default function Interfaces() {
  return (
    <Doc crumb="Interfaces">
      <h1>Web, Telegram &amp; API</h1>

      <div className="prose-answer">
        <p>
          <strong>Two front doors, one engine.</strong> Connect a browser wallet on sagepays.xyz, or
          run the entire loop from a Telegram chat without installing a wallet at all. Both drive the
          same agent, the same vaults and the same settlement path. Sage is also callable by other
          agents over MCP.
        </p>
      </div>

      <h2>The web app</h2>
      <p>
        Sign in with your wallet, paste a product URL and a budget, and Sage inspects, plans and
        shows you the missions it wrote. You approve the plan, deploy the vault, fund it, and the
        campaign goes live on a public board. From then on the founder console shows you every
        tester&rsquo;s written account — including the ones the agent held or refused.
      </p>

      <h2>Walletless, from Telegram</h2>
      <p>
        <a href="https://t.me/sagedeputybot">@sagedeputybot</a> runs the whole loop in chat. Sage mints
        a server wallet bound to a spending policy and funds the campaign from it, so you never
        connect anything or leave the conversation. The full fund-and-launch loop is proven on GOAT
        mainnet.
      </p>
      <p>
        The trade-off is honest and worth stating: a server wallet is custodial in a way a browser
        wallet is not. The spending policy bounds what the agent can do with it, and the campaign
        vault is still yours, but if you want sole custody of the keys, use the web path.
      </p>

      <h2>Agent-to-agent</h2>
      <p>
        Sage exposes an MCP server at <code>/mcp</code> built on the official SDK, with read and
        inspection-start tools: start an inspection, read an inspection, read a campaign, read a
        submission, read a proof. It <strong>provably cannot sign or settle</strong> — a structural
        test fails the build if a money-moving capability is ever exposed through that surface.
      </p>
      <p>
        There is also an authenticated Agent API for programmatic use, which fails closed when no key
        is configured rather than falling open.
      </p>

      <h2>Identity and payments</h2>
      <div className="prose-table-scroll">
        <table>
          <thead>
            <tr>
              <th></th>
              <th>What it is</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>ERC-8004 identity</td>
              <td>Sage has a registered on-chain agent identity, so its record is attached to something durable rather than to a website</td>
            </tr>
            <tr>
              <td>x402</td>
              <td>The payment rail used for evidence verification and operator fees. When it is not configured the system falls back to an honest unpaid bypass rather than pretending</td>
            </tr>
            <tr>
              <td>Networks</td>
              <td>GOAT Network mainnet is where real settlement happens, in real USDC. Metis Sepolia is the test network</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>Public surfaces</h2>
      <p>
        Campaign boards, the mission marketplace, the agent record and every payout receipt are
        public and indexable. Nothing about a payout requires an account to verify — see{" "}
        <Link href="/docs/settlement">Settlement &amp; proof</Link>.
      </p>

      <Next
        items={[
          { href: "/case-studies/autonomous-paid-testing", title: "The case study", label: "See it work" },
          { href: "/launch", title: "Launch a campaign", label: "Or" },
        ]}
      />
    </Doc>
  );
}
