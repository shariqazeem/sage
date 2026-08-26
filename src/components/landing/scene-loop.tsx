import Link from "next/link";
import { Check, ReceiptText } from "lucide-react";
import { Reveal } from "./reveal";

/**
 * ONE LOOP — the transformation scene (FC plan #4). Product testing, gigs, and milestone grants
 * are the SAME loop: define → verify → pay-or-refuse → public receipt. Testing is presented as
 * the hardest case (Sage authors its own answer key), not a separate product. Every artifact in
 * the panel is a REAL mainnet receipt — the first autonomous payout, the first AI-earned payout,
 * and that AI's permanent work record. No fabricated numbers, ever (the standing landing rule).
 */
export function SceneLoop() {
  return (
    <section className="pol scene" aria-label="One loop for any work">
      <div className="wrap pol-grid">
        <Reveal className="reveal pol-copy">
          <span className="eyebrow">One loop, any work</span>
          <h2 className="h2">Product tests, gigs, milestone grants — one loop pays them all.</h2>
          <p className="lede pol-lede">
            Say the work in a sentence — &ldquo;test my product&rdquo;, or &ldquo;pay my designer
            $50 when the logo page is live&rdquo;. Sage compiles it into missions with a
            verification contract, then checks every claim itself — in a real browser, against a
            published artifact, or on-chain — and pays only what survives. Testing is simply the
            hardest case: there, Sage writes the answer key too.
          </p>
          <p className="pol-sub mono">
            Humans and AI agents earn under identical rules — same signed claim, same judge, same
            vault. Work that fails verification is refused, with the reason on the record.
          </p>
        </Reveal>

        <Reveal className="reveal pol-panel-wrap" threshold={0.2}>
          <div className="pol-panel">
            <div className="pol-panel-h">
              <span className="pol-panel-ic"><ReceiptText size={15} strokeWidth={2} /></span>
              <span>Receipts, not claims</span>
              <span className="pol-panel-tag mono">GOAT Mainnet</span>
            </div>
            <ul className="pol-rules">
              <li>
                <span className="pol-rule-k mono">First autonomous payout</span>
                <Link
                  className="pol-rule-v mono"
                  href="/proof/0x8df7767860692a12fed6f90fe8a88d9a103686bbaa9ceee3d067a1e7c6250069"
                >
                  $1.00 · receipt →
                </Link>
              </li>
              <li>
                <span className="pol-rule-k mono">An AI earned, same rules</span>
                <Link
                  className="pol-rule-v mono"
                  href="/proof/0xb0120330aba99dcf25d5aba913d1c8ecf341782653f1b20b4eaafa575155d827"
                >
                  $0.50 · receipt →
                </Link>
              </li>
              <li>
                <span className="pol-rule-k mono">That AI&rsquo;s work record</span>
                <Link
                  className="pol-rule-v mono"
                  href="/record/0xccbfb9bba88f282282a29aa1338175cc835e768d"
                >
                  verified history →
                </Link>
              </li>
              <li>
                <span className="pol-rule-k mono">Recipient needs a wallet?</span>
                <span className="pol-rule-v mono">no — chat is the account</span>
              </li>
            </ul>
            <div className="pol-gate">
              <div className="pol-gate-h mono">Every payout, before it moves</div>
              <div className="pol-gate-list">
                <span className="pol-sig"><Check size={12} strokeWidth={3} /> claim verified</span>
                <span className="pol-sig"><Check size={12} strokeWidth={3} /> sanctions screened</span>
                <span className="pol-sig"><Check size={12} strokeWidth={3} /> inside on-chain caps</span>
                <span className="pol-sig"><Check size={12} strokeWidth={3} /> public receipt</span>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
