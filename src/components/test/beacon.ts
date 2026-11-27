/**
 * TELL SAGE WHAT A VISITOR DID ON A TEST'S PAGE (27 Nov 2026), so its builder can see how far people got:
 * that someone saw the test, signed in, or opened the product. Fire and forget: a lost beacon costs one
 * count, never a page. The server keeps a random first-party id and where the visitor came from, never an
 * IP address, and ignores the test's own builder (POST /api/t/<id>/seen).
 */
export type SeenStep = "view" | "opened";

export function tellSage(testId: string, step: SeenStep): void {
  if (typeof window === "undefined") return;
  const via =
    new URLSearchParams(window.location.search).get("via") ?? undefined;
  const body = JSON.stringify({
    step,
    via,
    ref: document.referrer || undefined,
  });
  const url = `/api/t/${encodeURIComponent(testId)}/seen`;
  try {
    // a beacon survives the page being left, which is exactly when "opened the product" happens
    if (
      navigator.sendBeacon?.(
        url,
        new Blob([body], { type: "application/json" }),
      )
    )
      return;
  } catch {
    /* fall through to fetch */
  }
  void fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => undefined);
}
