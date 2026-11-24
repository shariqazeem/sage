/**
 * Fira for the share images (next/og). Satori cannot read woff2 or the page's next/font files, so the
 * TTF is fetched at runtime from Google Fonts: request the family's CSS, take its `format('truetype')`
 * URL, fetch that. Only successes are cached (per process). Any failure returns no fonts, and the card
 * draws in next/og's own default face: a share image is never broken by a font.
 */
type OgFont = { name: string; data: ArrayBuffer; weight: 400 | 500 | 600 | 700 | 800; style: "normal" };

const FACES: { name: string; family: string; weight: OgFont["weight"] }[] = [
  { name: "Fira Sans Extra Condensed", family: "Fira+Sans+Extra+Condensed", weight: 800 },
  { name: "Fira Sans", family: "Fira+Sans", weight: 500 },
  { name: "Fira Mono", family: "Fira+Mono", weight: 500 },
];

const cache = new Map<string, OgFont>();

async function loadFace(face: (typeof FACES)[number]): Promise<OgFont | null> {
  const key = `${face.family}:${face.weight}`;
  const hit = cache.get(key);
  if (hit) return hit;
  try {
    const css = await fetch(`https://fonts.googleapis.com/css2?family=${face.family}:wght@${face.weight}&display=swap`, {
      signal: AbortSignal.timeout(4000),
    }).then((r) => (r.ok ? r.text() : ""));
    const url = /src:\s*url\(([^)]+)\)\s*format\('(?:truetype|opentype)'\)/.exec(css)?.[1];
    if (!url) return null;
    const data = await fetch(url, { signal: AbortSignal.timeout(6000) }).then((r) => (r.ok ? r.arrayBuffer() : null));
    if (!data || data.byteLength < 1000) return null;
    const font: OgFont = { name: face.name, data, weight: face.weight, style: "normal" };
    cache.set(key, font);
    return font;
  } catch {
    return null;
  }
}

/** The faces that loaded (possibly none). Pass as `fonts` to `new ImageResponse(…)`. */
export async function ogFonts(): Promise<OgFont[]> {
  const got = await Promise.all(FACES.map(loadFace));
  return got.filter((f): f is OgFont => f !== null);
}
