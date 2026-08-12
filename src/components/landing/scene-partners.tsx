import { Reveal } from "./reveal";

/**
 * THE STACK BAND — the quiet credibility strip under the hero, where serious products put the
 * names they ship with. Text wordmarks only (no logo soup): each mark is the name in its own
 * weight with a one-line mono role underneath, staggered into view. GOAT settles the money,
 * Metis is the ecosystem it grew in, ClawUp is who it tests first — all three are true claims
 * backed elsewhere on the page, which is what keeps this from being a sticker wall.
 */
const MARKS: { name: string; role: string; href: string }[] = [
  { name: "GOAT Network", role: "settles every payout · real USDC", href: "https://www.goat.network" },
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
