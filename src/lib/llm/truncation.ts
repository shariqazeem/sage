/**
 * DID THE MODEL RUN OUT OF ROOM? — one answer, for production and for the batteries that judge it.
 *
 * A reasoning model's output is prompt-shaped and stochastic, so the same request can fit one call
 * and be cut mid-JSON the next. The provider usually says so (`finish_reason: "length"`), and the
 * concierge re-asks once at the next budget rung on exactly that signal.
 *
 * But it does not ALWAYS say so. Measured on P-DIRECT (pd-gig-translator): a tool call arrived with
 * arguments that end mid-object — `Unexpected end of JSON input` — while the response claimed a
 * clean stop. Production then handed `{}` to the tool, which answered "kind, title and milestones
 * are required", and the model, whose arguments had contained all three, had no way to learn that
 * the problem was length. The founder's gig died on a correction loop about nothing.
 *
 * So arguments that do not parse ARE a truncation signal in their own right: a model does not emit
 * a half-written JSON object on purpose. That is the whole of this module — no I/O, no provider
 * knowledge, so the battery and the product cannot drift apart on what "truncated" means.
 */

export interface ChoiceLike {
  message?: { tool_calls?: { function?: { arguments?: string } }[] | null } | null;
  finish_reason?: string | null;
}

/** Does every tool call in this choice carry arguments that actually parse? */
export function argsParse(choice: ChoiceLike | undefined | null): boolean {
  const calls = choice?.message?.tool_calls ?? [];
  return calls.every((c) => {
    const raw = c?.function?.arguments;
    // Absent or empty is a call with no arguments, which is a legitimate shape (some tools take
    // none). Only a non-empty string that fails to parse is evidence of a cut.
    if (raw === undefined || raw === null || raw.trim() === "") return true;
    try {
      JSON.parse(raw);
      return true;
    } catch {
      return false;
    }
  });
}

/** A call the caller can actually act on: present, and its arguments parse. */
export function hasUsableCall(choice: ChoiceLike | undefined | null): boolean {
  return Boolean(choice?.message?.tool_calls?.length) && argsParse(choice);
}

/**
 * Whether to spend one more budget rung on this turn, and the reason to log.
 * `null` means the answer stands.
 */
export function truncationSignal(choice: ChoiceLike | undefined | null): string | null {
  if (!choice) return null;
  if (choice.finish_reason === "length") {
    return choice.message?.tool_calls?.length ? "tool call truncated (finish=length)" : "reasoning ran out of room, no call made (finish=length)";
  }
  // The provider said it stopped cleanly and the arguments say otherwise. Believe the arguments.
  if (!argsParse(choice)) return "tool arguments cut mid-JSON despite a clean finish_reason";
  return null;
}
