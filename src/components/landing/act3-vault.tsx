"use client";

import { Check, X } from "lucide-react";
import { CHECK_NAMES, CHECK_REASONS } from "@/lib/deputy/reasons";
import { usd } from "@/lib/format";
import { useInView } from "./use-in-view";

/**
 * ACT 3 — THE VAULT WORKS. The six on-chain policy checks as a vertical rail.
 * Each row flips from neutral to verified-green with a tick as it scrolls into
 * view — except the per-payout-cap row (check 4), staged as a real on-chain
 * block: it flips red with the exact contract reason. Names + reasons come from
 * src/lib/deputy/reasons.ts so the copy can never drift from the contract order.
 */
export function Act3Vault({ perTxCap }: { perTxCap: number }) {
  const indices = [1, 2, 3, 4, 5, 6];
  return (
    <section className="clx-act clx-act3" aria-label="The vault enforces">
      <div className="clx-act3-in">
        <div className="clx-act3-head">
          <div className="clx-eyebrow clx-mono">Enforced on-chain</div>
          <h2 className="clx-h2">
            Six checks. Every payout. Before a dollar can move.
          </h2>
          <p className="clx-act3-sub">
            The vault runs the same six checks the contract enforces, in order. Pass
            all six and USDC settles. Fail one — even if the agent is wrong or
            compromised — and the payout is blocked before it moves.
          </p>
          <p className="clx-act3-sub clx-why">
            <b>Why on-chain?</b> A database flag that says “budget exceeded” can be
            flipped by whoever runs the database. The vault physically cannot move
            funds off-policy — even if Sage itself is compromised. Enforcement you
            have to trust isn’t enforcement.
          </p>
        </div>

        <ol className="clx-rail">
          {indices.map((i) => (
            <CheckRow
              key={i}
              index={i}
              blocked={i === 4}
              perTxCap={perTxCap}
            />
          ))}
        </ol>
      </div>
    </section>
  );
}

function CheckRow({
  index,
  blocked,
  perTxCap,
}: {
  index: number;
  blocked: boolean;
  perTxCap: number;
}) {
  const { ref, inView } = useInView<HTMLLIElement>({ threshold: 0.5 });
  const state = inView ? (blocked ? "blocked" : "verified") : "idle";

  return (
    <li ref={ref} className={`clx-check state-${state}`}>
      <span className="clx-check-n clx-mono">
        {String(index).padStart(2, "0")}
      </span>
      <span className="clx-check-body">
        <span className="clx-check-name">{CHECK_NAMES[index]}</span>
        <span className="clx-check-detail">
          {blocked ? CHECK_REASONS[index] : "checked and clear"}
        </span>
      </span>
      {blocked && (
        <span className="clx-check-chip clx-mono">
          cap {usd(perTxCap)}
        </span>
      )}
      <span className="clx-check-mark" aria-hidden>
        {blocked ? (
          <X size={16} strokeWidth={3} />
        ) : (
          <Check size={16} strokeWidth={3} />
        )}
      </span>
      <span className="clx-check-status clx-mono">
        {blocked ? "Blocked" : "Verified"}
      </span>
    </li>
  );
}
