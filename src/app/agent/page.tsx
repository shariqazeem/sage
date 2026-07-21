import type { Metadata } from "next";
import { AgentChat } from "@/components/agent/agent-chat";

export const metadata: Metadata = { title: "Agent · Sage" };

/**
 * P27 — the light, full-page Agent chat. The same web concierge (`/api/agent`) as the Telegram bot,
 * read-only (no money tools; funding is a hand-off). The dark overlay it replaces is deleted.
 */
export default function AgentPage() {
  return <AgentChat />;
}
