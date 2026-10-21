import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { PeoplePanel, type PeopleView } from "./people-panel";

/**
 * TEAMS CAN READ THEIR PEOPLE'S RECORDS (20 Oct 2026). Every payment a member receives lands on their
 * own public record; the Team screen opens it, and the printable statement, beside each name. A member
 * who joined from Telegram before Sage knew their wallet has no record to open yet, so they get no link
 * rather than a broken one.
 */
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const OWNER = `0x${"a".repeat(40)}`;
const MEMBER = `0x${"B".repeat(40)}`;

function view(plan: PeopleView["workspace"]["plan"]): PeopleView {
  return {
    workspace: { id: "ws_test", name: "Coop", plan, memberCap: 50 },
    members: [
      { key: OWNER, address: OWNER, role: "owner", displayName: null, joinedAt: 1_700_000_000, viaTelegram: false },
      { key: MEMBER.toLowerCase(), address: MEMBER, role: "member", displayName: "Marcia", joinedAt: 1_700_000_100, viaTelegram: false },
      { key: "tg:42", address: null, role: "member", displayName: "Devon", joinedAt: 1_700_000_200, viaTelegram: true },
    ],
    memberCount: 3,
    me: OWNER,
  };
}

describe("Team: records and statements", () => {
  it("opens each member's record and statement, and skips a member with no wallet yet", () => {
    render(<PeoplePanel {...view("free")} />);
    const marcia = screen.getByText("Marcia").closest("li") as HTMLElement;
    const links = within(marcia).getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(links).toContain(`/record/${MEMBER.toLowerCase()}`);
    expect(links).toContain(`/record/${MEMBER.toLowerCase()}/statement`);
    const devon = screen.getByText("Devon").closest("li") as HTMLElement;
    expect(within(devon).queryAllByRole("link")).toHaveLength(0);
  });

  it("offers the payouts export on plans that include it, and names the plan that does otherwise", () => {
    const { unmount } = render(<PeoplePanel {...view("pro")} />);
    expect(screen.getByRole("link", { name: /Every payout \(CSV\)/ }).getAttribute("href")).toBe("/api/workspaces/export?kind=payouts");
    unmount();
    render(<PeoplePanel {...view("free")} />);
    const locked = screen.getByRole("link", { name: /Every payout \(CSV\) · Pro/ });
    expect(locked.getAttribute("href")).toBe("/checkout?plan=pro");
  });
});
