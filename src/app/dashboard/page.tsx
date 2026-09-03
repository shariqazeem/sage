import { redirect } from "next/navigation";
import { getDeputyOverview } from "@/lib/campaigns/overview";
import { listCampaigns } from "@/lib/db/campaigns";
import { reconcileStoppedMany } from "@/lib/campaigns/reconcile-stopped";
import { DashboardClient } from "@/components/dashboard/dashboard-client";
import { getFounderAddress, sameFounder } from "@/lib/auth/founder";
import { loadFounderDesk, type FounderDesk } from "@/lib/campaigns/founder-activity";

export const dynamic = "force-dynamic";

export const metadata = {
  // The root layout appends " · Sage" to child segments — naming it here rendered it twice.
  title: "Your campaigns",
  description: "Every campaign you own, what your AI agent has released, and a link into each console.",
};

/**
 * `/dashboard` — the returning-founder home base for the V2 campaign flow. A founder
 * signs in with the wallet they launched from and sees EVERY campaign they own
 * (`getDeputyOverview` filters by `posterWallet`), what the Deputy has released, and
 * a link into each console — plus "Launch new." No fixtures: an unsigned visitor gets
 * a connect prompt, a signed founder with none gets a designed empty state.
 */
export default async function DashboardPage() {
  const wallet = await getFounderAddress();
  // One door: a signed-out visitor is onboarded at /start and comes back here, not asked to
  // connect on a page that then has nothing to show them.
  if (!wallet) redirect("/start?next=/dashboard");
  if (wallet) {
    // The on-chain vault is the truth: mark any revoked (stopped) campaigns "cancelled" BEFORE the
    // overview reads the DB, so stopped-and-withdrawn campaigns file under "Stopped", not "Running".
    const mine = listCampaigns().filter((c) => sameFounder(c.posterWallet, wallet));
    await reconcileStoppedMany(mine);
  }
  const overview = getDeputyOverview(wallet);
  // The desk: the agent's recent work across everything this founder owns — server-fresh on every
  // load (the page is force-dynamic), no polling chrome on the home.
  const desk: FounderDesk = wallet ? loadFounderDesk(wallet, 8) : { events: [], lastWorkedAt: null };
  return (
    <DashboardClient
      signedIn={!!wallet}
      address={wallet}
      desk={desk}
      campaigns={overview.campaigns}
      paidAmountBase={overview.paidAmountBase}
      approvedRecipients={overview.approvedRecipients}
      totalPaid={overview.totalPaid}
    />
  );
}
