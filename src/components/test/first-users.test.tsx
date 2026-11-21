import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { KeepPostedContact } from "@/lib/report/keep-posted";
import type { FirstUsersView } from "@/lib/users";
import { factsFrom, plainDrafts } from "@/lib/users/core";
import { venuesFor } from "@/lib/users/venues";
import { FirstUsers } from "./first-users";

/**
 * The owner's stage: drafts they can change, each door opening the channel's own compose screen with
 * the words as they stand, the testers who asked (in BCC, never in a draft), and nothing sent by Sage.
 */
const URL_ = "https://dropkit.app";
const facts = factsFrom({
  productUrl: URL_,
  host: "dropkit.app",
  productName: "Dropkit",
  says: "Drops for your community",
  category: "developer tool / docs",
  inviteOnly: false,
  findings: {
    paid: { people: 10 },
    core: { mainAction: "start a drop", understood: { says: null, sorted: 10, yes: 7 }, action: { tapped: 10, finished: 4 }, again: { tapped: 10, yes: 6 } },
    findings: [{ title: "Sign up is hard to find", kind: "stuck", count: 4, quotes: [{ text: "I could not find where to sign up on my phone." }] }],
  },
});
const users = (over: Partial<FirstUsersView> = {}): FirstUsersView => ({
  version: "v1",
  productUrl: URL_,
  name: "Dropkit",
  hasFindings: true,
  drafts: plainDrafts(facts),
  engine: "plain",
  open: false,
  canReword: false,
  venues: venuesFor(facts.category),
  door: "intent",
  ...over,
});
const contacts: KeepPostedContact[] = [
  { submissionId: "s1", kind: "email", contact: "ana@mail.example", at: 1 },
  { submissionId: "s2", kind: "email", contact: "bo@mail.example", at: 2 },
  { submissionId: "s3", kind: "x", contact: "@realtester", at: 3 },
  { submissionId: "s4", kind: "wallet", contact: "0x1111111111111111111111111111111111111111", at: 4 },
];
const href = (name: RegExp) => (screen.getByRole("link", { name }) as HTMLAnchorElement).getAttribute("href")!;
const param = (name: RegExp, key: string) => new URL(href(name)).searchParams.get(key);
const show = (u: FirstUsersView | null = users(), c: KeepPostedContact[] = contacts) =>
  render(
    <FirstUsers campaignId="c1" users={u} contacts={c} wanted={c.length}>
      <p>the switches</p>
    </FirstUsers>,
  );

afterEach(() => vi.restoreAllMocks());

describe("Get your first users", () => {
  it("opens each channel's own compose screen with the builder's words and their product's link", () => {
    show();
    const post = (screen.getByLabelText("The short one") as HTMLTextAreaElement).value;
    expect(post).toContain("I paid 10 strangers to try Dropkit.");
    expect(param(/Post on X/, "text")).toBe(post);
    expect(href(/Post on X/).startsWith("https://x.com/intent/post?")).toBe(true);
    expect(param(/^Telegram/, "url")).toBe(URL_);
    expect(param(/^Telegram/, "text")).not.toContain(URL_);
    expect(param(/WhatsApp/, "text")).toBe(post);
    expect(param(/open LinkedIn/, "url")).toBe(URL_);
    expect(param(/^Reddit/, "url")).toBe(URL_);
    expect(param(/^Reddit/, "title")).toContain("I paid 10 strangers");
    expect(param(/^Hacker News$/, "u")).toBe(URL_);
    expect(param(/^Hacker News$/, "t")).toBe("Show HN: Dropkit – Drops for your community");
    expect(href(/Email it/)).toMatch(/^mailto:\?subject=/);
    expect(screen.getByText(/of 280 on X/).textContent).toMatch(/^\d+ of 280 on X$/);
    expect(screen.getByText("the switches")).toBeInTheDocument();
  });

  it("sends what the builder changed, not what Sage drafted", () => {
    show();
    fireEvent.change(screen.getByLabelText("The short one"), { target: { value: "My own words. https://dropkit.app" } });
    expect(param(/Post on X/, "text")).toBe("My own words. https://dropkit.app");
    expect(screen.getByText("37 of 280 on X")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Undo my changes" }));
    expect(param(/Post on X/, "text")).toContain("I paid 10 strangers");
  });

  it("warns when the short one runs past what X takes", () => {
    show();
    fireEvent.change(screen.getByLabelText("The short one"), { target: { value: "word ".repeat(70) } });
    expect(screen.getByText(/of 280 on X/).className).toContain("sg-note-problem");
  });

  it("writes to the testers who asked in BCC, links a handle to its profile, and says a wallet can't be written to", () => {
    show();
    const mail = href(/Email all 2/);
    expect(mail.startsWith("mailto:?bcc=ana%40mail.example,bo%40mail.example&subject=")).toBe(true);
    expect(mail).not.toMatch(/realtester|0x1111/);
    expect(href(/@realtester/)).toBe("https://x.com/realtester");
    expect(screen.getByText("wallet only")).toBeInTheDocument();
    expect(screen.getByText(/1 person left only a wallet/)).toBeInTheDocument();
    expect(screen.getByText("4 people")).toBeInTheDocument();
  });

  it("keeps every contact out of every draft and every share link", () => {
    show();
    const drafts = [...document.querySelectorAll("textarea, input")].map((el) => (el as HTMLInputElement).value).join("\n");
    expect(drafts).not.toMatch(/ana@|bo@|realtester|0x1111/);
    const doors = [...document.querySelectorAll("a[href]")].map((a) => a.getAttribute("href")!).filter((h) => !h.startsWith("mailto:?bcc=") && h !== "https://x.com/realtester");
    expect(doors.join("\n")).not.toMatch(/ana%40|bo%40|realtester|0x1111/);
  });

  it("offers no note when nobody asked, and no Show HN for reading material", () => {
    const media = { ...facts, category: "content / media" };
    show(users({ drafts: plainDrafts(media), venues: venuesFor(media.category) }), []);
    expect(screen.queryByLabelText("Subject")).toBeNull();
    expect(screen.getByText(/A tester who liked it can tap Keep me posted/)).toBeInTheDocument();
    expect(screen.queryByLabelText("As a Show HN")).toBeNull();
    expect(screen.queryByRole("link", { name: /^Hacker News: Show HN/ })).toBeNull();
  });

  it("lists where to post with each venue's rule", () => {
    show();
    const venue = screen.getByRole("link", { name: /r\/webdev/ });
    expect(venue.getAttribute("href")).toBe("https://www.reddit.com/r/webdev/");
    expect(screen.getByText(/only on Showoff Saturday/)).toBeInTheDocument();
  });

  it("asks for the first people before anyone is paid", () => {
    const early = { ...facts, people: 0, understood: null, finished: null, again: null, problem: null, quotes: [] };
    show(users({ hasFindings: false, open: true, drafts: plainDrafts(early) }), []);
    expect(screen.getByRole("heading", { name: "Ask people to try it" })).toBeInTheDocument();
    expect(screen.getByText(/While places are open/)).toBeInTheDocument();
    expect((screen.getByLabelText("The short one") as HTMLTextAreaElement).value).toContain("I'm looking for the first people to try Dropkit.");
  });

  it("still shows who asked and Sage's switches when the test has no product address", () => {
    show(null);
    expect(screen.getByText(/no product address/)).toBeInTheDocument();
    expect(screen.queryByLabelText("The short one")).toBeNull();
    expect(screen.getByText("ana@mail.example")).toBeInTheDocument();
    expect(screen.getByText("the switches")).toBeInTheDocument();
  });

  it("asks Sage to reword only on the builder's tap, and keeps the builder's own changes", async () => {
    const reworded = users({ engine: "test-model", drafts: { ...plainDrafts(facts), post: `Reworded by the model.\n\n${URL_}`, long: `A longer rewording.\n\n${URL_}` } });
    const fetched = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ok: true, users: reworded }), { status: 200 }));
    show(users({ canReword: true }));
    expect(fetched).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("The long one"), { target: { value: "Mine." } });
    fireEvent.click(screen.getByRole("button", { name: "Have Sage reword them" }));
    await waitFor(() => expect((screen.getByLabelText("The short one") as HTMLTextAreaElement).value).toContain("Reworded by the model."));
    expect(fetched).toHaveBeenCalledWith("/api/campaigns/c1/users", { method: "POST" });
    expect((screen.getByLabelText("The long one") as HTMLTextAreaElement).value).toBe("Mine.");
    expect(screen.queryByRole("button", { name: "Have Sage reword them" })).toBeNull();
  });

  it("says so plainly when Sage could not reword them, and leaves the drafts as they were", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    show(users({ canReword: true }));
    fireEvent.click(screen.getByRole("button", { name: "Have Sage reword them" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Sage couldn't be reached");
    expect((screen.getByLabelText("The short one") as HTMLTextAreaElement).value).toContain("I paid 10 strangers");
  });
});
