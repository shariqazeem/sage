import { LinkClient } from "@/components/link/link-client";

export const dynamic = "force-dynamic";

/**
 * `/link/<token>` — the founder opened the one-time link @sagedeputybot handed them. They connect
 * their wallet, prove control (SIWE), and set a per-campaign cap; that pairs the wallet to their
 * chat and mints their policy-guarded agent wallet. The token is opaque here — the server consumes
 * it in `/api/tg/link` and takes the address from the SIWE session, never from the client.
 */
export default async function LinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <LinkClient token={token} />;
}
