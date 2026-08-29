"use client";

import { Eye, EyeOff } from "lucide-react";

import type { SettlementRail } from "@/lib/db/schema";

/**
 * WHERE A FOUNDER CHOOSES HOW THEIR CAMPAIGN PAYS.
 *
 * This is the one chain-shaped question a founder is asked, and it is asked because the answer is
 * genuinely theirs: it decides whether the payments they fund are public, and public receipts are
 * an asset for some programmes and a liability for the people being paid by others. Sage cannot
 * work that out from a product URL.
 *
 * IT IS NOT PHRASED AS A CHAIN CHOICE, because that is not the decision. A founder is hiring
 * testing, not selecting infrastructure; asked "GOAT or Starknet?" they would be guessing about
 * something they have no way to evaluate. Asked "should the amounts be public?" they know the
 * answer immediately, and the chain follows from it.
 *
 * BOTH OPTIONS STATE THEIR COST. Public means a tester's income is visible to anyone with their
 * address, forever. Private means the campaign settles somewhere fewer venues list, and the
 * privacy is the WORKER's to use rather than automatic. Neither is presented as the safe default,
 * because for different founders neither is.
 */
export function RailChoice({
  value,
  onChange,
  disabled,
}: {
  value: SettlementRail;
  onChange: (rail: SettlementRail) => void;
  disabled?: boolean;
}) {
  return (
    <div className="lx-rails" role="radiogroup" aria-label="How this campaign pays">
      <button
        type="button"
        role="radio"
        aria-checked={value === "evm"}
        className={`lx-rail${value === "evm" ? " is-on" : ""}`}
        onClick={() => onChange("evm")}
        disabled={disabled}
      >
        <span className="lx-rail-h">
          <Eye size={15} aria-hidden /> Public receipts
        </span>
        <span className="lx-rail-b">
          Every payout is a public transaction anyone can verify — the right choice when you have to
          show a programme, a funder or an auditor where the money went.
        </span>
        <span className="lx-rail-n">
          The trade: a tester&rsquo;s earnings are visible to anyone holding their address.
        </span>
      </button>

      <button
        type="button"
        role="radio"
        aria-checked={value === "starknet"}
        className={`lx-rail${value === "starknet" ? " is-on" : ""}`}
        onClick={() => onChange("starknet")}
        disabled={disabled}
      >
        <span className="lx-rail-h">
          <EyeOff size={15} aria-hidden /> Private-capable
        </span>
        <span className="lx-rail-b">
          Payouts settle on Starknet, where a tester can choose to receive into a shielded note and
          keep their income off a public graph. Sage still pays them automatically.
        </span>
        <span className="lx-rail-n">
          The trade: privacy is the tester&rsquo;s to use, not automatic — and fewer exchanges list
          this network directly.
        </span>
      </button>
    </div>
  );
}
