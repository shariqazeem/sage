import { advance, newTaskRun, readMemory, currentAction, type TaskRunV1, type ToolOutcome, type NextAction, type ConversationMemoryV2 } from "./task-run";

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

/**
 * Map a concierge tool name + its JSON result text to a controller ToolOutcome — extracting AUTHORITATIVE
 * ids only from the tool result (never the model). Returns null for tools outside the task lifecycle.
 */
export function mapConciergeTool(name: string, resultText: string): ToolOutcome | null {
  let data: Record<string, unknown> = {};
  try { data = JSON.parse(resultText) as Record<string, unknown>; } catch { /* non-JSON tool text */ }
  const ok = data.ok !== false && !data.error;
  const str = (k: string) => (typeof data[k] === "string" ? (data[k] as string) : undefined);
  switch (name) {
    case "sage_start_inspection":
      return { tool: "inspect", ok, data: { inspectionId: str("inspectionId") ?? str("id") } };
    case "sage_get_inspection":
      return { tool: "poll_inspection", ok, data: { ready: data.status === "ready" || data.ready === true, planId: str("planId") } };
    case "sage_fund_and_launch": {
      if (data.overCap) return { tool: "fund_and_launch", ok: false, reason: "overCap" };
      if (data.needsFunding) return { tool: "fund_and_launch", ok: false, reason: "needsFunding" };
      if (data.needsGas) return { tool: "fund_and_launch", ok: false, reason: "needsGas" };
      return { tool: "fund_and_launch", ok, data: { campaignId: str("campaignId") ?? str("id"), campaignUrl: str("campaignUrl") } };
    }
    default:
      return null; // wallet-status / my-campaigns / proof reads are not lifecycle transitions
  }
}

export interface ShadowStep {
  tool: string;
  controllerNext: NextAction;
  state: TaskRunV1["state"];
  /** disagreement: did the controller's proposed action differ in KIND from the legacy loop's next move? */
  note?: string;
}

/** A live shadow session over one concierge turn — observe tool results, advance the controller, record. */
export class ConciergeTaskShadow {
  task: TaskRunV1 | null;
  steps: ShadowStep[] = [];
  private clock: number;

  constructor(memory: ConversationMemoryV2, founderText: string, now: number) {
    this.clock = now;
    this.task = memory.activeTask;
    if (!this.task) {
      const intent = extractIntent(founderText);
      if (intent) this.task = newTaskRun({ runId: `shadow_${now}`, ...intent, now });
    }
  }

  /** Feed a real tool result; advance the controller if this tool is a lifecycle transition. */
  observeTool(name: string, resultText: string): void {
    if (!this.task) return;
    const outcome = mapConciergeTool(name, resultText);
    if (!outcome) return;
    const { run, next } = advance(this.task, { kind: "tool", outcome }, this.clock++);
    this.task = run;
    this.steps.push({ tool: name, controllerNext: next, state: run.state });
  }

  /** Feed a founder approval/message (only approval advances state). */
  observeFounder(text: string, approve: boolean): void {
    if (!this.task) return;
    const { run } = advance(this.task, { kind: "founder", text, approve }, this.clock++);
    this.task = run;
  }

  /** What the controller would do next from the current state (for comparison to the legacy loop). */
  proposedNext(): NextAction | null {
    return this.task ? currentAction(this.task) : null;
  }

  /** Persist the shadow task into a backward-compatible V2 envelope over the existing message array. */
  toEnvelope(messages: unknown[], summary: string): string {
    const env: ConversationMemoryV2 = { version: 2, messages, summary, activeTask: this.task, recentTools: this.steps.slice(-5).map((s) => ({ tool: s.tool, ok: true })) };
    return JSON.stringify(env);
  }
}

export { readMemory };
