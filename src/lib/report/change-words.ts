/**
 * The words for how a problem changed since the builder's last test (changed.ts), in a module that imports
 * nothing. The report component runs in the browser: importing these from changed.ts pulled report/core.ts,
 * and through it the drafter, the model wire and the database, into the client bundle, and `next build`
 * refused it (found on a staging build, 22 Nov 2026; type checks and unit tests cannot see it).
 */
export type ProblemChange = "gone" | "fewer" | "still";

export const CHANGE_WORDS: Record<ProblemChange, string> = { gone: "Gone this time", fewer: "Fewer people hit it", still: "Still hit" };
