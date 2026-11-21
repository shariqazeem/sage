import "server-only";

import { existsSync } from "node:fs";
import path from "node:path";
import { firstLookFor } from "@/lib/first-look";
import { pathOf, PLAIN_ENGINE, type EvidenceKind, type ReadVerdict } from "@/lib/first-look/core";

/**
 * SAGE'S FIRST LOOK, as a page reads it (the core, 21 Nov 2026).
 *
 * Every problem arrives with the thing it rests on already joined to it: the step, the address, the
 * exact recorded text, and the frame's picture when the file is on disk. A reader never has to trust
 * a sentence: the evidence is on the same row.
 */
export interface LookProblemView {
  id: string;
  kind: Exclude<EvidenceKind, "landing">;
  title: string;
  fix: string;
  /** the step in Sage's run, from 1; null when it was read from a page outside the run */
  step: number | null;
  /** where it happened: the product's host, or a path on it */
  where: string;
  /** the exact text Sage recorded */
  recorded: string;
  times: number;
  /** the frame's picture, when Sage kept one */
  frame: string | null;
}

export interface FirstLookView {
  ran: boolean;
  steps: number;
  seconds: number | null;
  problems: LookProblemView[];
  read: {
    says: string | null;
    firstScreen: string | null;
    looksFor: string[];
    strangerReads: string | null;
    verdict: ReadVerdict | null;
    frame: string | null;
  };
  limits: string[];
  /** true when a model chose any of the words; the evidence is Sage's own either way */
  worded: boolean;
}

function frameSrc(inspectionId: string, frame: number | null): string | null {
  if (frame === null) return null;
  return existsSync(path.join(process.cwd(), "public", "field-tests", inspectionId, `${frame}.png`)) ? `/api/field-tests/${inspectionId}/${frame}` : null;
}

export function firstLookView(job: { id: string; productUrl: string; result: unknown }): FirstLookView | null {
  const look = firstLookFor(job);
  if (!look) return null;
  const byId = new Map(look.evidence.map((e) => [e.id, e]));
  const landing = look.read.evidence.map((id) => byId.get(id)).find(Boolean) ?? null;
  return {
    ran: look.ran,
    steps: look.steps,
    seconds: look.seconds,
    problems: look.problems.flatMap((p) => {
      const e = p.evidence.map((id) => byId.get(id)).find(Boolean);
      // a problem whose evidence is gone is not shown: no evidence, no claim
      if (!e) return [];
      return [{ id: p.id, kind: p.kind, title: p.title, fix: p.fix, step: e.step, where: pathOf(e.url, look.host), recorded: e.text, times: e.times, frame: frameSrc(job.id, e.frame) }];
    }),
    read: {
      says: look.read.says,
      firstScreen: look.read.firstScreen,
      looksFor: look.read.looksFor,
      strangerReads: look.read.strangerReads,
      verdict: look.read.verdict,
      frame: landing ? frameSrc(job.id, landing.frame) : null,
    },
    limits: look.limits,
    worded: look.engine !== PLAIN_ENGINE,
  };
}
