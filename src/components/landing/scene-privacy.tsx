import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Reveal } from "./reveal";

/**
 * PRIVACY — being paid without publishing what you earn.
 *
 * The landing had no mention of Starknet or the private rail anywhere, so anyone arriving to look
 * at THAT — a judge, a Starknet user, someone sent the link by the launch post — found a page about
 * product testing and had to guess. The rail is the newest and most differentiated thing Sage does.
 *
 * Placed after Proof and before Capital, which is the argument in order: the money moved and you can
 * check it · it moved without exposing the person · and what it leaves behind is underwritable.
 *
 * The scope table is deliberate. Every line is checkable against the chain in a minute, which is
 * exactly why it is written this precisely instead of as "private payouts" — a claim someone can
 * falsify with one explorer query is worth less than a narrower one that holds.
 */
export function ScenePrivacy() {
  return (
    <section className="prv" id="privacy" aria-label="Private payouts on Starknet">
      <Reveal className="reveal prv-in">
        <span className="eyebrow prv-eyebrow">
          <span className="dot" aria-hidden />
          Private payouts · Starknet
        </span>

        <h2 className="prv-h">
          Getting paid should not
          <br />
          <span className="soft">publish what you earn.</span>
        </h2>

        <p className="prv-lede">
          Every on-chain payout writes a permanent, searchable line: this address earned this much,
          from this campaign, on this day. For someone whose testing income is a real part of what
          they earn, that is an income statement posted publicly, forever. So on Starknet, Sage pays
          in two halves.
        </p>

        <div className="prv-steps">
          <div className="prv-step">
            <span className="prv-n mono">01</span>
            <p>
              A Cairo vault releases the reward. The amount is not an argument the agent can pass —
              the vault looks it up from the mission itself, and enforces the ceiling and per-wallet
              replay on its own.
            </p>
          </div>
          <div className="prv-step">
            <span className="prv-n mono">02</span>
            <p>
              Sage escrows it against a Poseidon commitment, which names nobody. The worker collects
              with a one-time link, to any address — and a wallet registered with the STRK20 pool can
              take it straight into a shielded note.
            </p>
          </div>
        </div>

        <p className="prv-lede prv-tight">
          Sage pays the gas to collect, so a worker holding no tokens — whose account is not even
          deployed — can still be paid.
        </p>

        <div className="prv-scope">
          <div className="prv-scope-h mono">What is private, exactly</div>
          <ul>
            <li><b>Private</b> — who was on a payout list, and who collected.</li>
            <li><b>Private</b> — where the money ends up. It never lands in the worker&apos;s wallet.</li>
            <li><b>Public</b> — the funding total and timing, and the vault&apos;s approval record.</li>
          </ul>
          <p className="prv-note">
            Written this precisely because every line is checkable against the chain. A claim that
            can be falsified with one explorer query is worth less than a narrower one that holds.
          </p>
        </div>

        <div className="prv-actions">
          <Link href="/explorer" className="prv-link">
            Every settlement, including the private rail <ArrowRight size={13} strokeWidth={2} />
          </Link>
          <a
            href="https://voyager.online/contract/0x6fe4d02056825f06683604f8a98912504cf86bce0de5ff19b424995eb1cf57"
            className="prv-link"
            target="_blank"
            rel="noreferrer"
          >
            SageClaims on Starknet mainnet <ArrowRight size={13} strokeWidth={2} />
          </a>
        </div>
      </Reveal>
    </section>
  );
}
