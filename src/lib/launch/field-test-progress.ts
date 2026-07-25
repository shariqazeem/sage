import "server-only";

import { writeFile, readFile, mkdir } from "node:fs/promises";
import path from "node:path";

/**
 * The LIVE trail of what Sage is doing inside the browser, written as it happens.
 *
 * The inspecting page used to show one motionless line — "Using your product in a real browser" —
 * for minutes, while Sage was in fact opening screens, typing, and pressing keys the whole time.
 * A founder watching a still spinner has no way to tell work from a hang. This records each real
 * step the moment it is captured, so the page can show the work instead of a spinner.
 *
 * Rules:
 *   · REAL steps only. A step is appended when a state was actually captured — never on a timer,
 *     never predicted, never padded. If Sage does nothing for 30s, the trail shows nothing new.
 *   · Best-effort, never load-bearing. Every function swallows its errors: a failed write must
 *     never affect the inspection, and a missing file just means "no steps yet".
 *   · It lives beside the screenshots it references (public/field-tests/<id>/), so it is cleaned
 *     up with them and needs no schema.
 */

export interface FieldTestStepV1 {
  /** 0-based order of capture. */
  n: number;
  /** epoch ms when the step was captured. */
  at: number;
  /** what Sage did, in its own words ("clicked \"come in →\"", "typed the test message"). */
  label: string;
  /** the screenshot URL for this step, when one was captured. */
  screenshot: string | null;
  /** the page Sage was on. */
  url: string;
}

const MAX_STEPS = 400;

function dirFor(inspectionId: string): string {
  return path.join(process.cwd(), "public", "field-tests", inspectionId);
}

/** In-process buffer per inspection — one writer, so the file is always the full trail. */
const buffers = new Map<string, FieldTestStepV1[]>();

/** Append one REAL step and flush the trail. Never throws. */
export async function recordFieldTestStep(
  inspectionId: string,
  step: Omit<FieldTestStepV1, "n" | "at">,
  now = Date.now(),
): Promise<void> {
  try {
    const steps = buffers.get(inspectionId) ?? [];
    if (steps.length >= MAX_STEPS) return;
    steps.push({ n: steps.length, at: now, ...step });
    buffers.set(inspectionId, steps);
    const dir = dirFor(inspectionId);
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "progress.json"),
      JSON.stringify({ version: 1, steps }),
      "utf8",
    );
  } catch {
    /* a trail is a nicety; an inspection is not */
  }
}

/** Drop the in-process buffer once a run is done (the file stays for late readers). */
export function endFieldTestTrail(inspectionId: string): void {
  buffers.delete(inspectionId);
}

/** Read the trail written so far. Returns [] when there is none. Never throws. */
export async function readFieldTestProgress(
  inspectionId: string,
): Promise<FieldTestStepV1[]> {
  try {
    const raw = await readFile(
      path.join(dirFor(inspectionId), "progress.json"),
      "utf8",
    );
    const parsed = JSON.parse(raw) as { steps?: unknown };
    if (!Array.isArray(parsed.steps)) return [];
    return parsed.steps.filter(
      (s): s is FieldTestStepV1 =>
        !!s &&
        typeof s === "object" &&
        typeof (s as FieldTestStepV1).n === "number" &&
        typeof (s as FieldTestStepV1).label === "string",
    );
  } catch {
    return [];
  }
}
