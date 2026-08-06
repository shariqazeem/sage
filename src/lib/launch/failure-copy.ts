/**
 * ONE plain-English sentence for a failed inspection — shared by every surface that speaks to a
 * founder (the web plan page, the Telegram/web agent, the API's human-facing notes).
 *
 * Two rules:
 *   1. A founder is never handed an engineering code. Internal reasons are namespaced
 *      (`canary_blocked:no_grounded_plan`) and a founder who reads that learns nothing; the ones
 *      who reported it read it as Sage being broken.
 *   2. The sentence says what actually happened and what they can do — never a euphemism, never a
 *      claim that the work succeeded.
 *
 * It lives here, outside both surfaces, so the web and the bot can never drift into telling a
 * founder two different stories about the same failure.
 */
export function friendlyFailure(reason?: string | null): string {
  const r = (reason ?? "").trim();
  if (!r) return "The inspection did not complete.";

  // The covenant family: Sage had a plan but could not fully back it with what it observed, so it
  // refused to publish it. That refusal is the product working — say so.
  if (r.startsWith("canary_blocked:")) {
    return r.includes("no_grounded_plan")
      ? "Sage explored your product but couldn’t design a mission it could back with evidence it actually observed — so it stopped rather than hand you a plan it can’t stand behind. Tell it more precisely what a successful result looks like, or try again."
      : "Sage stopped before publishing a plan it couldn’t fully back with what it observed. Try again, or describe the outcome you want in more detail.";
  }

  // The reaper family: the runner died mid-flight (usually a restart) and auto-retries are spent.
  // The retry genuinely resumes from what was already observed (prior observations are unioned).
  if (r.startsWith("stalled_in_")) {
    return "Sage’s run was interrupted partway (a restart on Sage’s side) and didn’t resume. Retry picks it back up, keeping what it already saw.";
  }

  switch (r) {
    case "llm_not_configured":
      return "Sage’s reviewer is not configured in this environment.";
    case "invalid_json":
    case "truncated_output":
    case "schema_mismatch":
      return "Sage’s reviewer returned an unusable response. This is usually transient — please try again.";
    case "provider_timeout":
    case "provider_transient":
    case "provider_error":
      return "Sage’s reviewer was briefly unavailable. Please try again.";
    case "no_inspected_pages":
      return "Sage couldn’t read anything at that URL — it may be unreachable or blocking automated visits.";
    default:
      // An unrecognised code is still a code. Anything that looks like an identifier gets the
      // generic sentence; a reason already written for humans passes through unchanged.
      return /^[a-z0-9_:.-]+$/.test(r)
        ? "Sage couldn’t finish this inspection. Please try again."
        : r;
  }
}
