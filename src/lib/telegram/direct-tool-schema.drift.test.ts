import { describe, expect, it } from "vitest";
import { DIRECT_CAMPAIGN_TOOL } from "./concierge";
import { directCampaignSchema } from "@/lib/launch/direct-campaign";

/**
 * TWO LISTS THAT DRIFT — the compiler's zod schema and the JSON schema the MODEL is shown. P-DIRECT
 * 2026-09-03: a grant priced in a local currency failed to compile on every attempt because the tool
 * schema never declared `currency` (or a milestone's `rewardLocal`), while the field descriptions told
 * the model to pass exactly those. The model cannot send what it is not shown. This test reads both.
 */
/** keys of a zod object, looking through effects (superRefine), optional/default wrappers and arrays. */
function zodKeys(schema: unknown): string[] {
  const s = schema as { shape?: Record<string, unknown>; _def?: { schema?: unknown; innerType?: unknown; element?: unknown } };
  if (s.shape) return Object.keys(s.shape);
  const inner = s._def?.schema ?? s._def?.innerType ?? s._def?.element; // zod v4: an array's item is `_def.element`
  return inner ? zodKeys(inner) : [];
}
function shapeOf(schema: unknown): Record<string, unknown> {
  const s = schema as { shape?: Record<string, unknown>; _def?: { schema?: unknown; innerType?: unknown } };
  if (s.shape) return s.shape;
  const inner = s._def?.schema ?? s._def?.innerType;
  return inner ? shapeOf(inner) : {};
}

describe("the direct tool schema declares every field the compiler accepts", () => {
  const props = (DIRECT_CAMPAIGN_TOOL.inputSchema as { properties: Record<string, unknown> }).properties;
  const milestoneProps = (props.milestones as { items: { properties: Record<string, unknown> } }).items.properties;

  /** compiler key → the name the TOOL exposes it under (the concierge maps recipients → allowlist). */
  const ALIAS: Record<string, string> = { allowlist: "recipients" };

  it("top-level keys", () => {
    const zod = zodKeys(directCampaignSchema);
    expect(zod.length).toBeGreaterThan(5);
    const missing = zod.filter((k) => !((ALIAS[k] ?? k) in props));
    expect(missing).toEqual([]);
    expect(props.currency).toBeDefined();
  });

  it("milestone keys", () => {
    const itemZod = zodKeys(shapeOf(directCampaignSchema).milestones);
    expect(itemZod.length).toBeGreaterThan(3);
    const missing = itemZod.filter((k) => !(k in milestoneProps));
    expect(missing).toEqual([]);
    expect(milestoneProps.rewardLocal).toBeDefined();
  });
});
