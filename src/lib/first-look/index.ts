import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { firstLooks } from "@/lib/db/schema";
import { nowSeconds } from "@/lib/db/keys";
import { llmCompleteJson, resolveLlm, type LlmComplete } from "@/lib/llm/complete";
import { completeSteadily } from "@/lib/llm/steady";
import { hostOf } from "@/lib/site/when";
import { enforceFirstLook, FIRST_LOOK_SYSTEM, FIRST_LOOK_VERSION, firstLookUser, plainFirstLook, PLAIN_ENGINE, type FirstLook } from "./core";

/**
 * SAGE'S FIRST LOOK, kept (the core, 21 Nov 2026).
 *
 * Two writes per run, both from the inspection itself:
 *   1. the PLAIN look, the moment the product map exists. No model, so it is there within a second of
 *      the browser closing, and a builder reads it while the missions are still being written;
 *   2. the same look with a model's wording, when a model answers and its answer survives
 *      `enforceFirstLook`. On any failure (no key, out of credit, over the day's budget, an unusable
 *      answer) the plain look simply stays.
 *
 * The model runs on the DRAFT lane: a person is waiting on this page, and it is one short call.
 */

type Complete = (opts: Parameters<typeof llmCompleteJson>[0]) => Promise<Pick<LlmComplete, "json" | "model" | "responseModel">>;
export interface LookDeps {
  complete?: Complete;
  modelConfigured?: () => boolean;
}

interface MapLike {
  productName?: unknown;
  category?: unknown;
  valueProp?: unknown;
  limitations?: unknown;
  fieldTest?: unknown;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

export function saveFirstLook(inspectionId: string, look: FirstLook, now = nowSeconds()): void {
  const values = { json: look as unknown, engine: look.engine, builtAt: now };
  db.insert(firstLooks)
    .values({ inspectionId, ...values })
    .onConflictDoUpdate({ target: firstLooks.inspectionId, set: values })
    .run();
}

/** The stored look, or null. A row from another version of the shape reads as absent. */
export function storedFirstLook(inspectionId: string): FirstLook | null {
  const row = db.select().from(firstLooks).where(eq(firstLooks.inspectionId, inspectionId)).get();
  const look = (row?.json ?? null) as FirstLook | null;
  return look && look.version === FIRST_LOOK_VERSION && Array.isArray(look.problems) && Array.isArray(look.evidence) ? look : null;
}

/** Sage's own plain look at this map. Pure apart from reading the host. */
export function plainLookFor(map: MapLike | null, productUrl: string): FirstLook {
  return plainFirstLook(map, hostOf(productUrl) ?? productUrl);
}

/**
 * Ask a model to word the look. Returns the plain look untouched on ANY failure, and when there is
 * nothing to word (no recorded problem and nothing to compare the first screen against).
 */
export async function wordFirstLook(plain: FirstLook, map: MapLike | null, deps: LookDeps = {}): Promise<FirstLook> {
  const configured = deps.modelConfigured ? deps.modelConfigured() : resolveLlm(undefined, "DRAFT") !== null;
  const worthAsking = plain.problems.length > 0 || (plain.read.evidence.length > 0 && !!plain.read.says);
  if (!configured || !worthAsking) return plain;
  try {
    const complete: Complete = deps.complete ?? llmCompleteJson;
    // The plain look is already on the page, so the wording can wait out a provider's hiccup (steady.ts).
    const res = await completeSteadily(
      complete,
      {
        system: FIRST_LOOK_SYSTEM,
        user: firstLookUser(plain, { name: str(map?.productName), category: str(map?.category) }),
        maxTokens: 1400,
        temperature: 0.2,
        lane: "DRAFT",
      },
      { attempts: 3, budgetMs: 75_000, label: "first-look" },
    );
    const out = enforceFirstLook(res.json, plain, (res.responseModel ?? res.model) || "model");
    if (out.dropped.length > 0) console.warn("[first-look] wordings dropped:", out.dropped.slice(0, 6).join(" | "));
    return out.look;
  } catch (e) {
    console.warn("[first-look] kept Sage's plain wording:", e instanceof Error ? e.message : String(e));
    return plain;
  }
}

/**
 * The inspection's hook. Saves the plain look at once and returns a promise for the worded one, which
 * the caller may await or leave: either way the page already has something true to show. Never throws.
 */
export function recordFirstLook(inspectionId: string, map: MapLike | null, productUrl: string, deps: LookDeps = {}): Promise<FirstLook | null> {
  try {
    const plain = plainLookFor(map, productUrl);
    saveFirstLook(inspectionId, plain);
    return wordFirstLook(plain, map, deps)
      .then((look) => {
        if (look.engine !== PLAIN_ENGINE) saveFirstLook(inspectionId, look);
        return look;
      })
      .catch(() => plain);
  } catch (e) {
    console.warn("[first-look] not recorded:", e instanceof Error ? e.message : String(e));
    return Promise.resolve(null);
  }
}

/**
 * The look a page shows for a job: the stored one, else (a run from before this existed) Sage's plain
 * look built from the stored map right now. Null when there is no map yet.
 */
export function firstLookFor(job: { id: string; productUrl: string; result: unknown }): FirstLook | null {
  const stored = storedFirstLook(job.id);
  if (stored) return stored;
  const map = ((job.result as { map?: MapLike } | null)?.map ?? null) as MapLike | null;
  return map ? plainLookFor(map, job.productUrl) : null;
}
