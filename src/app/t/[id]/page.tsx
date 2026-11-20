import { notFound, redirect } from "next/navigation";
import { getCampaign } from "@/lib/db/campaigns";
import { getInspectionJob } from "@/lib/db/inspection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A TEST'S ADDRESS, /t/<id>. A placeholder until the test page itself lands (another workstream
 * replaces this file): it sends an inspection's id to its plan, and a campaign's id to its board,
 * so every card and link in the relaunch can already point here (see `testPath`).
 */
export default async function TestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) notFound();
  if (getInspectionJob(id)) redirect(`/launch/${id}`);
  if (getCampaign(id)) redirect(`/c/${id}`);
  notFound();
}
