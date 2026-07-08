/**
 * Next.js instrumentation — runs once when the server process starts. We use it
 * for one job: validate the environment and print a single truthful line of
 * what's live vs pending. Malformed values hard-fail here, loudly, at boot —
 * before the Deputy ever tries to move money on a broken config.
 *
 * Guarded to the Node.js runtime (the env module is server-only + touches
 * `process.env`); the Edge runtime skips it.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { logBootSummary } = await import("@/lib/env");
  logBootSummary();
}
