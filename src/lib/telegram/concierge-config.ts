/**
 * Concierge LLM provider resolution — kept in its own tiny (non-server-only) module so it
 * unit-tests without importing the whole concierge, and so the money-critical judgment path
 * (brain.ts) and the public chat path have clearly-separate, independently-budgetable providers.
 *
 * The concierge PREFERS a reserved key/base (CONCIERGE_API_KEY / CONCIERGE_BASE_URL): public chat
 * traffic then draws from that budget and can NEVER exhaust the judgment path's quota. When those
 * are unset, resolution falls through to today's exact chain, unchanged.
 */

export function conciergeKey(): string {
  return (
    process.env.CONCIERGE_API_KEY?.trim() ||
    process.env.LLM_API_KEY?.trim() ||
    process.env.COMMONSTACK_API_KEY?.trim() ||
    ""
  );
}

export function conciergeBase(): string {
  return (
    process.env.CONCIERGE_BASE_URL ||
    process.env.LLM_BASE_URL ||
    process.env.COMMONSTACK_BASE_URL ||
    "https://api.commonstack.ai/v1"
  ).replace(/\/+$/, "");
}

export function conciergeModel(): string {
  return (
    process.env.CONCIERGE_MODEL?.trim() ||
    process.env.LLM_MODEL?.trim() ||
    process.env.DEPUTY_MODEL?.trim() ||
    "deepseek/deepseek-v4-flash"
  );
}
