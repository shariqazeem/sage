/**
 * Concierge autonomy pack — a resumable, bounded TASK CONTROLLER (Priority 4).
 *
 * The concierge was a stateless chat/tool loop; this turns it into a state machine that carries a founder's
 * goal from intake to a live campaign and can resume after a restart. The controller is PURE: given the
 * current run and the latest deterministic tool outcome (or founder message), it returns the updated run
 * and the single next permitted action. The load-bearing invariants (all enforced here, never by a model):
 *
 *   · authoritative IDs (inspectionId, campaignId, …) and state transitions come ONLY from a SUCCESSFUL
 *     deterministic tool result — a model message can never establish one, and an id a founder types is
 *     verified via a tool, never trusted;
 *   · after a successful tool, the controller advances to the next logically-permitted step;
 *   · read-only polling retries with bounded backoff; a money-mutating action is NEVER blindly retried —
 *     an ambiguous timeout triggers a state VERIFICATION, not a re-spend;
 *   · approval + mandate remain authoritative: the controller STOPS at awaiting_approval and explains the
 *     exact pending action; it never self-approves;
 *   · repeated identical tool calls (a loop) terminate the run as blocked;
 *   · rounds are capped.
 *
 * It rides in the existing per-chat JSON storage (see ConversationMemoryV2) — no DB migration.
 */

export const TASK_RUN_VERSION = "task-run-v1";
export const CONVERSATION_MEMORY_VERSION = 2;

export type TaskState =
  | "intake"
  | "inspecting"
  | "waiting_for_inspection"
  | "presenting_plan"
  | "awaiting_approval"
  | "deploying"
  | "waiting_for_deployment"
  | "active"
  | "monitoring"
  | "completed"
  | "blocked";

export interface TaskRunV1 {
  version: typeof TASK_RUN_VERSION;
  runId: string;
  goal: string;
  productUrl: string;
  /** the founder's own budget text (verbatim) + the deterministic value a tool validated, when known. */
  budgetText: string;
  budgetBase?: string;
  state: TaskState;
  /** authoritative ids — set ONLY from successful tool results. */
  inspectionId?: string;
  planId?: string;
  deploymentId?: string;
  campaignId?: string;
  campaignUrl?: string;
  /** the exact action awaiting the founder's approval, if any. */
  pendingApproval?: string;
  lastSuccessfulTool?: string;
  retries: Record<string, number>;
  blockers: string[];
  createdAt: number;
  updatedAt: number;
}

/** The rolling per-chat memory envelope (V2). Backward-compatible: a bare message array is read as V1. */
export interface ConversationMemoryV2 {
  version: typeof CONVERSATION_MEMORY_VERSION;
  messages: unknown[];
  /** a bounded plain-text summary — helpful context only, NEVER authoritative for ids/state. */
  summary: string;
  activeTask: TaskRunV1 | null;
  /** the last few tool outcomes (names + ok + short reason), for the model's situational awareness. */
  recentTools: { tool: string; ok: boolean; reason?: string }[];
}

/** A deterministic tool result the controller advances on. `data` carries authoritative ids. */
export interface ToolOutcome {
  tool: string;
  ok: boolean;
  data?: Record<string, unknown>;
  /** a money-mutating call that timed out ambiguously (we do NOT know if it took effect). */
  ambiguousTimeout?: boolean;
  /** a machine reason for a non-ok result (e.g. needsFunding, overCap, needsGas). */
  reason?: string;
}

export type ControllerEvent =
  | { kind: "tool"; outcome: ToolOutcome }
  | { kind: "founder"; text: string; approve?: boolean };

export type NextAction =
  | { kind: "call_tool"; tool: string; args: Record<string, unknown>; readOnly: boolean }
  | { kind: "await_approval"; pending: string }
  | { kind: "reply"; text: string }
  | { kind: "blocked"; reason: string };

export interface TaskEvent {
  event: "task_started" | "state_changed" | "tool_result" | "awaiting_approval" | "task_blocked" | "task_completed";
  state: TaskState;
  detail?: string;
}

const MAX_POLL_RETRIES = 8;
const MAX_TOTAL_ROUNDS = 40;

/** A read-only tool may be retried with bounded backoff; a money-mutating one may not. */
const READ_ONLY_TOOLS = new Set(["poll_inspection", "verify_deployment", "poll_campaign", "wallet_status"]);
const MONEY_TOOLS = new Set(["fund_and_launch"]);

function bump(run: TaskRunV1, key: string): number {
  run.retries[key] = (run.retries[key] ?? 0) + 1;
  return run.retries[key];
}

export function newTaskRun(args: { runId: string; goal: string; productUrl: string; budgetText: string; now: number }): TaskRunV1 {
  return {
    version: TASK_RUN_VERSION, runId: args.runId, goal: args.goal, productUrl: args.productUrl, budgetText: args.budgetText,
    state: "intake", retries: {}, blockers: [], createdAt: args.now, updatedAt: args.now,
  };
}

/**
 * Advance the run one step. Returns the mutated run (a copy), the single next action, and honest events.
 * Deterministic + pure (no i/o); `now` is injected.
 */
export function advance(prev: TaskRunV1, event: ControllerEvent, now: number): { run: TaskRunV1; next: NextAction; events: TaskEvent[] } {
  const run: TaskRunV1 = { ...prev, retries: { ...prev.retries }, blockers: [...prev.blockers], updatedAt: now };
  const events: TaskEvent[] = [];
  const to = (state: TaskState, detail?: string): void => { if (run.state !== state) events.push({ event: "state_changed", state, detail }); run.state = state; };
  const blocked = (reason: string): { run: TaskRunV1; next: NextAction; events: TaskEvent[] } => {
    run.blockers.push(reason); to("blocked", reason); events.push({ event: "task_blocked", state: "blocked", detail: reason });
    return { run, next: { kind: "blocked", reason }, events };
  };

  if (bump(run, "rounds") > MAX_TOTAL_ROUNDS) return blocked("round_cap_exceeded");

  // ── founder messages: only approval + intake advance state; a typed id is NEVER trusted. ──
  if (event.kind === "founder") {
    if (run.state === "awaiting_approval") {
      if (event.approve) {
        to("deploying", "founder approved");
        run.pendingApproval = undefined;
        return { run, next: { kind: "call_tool", tool: "fund_and_launch", args: { inspectionId: run.inspectionId }, readOnly: false }, events };
      }
      return { run, next: { kind: "await_approval", pending: run.pendingApproval ?? "approve_plan" }, events };
    }
    // any other founder message re-emits the current permitted step.
    return { run, next: currentAction(run), events };
  }

  // ── tool outcomes: the ONLY thing that sets authoritative ids + advances real state. ──
  const o = event.outcome;
  events.push({ event: "tool_result", state: run.state, detail: `${o.tool}:${o.ok ? "ok" : o.reason ?? "fail"}` });

  if (MONEY_TOOLS.has(o.tool)) {
    if (o.ambiguousTimeout) {
      // NEVER re-spend on an ambiguous timeout — verify the deployment state instead.
      to("waiting_for_deployment", "money tool ambiguous timeout → verify, do not retry");
      return { run, next: { kind: "call_tool", tool: "verify_deployment", args: { inspectionId: run.inspectionId }, readOnly: true }, events };
    }
    if (!o.ok) {
      // needsFunding / needsGas / overCap — a real stop the founder must resolve; never a blind retry.
      return blocked(o.reason ?? "fund_and_launch_failed");
    }
    // success — authoritative campaign id comes from the tool, never a model.
    if (typeof o.data?.campaignId === "string") run.campaignId = o.data.campaignId;
    if (typeof o.data?.campaignUrl === "string") run.campaignUrl = o.data.campaignUrl;
    run.lastSuccessfulTool = o.tool;
    to("active", "campaign live");
    return { run, next: { kind: "call_tool", tool: "poll_campaign", args: { campaignId: run.campaignId }, readOnly: true }, events };
  }

  if (!o.ok) {
    // a failed read-only tool: bounded backoff, else block.
    if (READ_ONLY_TOOLS.has(o.tool)) {
      if (bump(run, o.tool) > MAX_POLL_RETRIES) return blocked(`${o.tool}_exhausted`);
      return { run, next: { kind: "call_tool", tool: o.tool, args: currentArgs(run, o.tool), readOnly: true }, events };
    }
    return blocked(`${o.tool}_failed`);
  }

  run.lastSuccessfulTool = o.tool;
  switch (o.tool) {
    case "inspect": {
      if (typeof o.data?.inspectionId !== "string") return blocked("inspect_no_id");
      run.inspectionId = o.data.inspectionId;
      to("waiting_for_inspection", "inspection started");
      return { run, next: { kind: "call_tool", tool: "poll_inspection", args: { inspectionId: run.inspectionId }, readOnly: true }, events };
    }
    case "poll_inspection": {
      if (o.data?.ready === true) {
        if (typeof o.data?.planId === "string") run.planId = o.data.planId;
        to("presenting_plan", "inspection ready");
        run.pendingApproval = "approve_plan";
        to("awaiting_approval");
        events.push({ event: "awaiting_approval", state: "awaiting_approval", detail: "approve_plan" });
        return { run, next: { kind: "await_approval", pending: "approve_plan" }, events };
      }
      // not ready → bounded poll.
      if (bump(run, "poll_inspection") > MAX_POLL_RETRIES) return blocked("inspection_timeout");
      return { run, next: { kind: "call_tool", tool: "poll_inspection", args: { inspectionId: run.inspectionId }, readOnly: true }, events };
    }
    case "verify_deployment": {
      // resolved the ambiguous money timeout: did it actually deploy?
      if (o.data?.deployed === true && typeof o.data?.campaignId === "string") {
        run.campaignId = o.data.campaignId;
        if (typeof o.data?.campaignUrl === "string") run.campaignUrl = o.data.campaignUrl;
        to("active", "verified: already deployed");
        return { run, next: { kind: "call_tool", tool: "poll_campaign", args: { campaignId: run.campaignId }, readOnly: true }, events };
      }
      // not deployed → it's safe to re-attempt the money action ONCE (the timeout did not take effect).
      to("deploying", "verified: not deployed, safe to re-attempt");
      return { run, next: { kind: "call_tool", tool: "fund_and_launch", args: { inspectionId: run.inspectionId }, readOnly: false }, events };
    }
    case "poll_campaign": {
      to("monitoring", "campaign running");
      // monitoring is a terminal-ish steady state; the run is considered completed once live + monitored.
      to("completed", "live + monitored");
      events.push({ event: "task_completed", state: "completed" });
      return { run, next: { kind: "reply", text: "Your campaign is live and I'm monitoring it." }, events };
    }
    default:
      return { run, next: currentAction(run), events };
  }
}

/** The action the current state permits (used to resume after a restart or a bare founder message). */
export function currentAction(run: TaskRunV1): NextAction {
  switch (run.state) {
    case "intake": return { kind: "call_tool", tool: "inspect", args: { url: run.productUrl, goal: run.goal, budget: run.budgetText }, readOnly: false };
    case "inspecting":
    case "waiting_for_inspection": return { kind: "call_tool", tool: "poll_inspection", args: { inspectionId: run.inspectionId }, readOnly: true };
    case "presenting_plan":
    case "awaiting_approval": return { kind: "await_approval", pending: run.pendingApproval ?? "approve_plan" };
    case "deploying": return { kind: "call_tool", tool: "fund_and_launch", args: { inspectionId: run.inspectionId }, readOnly: false };
    case "waiting_for_deployment": return { kind: "call_tool", tool: "verify_deployment", args: { inspectionId: run.inspectionId }, readOnly: true };
    case "active":
    case "monitoring": return { kind: "call_tool", tool: "poll_campaign", args: { campaignId: run.campaignId }, readOnly: true };
    case "completed": return { kind: "reply", text: "Your campaign is live and I'm monitoring it." };
    case "blocked": return { kind: "blocked", reason: run.blockers.at(-1) ?? "blocked" };
  }
}

function currentArgs(run: TaskRunV1, tool: string): Record<string, unknown> {
  const a = currentAction(run);
  return a.kind === "call_tool" && a.tool === tool ? a.args : {};
}

/**
 * The single memory WRITE codec (pure). Given the CURRENT stored raw, the new messages, and optional
 * overrides, it PRESERVES the existing activeTask + summary + recentTools unless explicitly overridden —
 * so no writer (a background notification included) can silently drop an active run. Emits a V2 envelope
 * when a task exists, else a legacy bare array (byte-identical to pre-V2 storage). `"activeTask" in opts`
 * lets a caller explicitly clear it (opts.activeTask === null).
 */
export function mergeMemory(
  existingRaw: string | null | undefined,
  messages: unknown[],
  opts: { activeTask?: TaskRunV1 | null; summary?: string; recentTools?: ConversationMemoryV2["recentTools"] } = {},
  maxHistory = 12,
): string {
  const existing = readMemory(existingRaw);
  const activeTask = "activeTask" in opts ? opts.activeTask ?? null : existing.activeTask;
  const summary = opts.summary ?? existing.summary;
  const recentTools = opts.recentTools ?? existing.recentTools;
  const trimmed = messages.slice(-maxHistory);
  return activeTask
    ? JSON.stringify({ version: CONVERSATION_MEMORY_VERSION, messages: trimmed, summary, activeTask, recentTools } satisfies ConversationMemoryV2)
    : JSON.stringify(trimmed);
}

/** Read the memory envelope from stored JSON, upgrading a bare V1 message array in place (no migration). */
export function readMemory(stored: string | null | undefined): ConversationMemoryV2 {
  if (!stored) return { version: CONVERSATION_MEMORY_VERSION, messages: [], summary: "", activeTask: null, recentTools: [] };
  let parsed: unknown;
  try { parsed = JSON.parse(stored); } catch { return { version: CONVERSATION_MEMORY_VERSION, messages: [], summary: "", activeTask: null, recentTools: [] }; }
  if (Array.isArray(parsed)) return { version: CONVERSATION_MEMORY_VERSION, messages: parsed, summary: "", activeTask: null, recentTools: [] }; // legacy V1
  const o = (parsed ?? {}) as Partial<ConversationMemoryV2>;
  return {
    version: CONVERSATION_MEMORY_VERSION,
    messages: Array.isArray(o.messages) ? o.messages : [],
    summary: typeof o.summary === "string" ? o.summary : "",
    activeTask: o.activeTask && (o.activeTask as TaskRunV1).version === TASK_RUN_VERSION ? o.activeTask : null,
    recentTools: Array.isArray(o.recentTools) ? o.recentTools : [],
  };
}
