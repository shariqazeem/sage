import "@/styles/test.css";
// what Sage noticed, and what people found
import "@/styles/test-core.css";
// the sign-in doors, the World ID step and the stop control are the product's own, with their own styles
import "@/styles/wallet-connect.css";
import "@/styles/live.css";
// the builder's view of a live test: how far people got, what Sage did, each person's try
import "@/styles/cockpit.css";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { SiteFooter } from "@/components/site/site-footer";
import { TestBefore } from "@/components/test/test-before";
import { TestLive } from "@/components/test/test-live";
import { getFounderAddress } from "@/lib/auth/founder";
import { hasMissionPlan } from "@/lib/campaigns/vault-kind";
import { getCampaign } from "@/lib/db/campaigns";
import { getInspectionJob } from "@/lib/db/inspection";
import { testPath } from "@/lib/site/test-path";
import { hostOf } from "@/lib/site/when";
import { beforeView } from "@/lib/test-page/before";
import { liveView } from "@/lib/test-page/live";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ID = /^[A-Za-z0-9_-]{1,80}$/;

/**
 * A TEST, /t/<id>: one page for the builder, the tester and anyone with the link, from the moment
 * Sage starts trying a product to what people found.
 *
 * The id is the inspection's while Sage is trying the product and writing the missions, and the
 * campaign's once it is paid for. A plan that has been paid for sends its old address to the test's
 * own. A campaign from before missions existed keeps its board at /c/<id>: that page stays alive.
 */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  if (!ID.test(id)) return {};
  const campaign = getCampaign(id);
  if (campaign) {
    return { title: campaign.title, description: "A paid test on Sage. Try the product, answer honestly, and Sage checks your answer and pays you in USDC, with a public receipt.", alternates: { canonical: testPath(id) } };
  }
  const job = getInspectionJob(id);
  const host = job ? hostOf(job.productUrl) : null;
  // a plan nobody has paid for is its owner's working page, not something to index
  return { title: host ? `Sage tries ${host}` : "A test", robots: { index: false } };
}

export default async function TestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!ID.test(id)) notFound();
  const viewer = await getFounderAddress();

  const campaign = getCampaign(id);
  if (campaign) {
    if (!hasMissionPlan(campaign.vaultKind)) redirect(`/c/${campaign.id}`);
    const view = liveView(campaign, viewer);
    if (campaign.status === "draft" && view.viewer !== "owner") notFound();
    return (
      <div className="sg">
        <main className="sg-main">
          <TestLive initial={view} />
        </main>
        <SiteFooter />
      </div>
    );
  }

  const job = getInspectionJob(id);
  if (!job) notFound();
  const launched = getCampaign(job.publicCampaignId);
  if (launched) redirect(testPath(launched.id));
  return (
    <div className="sg">
      <main className="sg-main">
        <TestBefore initial={beforeView(job, viewer)} />
      </main>
      <SiteFooter />
    </div>
  );
}
