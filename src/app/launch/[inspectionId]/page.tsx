import type { Metadata } from "next";
import { notFound } from "next/navigation";
import "../launch.css";
import { getInspectionJob } from "@/lib/db/inspection";
import { feedbackAtForInspection } from "@/lib/db/feedback";
import { jobToView } from "@/lib/launch/job";
import { LaunchResults } from "@/components/launch/launch-results";
import { TesterSupplyProof } from "@/components/launch/tester-supply-proof";
import type { JobView as ClientJobView } from "@/components/launch/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Sage — your testing plan", robots: { index: false } };

/**
 * The durable, refresh-safe results route. The job is loaded from the database
 * server-side and passed to the client view as its initial state, so a refresh, a
 * direct open, or back/forward all resume the exact same state — no client-only flag.
 */
export default async function InspectionPage({ params }: { params: Promise<{ inspectionId: string }> }) {
  const { inspectionId } = await params;
  const job = getInspectionJob(inspectionId);
  if (!job) notFound();
  const view = jobToView(job);
  // PUBLIC, CHECKABLE PROOF THAT THIS PERSON SPOKE. The feedback widget records the inspection it was
  // sent from, so this line is a fact about the run rather than a claim about it — a mission can ask
  // for feedback and still be verified from the page, with nothing taken on trust.
  const feedbackAt = feedbackAtForInspection(inspectionId);

  return (
    <div className="lx">
      <div className="lx-wrap">
        <div className="lx-hero" style={{ marginBottom: 18 }}>
          <h1 className="lx-h1" style={{ fontSize: "clamp(24px, 4vw, 32px)" }}>{view.status === "ready" ? "Sage’s testing plan" : "Sage is inspecting your product"}</h1>
          <p className="lx-sub" style={{ fontSize: 15 }}>{hostOf(view.productUrl)}</p>
        </div>

        {feedbackAt !== null && (
          <p className="lx-feedback-mark">
            Feedback received on this inspection ·{" "}
            {new Date(feedbackAt * 1000).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
              year: "numeric",
              timeZone: "UTC",
            })}
          </p>
        )}

        <LaunchResults initial={view as unknown as ClientJobView} />

        {/* The founder decides HERE. Answer "will anyone come?" on the page where they approve. */}
        {view.status === "ready" && <TesterSupplyProof />}
      </div>
    </div>
  );
}

function hostOf(u: string): string { try { return new URL(u).host; } catch { return u; } }
