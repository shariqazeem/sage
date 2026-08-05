import "server-only";

/**
 * WHAT SAGE SELLS, AND WHAT IT DOES NOT.
 *
 * Sage was one tool on the marketplace: "design a testing plan", which takes minutes and only pays
 * off if you want a whole campaign. Nothing else it can do was callable, so nothing else could be
 * bought. This is the catalogue that fixes that, and it is the single source of truth for two things
 * that must never disagree — what the paywall charges, and what the listing advertises. OKX
 * validates price-match between them, and a mismatch reads as a broken service.
 *
 * THE RULE FOR WHAT IS FREE: you pay for work Sage does, never for reading back work you already
 * bought, and never for checking whether Sage told the truth.
 *
 * So polling an inspection you paid for is free, answering Sage's own clarifying question about it
 * is free, and verifying a payout receipt is free — that last one especially, because "anyone can
 * verify our receipts" is a claim we make, and charging admission to it would make the claim
 * smaller than it sounds. Discovery is free too: the tool list, the service card, the mission board.
 */

export interface PricedService {
  /** the MCP tool this service calls. */
  tool: string;
  /** the marketplace-facing name. 5-30 chars, and must differ from the agent name. */
  serviceName: string;
  /** single-purchase price in USD₮0. The marketplace listing must carry this exact number. */
  priceUsd: number;
  /** one line, used in the 402 challenge's resource description. */
  summary: string;
}

/**
 * The paid catalogue. Prices reflect what the work costs us: a fetch-and-read is cheap, a judgment
 * against a live product is the differentiated one, and a full inspection is minutes of real
 * browsing plus several model calls.
 */
export const PAID_SERVICES: readonly PricedService[] = [
  {
    tool: "sage_first_look",
    serviceName: "Live page check",
    priceUsd: 0.05,
    summary: "Open a URL now and report where it landed, its title, headings, and what is clickable.",
  },
  {
    tool: "sage_check_evidence",
    serviceName: "Evidence authenticity check",
    priceUsd: 0.1,
    summary:
      "Decide whether a written account of using a product came from someone who actually opened it, by matching it against the product's own live content.",
  },
  {
    tool: "sage_goal_checkpoints",
    serviceName: "Goal to test checkpoints",
    priceUsd: 0.05,
    summary:
      "Turn a product goal in plain language into the ordered checkpoints a first-time user must complete, each independently checkable.",
  },
  {
    tool: "sage_start_inspection",
    serviceName: "Product testing plan design",
    priceUsd: 0.3,
    summary:
      "Browse a live product in a real browser and design paid testing missions with checkable pass criteria, required evidence, and an exact budget split.",
  },
] as const;

const BY_TOOL: ReadonlyMap<string, PricedService> = new Map(
  PAID_SERVICES.map((s) => [s.tool, s]),
);

/** The price of one tool, or null when it is free. */
export function priceOf(tool: string): PricedService | null {
  return BY_TOOL.get(tool) ?? null;
}

export function isPaidTool(tool: string): boolean {
  return BY_TOOL.has(tool);
}

/** The public URL a paid service is called at. Each service is its own resource. */
export function serviceEndpoint(tool: string, origin = "https://sagepays.xyz"): string {
  return `${origin}/mcp/public/${tool}`;
}
