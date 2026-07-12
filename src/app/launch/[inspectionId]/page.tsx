import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import "../launch.css";
import { getInspectionJob } from "@/lib/db/inspection";
import { jobToView } from "@/lib/launch/job";
import { LaunchResults } from "@/components/launch/launch-results";
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

  return (
    <div className="lx">
      <div className="lx-wrap">
        <header className="lx-head">
          <Link href="/" className="lx-mark" aria-label="Sage home"><span /></Link>
          <span className="lx-word">Sage</span>
          <Link href="/launch" className="lx-kicker" style={{ marginLeft: "auto", textDecoration: "none" }}>New inspection</Link>
        </header>

        <div className="lx-hero" style={{ marginBottom: 18 }}>
          <h1 className="lx-h1" style={{ fontSize: "clamp(24px, 4vw, 32px)" }}>{view.status === "ready" ? "Sage’s testing plan" : "Sage is inspecting your product"}</h1>
          <p className="lx-sub" style={{ fontSize: 15 }}>{hostOf(view.productUrl)}</p>
        </div>

        <LaunchResults initial={view as unknown as ClientJobView} />
      </div>
    </div>
  );
}

function hostOf(u: string): string { try { return new URL(u).host; } catch { return u; } }
