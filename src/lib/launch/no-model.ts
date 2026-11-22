/**
 * SAGE WORKS WITH NO MODEL AT ALL (22 Nov 2026).
 *
 * "Never fails on any model" includes none: an empty account, a spent key, every provider broken, the day's
 * budget reached, or no model configured. A test is still possible and still honest:
 *   - Sage reads the product and, where it has a browser, tries it (neither needs a model to finish);
 *   - the plan is the first-try mission alone, in fixed words, its main action read from the product's own
 *     call to action or heading (`core-mission.ts`), through the same gate as any mission;
 *   - answers are read by the keyword heuristic, which can never pay on its own (CLAUDE.md, invariants), so
 *     each one waits for the builder;
 *   - the findings are grouped in code (`src/lib/report/plain.ts`).
 *
 * This file holds what every surface needs to say so, with no imports, so a client component may read it:
 * the name such a plan is recorded under, which design failures count as "no model answered", and the one
 * line for the builder and the one for the tester.
 */

/** The "model" recorded on a plan written because no model answered. It rides on the approved plan itself. */
export const NO_MODEL_PLAN = "sage/fixed-words-no-model";

/**
 * Why the architect ended with nothing, when the cause is that NO MODEL ANSWERED: none is configured, the
 * account is empty or the key spent (the wire answers both as 402), the model is broken or passed over, it
 * thought its whole budget away, the provider hiccuped or timed out on every try, or the design's clock ran
 * out with nothing ready.
 *
 * NOT here, on purpose: a model that answered with an empty plan (`insufficient_observation`), with a shape
 * nobody could read (`invalid_json`, `schema_mismatch`, `truncated_output`), or with missions the gate then
 * refused (`no_missions_passed_validation`). Those are answers. They say something about the product or the
 * plan, and the builder is asked about it as before.
 */
export const NO_MODEL_REASONS: ReadonlySet<string> = new Set([
  "llm_not_configured",
  "provider_out_of_credit",
  "provider_broken",
  "model_overthinks",
  "provider_transient",
  "provider_timeout",
  "provider_error",
  "design_deadline",
]);

/** Was this plan written with no model? Read from the plan's own record, wherever the plan travels. */
export function planWithoutModel(plan: { modelVersion?: unknown } | null | undefined): boolean {
  return !!plan && plan.modelVersion === NO_MODEL_PLAN;
}

/** The builder's line, on the plan before they pay and on the test's page after. */
export const NO_MODEL_BUILDER_LINE =
  "Sage designed this test without its model today, so it will not pay an answer on its own. Each answer waits for you: read it, then release the payment or say no.";

/** The tester's line: what to do is unchanged; who checks the answer is said plainly. */
export const NO_MODEL_TESTER_LINE = "On this test the builder reads each answer and releases the payment.";
