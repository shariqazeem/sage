import type { JobView } from "@/components/launch/types";

type Readiness = NonNullable<JobView["corpusReadiness"]>;

/** The missions whose answers the builder may be asked to release, in plan order, with the server's line. */
export function missionsToRelease(readiness: Readiness | null | undefined, missions: readonly { missionKey: string; title: string }[]): { n: number; title: string; line: string }[] {
  const byKey = new Map((readiness?.missions ?? []).map((m) => [m.missionKey, m.line]));
  return missions.flatMap((m, i) => {
    const line = byKey.get(m.missionKey);
    return line ? [{ n: i + 1, title: m.title, line }] : [];
  });
}

/**
 * ANSWERS THE BUILDER MAY RELEASE (22 Nov 2026). On some missions what Sage can check is also on the
 * mission card or the public page, so it cannot tell a copied answer from a real try and will not pay
 * those alone. The builder reads that here, before paying, in the server's one calm sentence
 * (`RELEASE_LINE`, src/lib/deputy/real-try.ts). Nothing is refused and no mission is dropped.
 */
export function ReleaseLine({ items }: { items: { n: number; title: string; line: string }[] }) {
  if (items.length === 0) return null;
  return (
    <div className="sg-stack sg-gap-2">
      <span className="sg-label">Answers you may release</span>
      <p className="sg-small">
        {items.map((m) => `${String(m.n).padStart(2, "0")} ${m.title}`).join(" · ")}
      </p>
      <p className="sg-small">{items[0]!.line}</p>
    </div>
  );
}
