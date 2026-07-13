import { redirect } from "next/navigation";

// Creating a campaign now happens inside the app shell (Agents → New campaign).
// This route only redirects — the standalone form was removed in Pass 10.
export default function NewCampaignRedirect() {
  redirect("/launch");
}
