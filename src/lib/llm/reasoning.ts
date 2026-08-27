/**
 * Provider reasoning-prefix normalisation — shared, so there is exactly ONE implementation.
 *
 * Some models (MiniMax-M3) always emit a leading `<think>…</think>` block and ignore
 * response_format, so every caller that shows or parses model output has to strip it. The payout
 * brain has needed this since 2026-08-25; the concierge started needing it the moment the Telegram
 * bot was pointed at the same provider, and without it the founder's reply literally opened with
 * Sage's internal monologue (measured 2026-08-28).
 *
 * It lives here rather than in either caller because brain.ts is the frozen judgment layer and the
 * concierge deliberately never imports it. A shared helper keeps that boundary intact while
 * guaranteeing both strip identically.
 *
 * Deliberately conservative: exactly ONE leading, CLOSED block is removed. An unclosed `<think>`,
 * or one that appears mid-content, is left alone — truncated or embedded reasoning is a signal
 * worth preserving, not something to silently swallow.
 */
export function stripReasoningPrefix(content: string): string {
  const t = content.trimStart();
  if (!t.startsWith("<think>")) return content;
  const close = t.indexOf("</think>");
  if (close === -1) return content;
  return t.slice(close + "</think>".length);
}
