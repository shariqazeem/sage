import { advance, newTaskRun, readMemory, currentAction, approvalToken, type TaskRunV1, type ToolOutcome, type NextAction, type ConversationMemoryV2 } from "./task-run";

/**
 * Concierge task-run SHADOW (Priority S3) — observes the REAL concierge tool loop and drives the resumable
 * controller from ACTUAL tool results, comparing its proposed next step to what the legacy loop did. The
 * legacy loop stays authoritative; this only records what an autonomous controller WOULD do, so we can
 * measure agreement before ever enforcing. Off by default; never changes tool execution, the reply, IDs,
 * approval, or money.
 */
export type ConciergeTaskMode = "off" | "shadow" | "enforce";

export function conciergeTaskRunMode(): ConciergeTaskMode {
  const v = process.env.CONCIERGE_TASK_RUN_MODE?.trim().toLowerCase();
  return v === "shadow" ? "shadow" : "off"; // "enforce" is reserved + intentionally NOT honored yet
}

/** Extract a URL + goal + budget-text from the founder's message (best-effort; deterministic). */
export function extractIntent(text: string): { productUrl: string; goal: string; budgetText: string } | null {
  const url = /(https?:\/\/[^\s"'<>]+)/i.exec(text)?.[1];
  if (!url) return null;
  const budget = /\$\s?[\d,.]*\d/.exec(text)?.[0] ?? ""; // ends on a digit → no trailing comma/period
  return { productUrl: url, goal: text.slice(0, 200), budgetText: budget };
}

/** Explicit lifecycle outcome — a payout-critical tool NEVER reaches "success" on a permissive guess. */
export type LifecycleOutcome = "success" | "failed" | "ambiguous" | "needs_funding" | "needs_gas" | "over_cap";

const parseObj = (text: string): Record<string, unknown> | null => {
  try { const v = JSON.parse(text) as unknown; return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null; }
  catch { return null; }
};
const strField = (o: Record<string, unknown>, k: string): string | undefined => (typeof o[k] === "string" && (o[k] as string).trim() ? (o[k] as string) : undefined);

/**
 * STRICT per-tool decoder. A lifecycle action SUCCEEDS only when the JSON is a valid object, the tool
 * explicitly reports success, and every required authoritative id is present + well-formed. For the money
 * tool (fund_and_launch), a missing campaignId / empty / prose / malformed / timeout result becomes
 * AMBIGUOUS (→ the controller verifies before any second spend) — NEVER a transition to active. An id is
 * never inferred from prose. Returns null for tools outside the lifecycle.
 */
export function mapConciergeTool(name: string, resultText: string): ToolOutcome | null {
  const o = parseObj(resultText);
  switch (name) {
    case "sage_start_inspection": {
      if (!o) return { tool: "inspect", ok: false, reason: "malformed_result" };
      const id = strField(o, "inspectionId") ?? strField(o, "id");
      if (o.ok === false || o.error || !id) return { tool: "inspect", ok: false, reason: o.error ? "tool_error" : "no_inspection_id" };
      return { tool: "inspect", ok: true, data: { inspectionId: id } };
    }
    case "sage_get_inspection": {
      if (!o) return { tool: "poll_inspection", ok: false, reason: "malformed_result" };
      const ready = o.status === "ready" || o.ready === true;
      return { tool: "poll_inspection", ok: true, data: { ready, planId: strField(o, "planId") ?? strField(o, "revision"), planDigest: strField(o, "planDigest") ?? strField(o, "digest") } };
    }
    case "sage_fund_and_launch": {
      // MONEY tool — fail closed. Malformed/absent output is AMBIGUOUS (verify), not a failure to blindly
      // retry and never a success. Explicit business stops map to hard reasons.
      if (!o) return { tool: "fund_and_launch", ok: false, ambiguousTimeout: true, reason: "malformed_result" };
      if (o.overCap) return { tool: "fund_and_launch", ok: false, reason: "overCap" };
      if (o.needsFunding) return { tool: "fund_and_launch", ok: false, reason: "needsFunding" };
      if (o.needsGas) return { tool: "fund_and_launch", ok: false, reason: "needsGas" };
      if (o.timeout || o.ambiguous) return { tool: "fund_and_launch", ok: false, ambiguousTimeout: true, reason: "ambiguous_timeout" };
      if (o.error) return { tool: "fund_and_launch", ok: false, reason: "tool_error" };
      const camp = strField(o, "campaignId") ?? strField(o, "id");
      // success CLAIMED but no id, or ok!==true → we don't KNOW it deployed → verify, never active.
      if (!camp || o.ok === false) return { tool: "fund_and_launch", ok: false, ambiguousTimeout: true, reason: "no_campaign_id" };
      return { tool: "fund_and_launch", ok: true, data: { campaignId: camp, campaignUrl: strField(o, "campaignUrl") } };
    }
    default:
      return null; // wallet-status / my-campaigns / proof reads are not lifecycle transitions
  }
}

/** The explicit lifecycle outcome label for an OK/failed/ambiguous decoded result (for ShadowStep). */
export function lifecycleOutcome(o: ToolOutcome): LifecycleOutcome {
  if (o.ok) return "success";
  if (o.ambiguousTimeout) return "ambiguous";
  if (o.reason === "needsFunding") return "needs_funding";
  if (o.reason === "needsGas") return "needs_gas";
  if (o.reason === "overCap") return "over_cap";
  return "failed";
}

export interface ShadowStep {
  tool: string;
  controllerNext: NextAction;
  state: TaskRunV1["state"];
  /** the explicit lifecycle outcome of this tool (never a blanket ok:true). */
  outcome: LifecycleOutcome;
  /** set when this tool call was a loop (same tool + no state progress). */
  loop?: boolean;
}

const LOOP_THRESHOLD = 3; // the same tool firing this many times with NO state progress = a loop

/** A live shadow session over one concierge turn — observe tool results, advance the controller, record. */
export class ConciergeTaskShadow {
  task: TaskRunV1 | null;
  steps: ShadowStep[] = [];
  private clock: number;
  private surface: "telegram" | "web";
  private repeat = { sig: "", count: 0 };

  constructor(memory: ConversationMemoryV2, founderText: string, now: number, surface: "telegram" | "web" = "telegram") {
    this.clock = now;
    this.surface = surface;
    this.task = memory.activeTask;
    if (!this.task) {
      const intent = extractIntent(founderText);
      if (intent) this.task = newTaskRun({ runId: `shadow_${now}`, ...intent, now });
    }
  }

  /** Feed a real tool result; advance the controller if this tool is a lifecycle transition. */
  observeTool(name: string, resultText: string): void {
    if (!this.task) return;
    // SURFACE-AWARE: the web surface has no money tools — a fund_and_launch here would be telemetry
    // pretending it can authorize Telegram-only funding, so it is never observed as a lifecycle event.
    if (this.surface === "web" && name === "sage_fund_and_launch") return;
    const outcome = mapConciergeTool(name, resultText);
    if (!outcome) return;
    const before = this.task.state;
    const { run, next } = advance(this.task, { kind: "tool", outcome }, this.clock++);
    // LOOP DETECTION — the same tool firing repeatedly with no state progress.
    const sig = `${name}:${before}`;
    this.repeat = this.repeat.sig === sig && run.state === before ? { sig, count: this.repeat.count + 1 } : { sig, count: 1 };
    const loop = this.repeat.count >= LOOP_THRESHOLD;
    if (loop && run.state !== "blocked") run.state = "blocked";
    this.task = run;
    this.steps.push({ tool: name, controllerNext: next, state: run.state, outcome: lifecycleOutcome(outcome), ...(loop ? { loop: true } : {}) });
  }

  /** Feed a founder approval/message. Approval is bound to the SPECIFIC plan the run is awaiting — a
   *  generic "yes" after the plan changed (a different planId) must NOT authorize the changed plan. */
  observeFounder(text: string, approve: boolean): void {
    if (!this.task) return;
    // approval is bound to the EXACT plan token (id + digest + budget + revision) presented. If the run no
    // longer matches the token it was awaiting (a re-inspection changed the plan/budget), the "yes" is
    // stale — re-present, never deploy the changed plan.
    if (approve && this.task.state === "awaiting_approval" && this.task.pendingApprovalToken && approvalToken(this.task) !== this.task.pendingApprovalToken) {
      return;
    }
    const { run } = advance(this.task, { kind: "founder", text, approve }, this.clock++);
    this.task = run;
  }

  /** What the controller would do next from the current state (for comparison to the legacy loop). */
  proposedNext(): NextAction | null {
    return this.task ? currentAction(this.task) : null;
  }

  /** Persist the shadow task into a backward-compatible V2 envelope over the existing message array. */
  toEnvelope(messages: unknown[], summary: string): string {
    const env: ConversationMemoryV2 = { version: 2, messages, summary, activeTask: this.task, recentTools: this.steps.slice(-5).map((s) => ({ tool: s.tool, ok: s.outcome === "success", reason: s.outcome === "success" ? undefined : s.outcome })) };
    return JSON.stringify(env);
  }
}

export { readMemory };
