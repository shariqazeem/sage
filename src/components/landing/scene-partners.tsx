import { Reveal } from "./reveal";

/**
 * THE STACK BAND — the quiet credibility strip under the hero, where serious products put the
 * names they ship with. Text wordmarks only (no logo soup): each mark is the name in its own
 * weight with a one-line mono role underneath, staggered into view. GOAT settles the money,
 * Metis is the ecosystem it grew in, ClawUp is who it tests first — all three are true claims
 * backed elsewhere on the page, which is what keeps this from being a sticker wall.
 */
const MARKS: { name: string; role: string; href: string }[] = [
  { name: "GOAT Network", role: "public receipts · real USDC · the first 41 payouts", href: "https://www.goat.network" },
  // The second mainnet rail. It was missing from the strip that says what Sage ships with, on
  // the same day the page's numbers were GOAT-only — the front door kept erasing the rail.
  { name: "Starknet", role: "private-capable payouts · Cairo vault + claims", href: "https://www.starknet.io" },
  // Circle's chain, where USDC is the gas: proven on its testnet (10 Sep 2026), the default rail the
  // day its mainnet opens. Listed after the two mainnets because a mainnet product does not lead
  // with a testnet — the founder's rule: GOAT and Starknet primary until Arc goes mainnet.
  { name: "Arc", role: "USDC is the gas · one account, fund from anywhere · testnet now, mainnet next", href: "https://www.arc.network" },
  { name: "Metis", role: "ecosystem · Stage 2 bootcamp", href: "https://www.metis.io" },
  { name: "ClawUp", role: "first builder campaigns", href: "https://clawup.org" },
];

export function ScenePartners() {
  return (
    <section className="partners" aria-label="Ecosystem">
      <Reveal className="reveal wrap partners-in">
        <span className="partners-kicker mono">Ships with</span>
        <div className="partners-row">
          {MARKS.map((m, i) => (
            <a
              key={m.name}
              className="partners-mark"
              href={m.href}
              target="_blank"
              rel="noopener noreferrer"
              style={{ ["--d" as string]: `${120 + i * 110}ms` }}
            >
              <span className="partners-name">{m.name}</span>
              <span className="partners-role mono">{m.role}</span>
            </a>
          ))}
        </div>
      </Reveal>
    </section>
  );
}
