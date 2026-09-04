import type { Metadata } from "next";
import Link from "next/link";
import { siteUrl } from "@/lib/site";
import {
  OFAC_SDN_SNAPSHOT_DATE,
  SANCTIONS_LIST_SIZE,
} from "@/lib/deputy/sanctions";
import { Doc, Next } from "../parts";

export const metadata: Metadata = {
  title: "Compliance & controls — screening, caps, and a public audit trail",
  description:
    "Sage's compliance posture is structural: OFAC SDN sanctions screening on every payout path, on-chain spending limits no model can exceed, and a public receipt for every settlement. What is enforced, what is screened, and what Sage deliberately does not claim.",
  alternates: { canonical: `${siteUrl()}/docs/compliance` },
};

/**
 * The compliance chapter (FC plan #2) — the KYC/AML-adjacent story told the only way Sage tells
 * stories: name the mechanism, show the artifact. Every claim on this page is either enforced by
 * code that ships in this repo or explicitly listed under "what Sage does not claim".
 */
export default function Compliance() {
  return (
    <Doc crumb="Guarantees">
      <h1>Compliance &amp; controls</h1>

      <div className="prose-answer">
        <p>
          <strong>Compliance here is structural, like everything else:</strong> the controls are
          code on the money path, not a policy document. Every EVM payout recipient is screened against
          the U.S. Treasury&rsquo;s OFAC SDN digital-currency list, every spend happens inside
          on-chain limits no model can exceed, and every settlement produces a public, permanent
          receipt — an audit trail that exists <em>by construction</em>, not on request.
        </p>
      </div>

      <h2>The controls</h2>
      <div className="prose-table-scroll">
        <table>
          <thead>
            <tr>
              <th>Control</th>
              <th>What enforces it</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Sanctions screening</td>
              <td>
                Every EVM recipient wallet is checked against the OFAC SDN digital-currency list at
                every door: web and chat submission, the autonomous payout preflight, and manual
                release. A listed address is refused before any judging happens and cannot be paid
                by the AI or by a human clicking release. The SDN list carries no Starknet
                addresses, so the private rail is screened at its EVM funding side only.
              </td>
            </tr>
            <tr>
              <td>Bounded spending</td>
              <td>
                The campaign vault enforces the budget, per-mission rewards, completion caps, and a
                daily velocity limit on-chain. The AI proposes; the contract computes every amount
                and rejects anything outside its limits.
              </td>
            </tr>
            <tr>
              <td>Mandated agent wallets</td>
              <td>
                A founder&rsquo;s walletless agent wallet operates under a standing policy — an
                allow-list of exactly which contracts it may call with which funds, with a
                per-campaign cap the founder set. The policy is enforced by the wallet
                infrastructure, not by prompt.
              </td>
            </tr>
            <tr>
              <td>Verification before payment</td>
              <td>
                Work is checked before money moves — a deterministic contract check first (fetch
                the artifact, read the chain), the model second, and the model never states an
                amount. Work that fails verification is refused with the reason.
              </td>
            </tr>
            <tr>
              <td>Sybil resistance</td>
              <td>
                Near-duplicate detection across submissions, artifact-content fingerprinting,
                per-wallet payout caps, daily submission limits, wallet-freshness signals, and{" "}
                <strong>funding-graph sibling detection</strong> — which reads the public chain to
                see when several &ldquo;different&rdquo; submitters were funded by one wallet. Built
                after a real rotation cluster was found on a live campaign; every signal informs the
                operator and none of them refuses a payout alone.
              </td>
            </tr>
            <tr>
              <td>Public auditability</td>
              <td>
                Every payout settles as an on-chain transaction with a public{" "}
                <Link href="/docs/settlement">proof receipt</Link> citing the verified evidence,
                and accumulates into the recipient&rsquo;s permanent{" "}
                <Link href="/record/0xccbfb9bba88f282282a29aa1338175cc835e768d">work record</Link>{" "}
                — both machine-readable.
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>Sanctions screening, precisely</h2>
      <p>
        The screen runs against a <strong>vendored snapshot</strong> of the OFAC SDN list&rsquo;s
        &ldquo;Digital Currency Address&nbsp;&mdash;&nbsp;ETH&rdquo; entries — currently{" "}
        <strong>{SANCTIONS_LIST_SIZE} addresses, snapshot {OFAC_SDN_SNAPSHOT_DATE}</strong> —
        matched exactly and case-insensitively. It is deliberately <em>not</em> a runtime API call:
        the money path takes no third-party dependency, the check is reproducible byte-for-byte,
        and refreshing the list is a reviewed code change with a visible diff, never a silent
        remote update. A hold produced by the screen names the list and the snapshot date in its
        reason, so the audit trail records <em>which</em> list said no.
      </p>

      <h2>Why the refusal rate is a compliance feature</h2>
      <p>
        Sage publishes its held-or-refused share next to its payout numbers. A payment rail that
        pays everything is not a rail, it is a leak — the refusals are what make each payment mean
        something. Every refusal is recorded with its reason, and every payment can show its work:
        who was paid, for what verified evidence, under which caps, on which transaction.
      </p>

      <h2>What Sage does not claim</h2>
      <ul>
        <li>
          <strong>No identity KYC.</strong> Participants are pseudonymous wallets. Sage screens
          wallets against sanctions lists and applies Sybil controls; it does not verify legal
          identity. Operators who need named recipients use invite-only campaigns, where the
          recipient list is the operator&rsquo;s own.
        </li>
        <li>
          <strong>Screening is list-based.</strong> An address absent from the SDN snapshot passes
          the screen; the screen is as current as its snapshot date, which is printed above and on
          every hold it produces.
        </li>
        <li>
          <strong>Custody is stated, not hidden.</strong> Walletless agent and recipient wallets
          are provider-held server wallets bound to policies — convenient and bounded, but not
          self-custody, and the docs say so wherever they appear. Recipients are never trapped:
          they can cash out to any address of their choosing from chat at any time, signing a
          gasless authorization while Sage pays the network fee.
        </li>
      </ul>

      <Next
        items={[
          { href: "/docs/safety", title: "The safety model", label: "Related" },
          { href: "/docs/settlement", title: "Settlement & proof", label: "Next" },
        ]}
      />
    </Doc>
  );
}
