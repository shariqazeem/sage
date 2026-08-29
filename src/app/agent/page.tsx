import type { Metadata } from "next";
import { AgentChat } from "@/components/agent/agent-chat";

// The root layout applies `template: "%s · Sage"`, so naming Sage here rendered "Agent · Sage · Sage".
export const metadata: Metadata = { title: "Agent" };

/**
 * P27 — the light, full-page Agent chat. The same web concierge (`/api/agent`) as the Telegram bot,
 * read-only (no money tools; funding is a hand-off). The dark overlay it replaces is deleted.
 */
export default function AgentPage() {
  return <AgentChat />;
}
