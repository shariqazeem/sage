import type { Metadata } from "next";
import Link from "next/link";
import { siteUrl } from "@/lib/site";
import { Doc, Next } from "../parts";

export const metadata: Metadata = {
  title: "Private payouts on Starknet — being paid without publishing what you earn",
  description:
    "Sage settles on Starknet through a Cairo vault and a Poseidon commitment, so a worker is paid without the payout landing in their wallet. What is private and what stays public, stated line by line and checkable against the chain.",
  alternates: { canonical: `${siteUrl()}/docs/privacy` },
};

export default function Privacy() {
  return (
    <Doc crumb="Guarantees">
      <h1>Private payouts</h1>

      <div className="prose-answer">
        <p>
          <strong>Getting paid should not publish what you earn.</strong> On Starknet, Sage releases
          the reward from a Cairo vault and escrows it behind a Poseidon commitment. The worker
          collects with a one-time link, to any address they name — so the money never lands in the
          wallet that did the work, and nobody can follow it to their balance.
        </p>
      </div>

      <h2>The problem this exists for</h2>
      <p>
        Every ordinary on-chain payout writes a permanent, searchable line: this address earned this
        much, from this campaign, on this day. For someone whose earnings here are a real part of
        what they live on, that is an income statement posted publicly, forever — and it is
        published by the act of being paid, which nobody chooses.
      </p>

      <h2>Two halves</h2>
      <ol>
        <li>
          <strong>The vault releases.</strong> A Cairo <code>SageVault</code> looks the reward up
          from the mission — the amount is not an argument any caller can pass — and enforces the
          funding ceiling and per-wallet replay itself. A refused payout answers with a{" "}
          <em>code</em> rather than reverting, so the reason lands on chain where the person refused
          can read it.
        </li>
        <li>
          <strong>Sage escrows.</strong> The money moves into <code>SageClaims</code> against{" "}
          <code>poseidon(secret)</code>, which names nobody. The worker collects with a one-time
          link. A wallet registered with the STRK20 pool can take it straight into a shielded note;
          everyone else names an address.
        </li>
      </ol>

      <h2>Nothing is needed to collect</h2>
      <p>
        <code>claim_to_address</code> is ungated by design — the preimage is the authority, not the
        caller — so Sage relays the transaction and pays the gas. A worker holding no tokens, who has
        never used Starknet, whose account is not even deployed, can still be paid. A rail that ends
        in an asset nobody can move has transferred a number, not capital.
      </p>

      <h2>What is private, exactly</h2>
      <p>
        Written this precisely because every line is checkable against the chain. A claim that can be
        falsified with one block-explorer query is worth less than a narrower one that holds.
      </p>
      <table>
        <thead>
          <tr>
            <th>&nbsp;</th>
            <th>&nbsp;</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>Private</strong></td>
            <td>Who was on a payout list, and who collected. A commitment names nobody, and the collection leg is keyed by the hash rather than by a person.</td>
          </tr>
          <tr>
            <td><strong>Private</strong></td>
            <td>Where the money ends up. It never lands in the wallet that did the work; the destination is named at collection.</td>
          </tr>
          <tr>
            <td><strong>Public</strong></td>
            <td>Funding — the total and the timing of it.</td>
          </tr>
          <tr>
            <td><strong>Public</strong></td>
            <td>
              The vault&apos;s spending — every amount, mission and decision digest. Auditable, and
              no longer attributable to a person.
            </td>
          </tr>
          <tr>
            <td><strong>Public</strong></td>
            <td>The address named at the public collection door, for that leg only.</td>
          </tr>
        </tbody>
      </table>
      <h2>The approval record used to name you</h2>
      <p>
        <code>PayoutReleased</code> carried the worker as an <em>indexed</em> key, so filtering by a
        wallet and totalling everything Sage ever paid it was one block-explorer query. A private
        destination with a public approval record is not a private payout. It now emits an opaque
        intent hash instead; replay protection is untouched, because it keys on the worker in
        storage and never needed the event.
      </p>
      <p>
        Writing the test for that found a second one. <code>PayoutRefused</code> named the recipient
        too — a public, searchable record of someone being <em>turned down</em>, which on a privacy
        rail is the last thing that should be attributable. Both events now identify the attempt
        rather than the person, and the refused party can still find their own refusal because the
        intent hash derives from their campaign and submission.
      </p>
      <p>
        <em>
          Written and tested; not yet the deployed class. The live campaign proving this rail runs
          on the existing one, and swapping classes underneath it before that is proven would risk
          the thing it demonstrates.
        </em>
      </p>

      <h2>What stays public on purpose</h2>
      <p>
        Every figure Sage reports remains independently verifiable: amounts, payout counts, batch
        totals and the unclaimed balance are all on chain. Privacy removes the line back to a
        person, not the receipts. That is the shape a regulator asks for and the one a lender can
        work with — <strong>auditable in aggregate, private per person</strong>.
      </p>

      <h2>It runs unattended</h2>
      <p>
        The decision to pay is the autonomous part. An agent judged a real submission, released the
        reward, escrowed it and minted the claim link with no human in the loop — confidence 0.92
        against a 0.85 threshold, judged by a model that cannot state an amount, because the vault
        derives it. Both transactions are on Starknet mainnet and can be read today:{" "}
        <code>0x2b03ed65…49fb</code> released it, <code>0x68ebf197…8af4</code> escrowed it.
      </p>

      <Next
        items={[
          { href: "/docs/settlement", title: "Settlement & proof" },
          { href: "/docs/compliance", title: "Compliance & controls" },
          { href: "/explorer", title: "The live ledger" },
        ]}
      />
      <p className="prose-footer">
        <Link href="/docs">Back to the documentation index</Link>
      </p>
    </Doc>
  );
}
