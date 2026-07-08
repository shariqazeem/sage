import { redirect } from "next/navigation";

// The review queue now lives inside the app shell (Agents → campaign detail).
// This route only redirects — the standalone review page was removed in Pass 10.
export default function ReviewRedirect() {
  redirect("/app");
}
