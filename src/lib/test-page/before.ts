import "server-only";

import { existsSync } from "node:fs";
import path from "node:path";
import type { InspectionJob } from "@/lib/db/schema";
import { getCurrentRevision } from "@/lib/db/plan-revisions";
import { sameFounder } from "@/lib/auth/founder";
import { jobToView } from "@/lib/launch/job";
import { kindOfMap, playbookOf, sageReadsOnly } from "@/lib/launch/product-kind";
import { deserializePlan } from "@/lib/launch/serde";
import { framesOf, type RealFrame } from "@/lib/site/real-test-frames";
import { hostOf } from "@/lib/site/when";
import { handedOverOwner } from "@/lib/telegram/handover-claim";
import { xDraftFor } from "@/lib/x/drafts";
import type { JobView } from "@/components/launch/types";
import { firstLookView, type FirstLookView } from "./first-look";
import { ensureDefaultOffer, offerLockedWhy } from "./offer-apply";

/**
 * A TEST BEFORE IT IS PAID FOR, as its page reads it (relaunch, 20 Nov 2026).
 *
 * Everything here is a stored row or a file on disk: the job, the frames Sage captured, what it
 * understood, what it could not see. `whose` is relative to the visitor and never an address.
 */
/** `handover`: planned in a Telegram chat; its link's code lets the signed-in person take it. */
export type Whose = "yours" | "nobody" | "handover" | "x" | "other";

export interface TestFact {
  label: string;
  value: string;
}

export interface BeforeView {
  job: JobView;
  whose: Whose;
  signedIn: boolean;
  host: string;
  productName: string | null;
  /** the finished run's frames, in the order they happened; null while Sage is still trying */
  run: { frames: RealFrame[]; steps: number; seconds: number | null } | null;
  /** what Sage understood, each from the product map */
  facts: TestFact[];
  /** what Sage says it could not see */
  couldNotSee: string[];
  /** what Sage read where it could not use the product itself ("the store listing"); null when it tried it */
  sageReads: string | null;
  /** what Sage itself noticed while trying it: there as soon as its browser closes, before the missions */
  firstLook: FirstLookView | null;
  inviteOnly: boolean;
  /** a tag on X started this test and nobody has claimed it: who may */
  xDraft: { username: string | null } | null;
  /** why the people and reward cannot change, or null */
  offerLocked: string | null;
  /** the test page of the plan once it is live */
  launchedCampaignId: string | null;
}

const MAX_FRAMES = 8;

type StoredMap = {
  productName?: unknown;
  category?: unknown;
  valueProp?: unknown;
  primaryJourney?: { value?: unknown }[];
  limitations?: unknown;
  pagesInspected?: unknown;
  fieldTest?: unknown;
  productKind?: unknown;
};

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

function onDisk(inspectionId: string, n: number): boolean {
  return existsSync(path.join(process.cwd(), "public", "field-tests", inspectionId, `${n}.png`));
}

export function whoseIs(job: Pick<InspectionJob, "id" | "founderWallet">, viewer: string | null): Whose {
  if (viewer && sameFounder(job.founderWallet, viewer)) return "yours";
  if (job.founderWallet === "anonymous") return "nobody";
  if (handedOverOwner(job.founderWallet)) return "handover";
  if (xDraftFor(job.id)?.unclaimed) return "x";
  return "other";
}

/** The facts Sage is working from, in the order a person would ask them. Only what the map holds. */
export function factsOf(map: StoredMap | null, steps: number | null): { facts: TestFact[]; couldNotSee: string[] } {
  if (!map) return { facts: [], couldNotSee: [] };
  const facts: TestFact[] = [];
  const name = str(map.productName);
  const category = str(map.category);
  if (name || category) facts.push({ label: "What it is", value: [name, category].filter(Boolean).join(", ") });
  // the kind, when it is not an ordinary site, and what Sage read of it (product-kind.ts)
  const kind = kindOfMap(map);
  if (kind !== "website") facts.push({ label: "What kind of product", value: `${playbookOf(kind).label}. Sage read ${playbookOf(kind).sageRead}.` });
  const says = str(map.valueProp);
  if (says) facts.push({ label: "What it says", value: says });
  const journey = (Array.isArray(map.primaryJourney) ? map.primaryJourney : []).map((j) => str(j?.value).replace(/^\d+\.\s*/, "")).filter(Boolean);
  if (journey.length > 0) facts.push({ label: "The way through", value: journey.slice(0, 4).join(" → ") });
  const pages = typeof map.pagesInspected === "number" ? map.pagesInspected : 0;
  const tried = [steps ? `${steps} ${steps === 1 ? "step" : "steps"}` : "", pages > 0 ? `${pages} ${pages === 1 ? "page" : "pages"}` : ""].filter(Boolean).join(" across ");
  if (tried) facts.push({ label: "What Sage did", value: tried });
  const couldNotSee = (Array.isArray(map.limitations) ? map.limitations : []).map(str).filter(Boolean).slice(0, 3);
  return { facts, couldNotSee };
}

export function beforeView(job: InspectionJob, viewer: string | null): BeforeView {
  const whose = whoseIs(job, viewer);
  // the owner's first look at a fresh default-budget plan sets it to the default offer, once
  if (whose === "yours" && viewer) ensureDefaultOffer(job, viewer);
  const view = jobToView(job) as unknown as JobView;
  const host = hostOf(job.productUrl) ?? job.productUrl;
  const map = ((job.result as { map?: StoredMap } | null)?.map ?? null) as StoredMap | null;

  // A run where the builder gave Sage a test account can show a signed-in screen: its frames are the
  // owner's to see, and nobody else's.
  // NO CORPUS ORACLE (CLAUDE.md): before anyone is paid, this page becomes the live test's page, and Sage's
  // frames and first look carry what the judge will check answers against. Only the owner sees them now;
  // the public sees them once the test is done (live.ts).
  const mayShowFrames = whose === "yours";
  let run: BeforeView["run"] = null;
  if (map?.fieldTest && mayShowFrames) {
    const picked = framesOf(map.fieldTest, host, MAX_FRAMES);
    if (picked) {
      const frames = picked.frames.filter((f) => onDisk(job.id, f.file)).map((f) => ({ ...f, src: `/api/field-tests/${job.id}/${f.file}` }));
      run = { frames, steps: picked.steps, seconds: picked.seconds };
    }
  }

  const current = job.status === "ready" ? getCurrentRevision(job.id) : null;
  const plan = current ? deserializePlan(current.planJson) : null;
  const draft = xDraftFor(job.id);
  const { facts, couldNotSee } = factsOf(map, run?.steps ?? null);

  return {
    job: view,
    whose,
    signedIn: !!viewer,
    host,
    productName: str(map?.productName) || null,
    run,
    facts,
    couldNotSee,
    sageReads: sageReadsOnly(map, job.productUrl),
    // a look taken with the builder's own test account shows signed-in screens: the owner's alone
    firstLook: mayShowFrames ? firstLookView(job) : null,
    inviteOnly: plan?.visibility === "unlisted",
    xDraft: draft?.unclaimed ? { username: draft.username } : null,
    offerLocked: job.status === "ready" ? offerLockedWhy(job) : null,
    launchedCampaignId: view.launched?.campaignId ?? null,
  };
}
