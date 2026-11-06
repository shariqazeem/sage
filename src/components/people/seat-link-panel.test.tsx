import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SeatLinkPanel } from "./seat-link-panel";

/**
 * THE NEXT MOVE AFTER LAUNCHING WORK FOR YOUR OWN PEOPLE (seat-link-panel.tsx, 6 Nov 2026): one link, how
 * many joined, and the message to send, with share doors that carry that message and link.
 */

const LINK = {
  url: "https://sagepays.xyz/join/seat_abc123def456gh",
  seats: 10,
  taken: 2,
  message: "Write a thread about Metis: I'm paying $5 in USDC every week for this. Open your link, sign in with your email, and do it there. Sage checks the work and pays you in minutes, with a receipt. https://sagepays.xyz/join/seat_abc123def456gh",
  programmeId: "prg_x",
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("sending a job to your people", () => {
  it("shows the one link's places, who joined, the message, and shares exactly that", async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ ok: true, link: LINK }), { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    render(<SeatLinkPanel campaignId="gig-1" />);
    expect(await screen.findByText(/Send it to your people/)).toBeTruthy();
    expect(screen.getByText(/One link, 10 places, the same link every week/)).toBeTruthy();
    expect(screen.getByText("2 of 10 joined")).toBeTruthy();
    expect(screen.getByText(LINK.message)).toBeTruthy();
    const wa = screen.getByRole("link", { name: /WhatsApp/ }) as HTMLAnchorElement;
    expect(decodeURIComponent(wa.href.split("text=")[1]!)).toBe(LINK.message);
    const tg = screen.getByRole("link", { name: /Telegram/ }) as HTMLAnchorElement;
    expect(tg.href).toContain(encodeURIComponent(LINK.url));
    expect(fetchSpy).toHaveBeenCalledWith("/api/seats", expect.objectContaining({ method: "POST", body: JSON.stringify({ campaignId: "gig-1" }) }));
  });

  it("says why when there is no link to send", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "This job is open to anyone: its page is the link to send." }), { status: 409 })));
    render(<SeatLinkPanel campaignId="gig-2" />);
    expect(await screen.findByText(/open to anyone/)).toBeTruthy();
  });
});
