import { redirect } from "next/navigation";

// Campaign management now lives inside the app shell (Agents tab). This route
// only redirects — the standalone poster page was removed in Pass 10.
export default function CampaignsRedirect() {
  redirect("/launch");
}
