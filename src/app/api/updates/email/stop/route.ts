import type { NextRequest } from "next/server";

import { muteBuilderEmail } from "@/lib/builder-updates/email";
import { readStopToken } from "@/lib/builder-updates/email-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/updates/email/stop?t=<token>: the link at the foot of every email. One click, no sign-in.
 *
 * The token names one builder and is signed (email-core.ts `stopToken`); it never expires, because an old
 * email must still be able to stop the emails, and it can do only this. The answer is a plain page. A token
 * that was not signed here gets the same calm page shape and changes nothing.
 */
function page(title: string, line: string, status: number): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title} · Sage</title></head><body><main><h1>${title}</h1><p>${line}</p><p><a href="/">Sage</a></p></main></body></html>`;
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" } });
}

export async function GET(req: NextRequest) {
  const who = readStopToken(req.nextUrl.searchParams.get("t"));
  if (!who) return page("This link didn't work", "It may have been cut short when it was copied. Open the link from the email again, or turn email updates off on any of your tests.", 400);
  muteBuilderEmail(who);
  return page("Email updates are off", "Sage will not email you about your tests again. You can turn them back on from any of your tests.", 200);
}
