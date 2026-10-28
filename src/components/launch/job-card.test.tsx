import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { JobCard, type CardPatch } from "./job-card";
import { blankTranche, type Tranche } from "@/lib/launch/composer";

/**
 * THE JOB, AS ONE CARD: the founder's two decisions (what it pays, who can do it) are taps, Sage's
 * decisions are written out, and every change lands in the composer's own state.
 */
const gig = (over: Partial<Tranche> = {}): Tranche => ({ ...blankTranche(), title: "Fix the crash", deliverable: "the crash on PDFs over 10 MB is fixed", criteria: ["The fix stops the crash", "It adds a test with a 12 MB file"], ...over });

function Harness(props: { tranches: Tranche[]; splitTotal?: string; canInvite?: boolean | null; spy?: (p: CardPatch) => void }) {
  const [st, setSt] = useState({ slots: "1", tranches: props.tranches, splitTotal: props.splitTotal ?? "", inviteOnly: false });
  return (
    <>
      <JobCard
        title="Fix the crash on PDF uploads"
        from="github.com/acme/app/issues/42"
        slots={st.slots}
        tranches={st.tranches}
        splitTotal={st.splitTotal}
        shares={st.tranches.map(() => (Number(st.splitTotal) / st.tranches.length).toFixed(2))}
        currencySymbol="$"
        isLocal={false}
        inviteOnly={st.inviteOnly}
        canInvite={props.canInvite ?? true}
        chainName={() => "Metis"}
        onChange={(p) => { props.spy?.(p); setSt((s) => ({ ...s, ...p })); }}
        onDetails={() => {}}
        detailsOpen={false}
        action={<button type="button">go</button>}
      />
      <output data-testid="state">{JSON.stringify({ slots: st.slots, amount: st.tranches[0]?.amount, splitTotal: st.splitTotal, invite: st.inviteOnly, checks: st.tranches[0]?.criteria?.length })}</output>
    </>
  );
}
const state = () => JSON.parse(screen.getByTestId("state").textContent ?? "{}");

describe("the job card", () => {
  it("says where the job came from and what kind it is", () => {
    render(<Harness tranches={[gig()]} />);
    expect(screen.getByText("Fix the crash on PDF uploads")).toBeTruthy();
    expect(screen.getByText(/From github.com\/acme\/app\/issues\/42 · A gig for one person/)).toBeTruthy();
  });

  it("sets the pay with a tap, or a typed amount under Other", async () => {
    render(<Harness tranches={[gig()]} />);
    await userEvent.click(screen.getByRole("button", { name: "$50" }));
    expect(state().amount).toBe("50");
    expect(screen.getByRole("button", { name: "$50" }).getAttribute("aria-pressed")).toBe("true");
    await userEvent.click(screen.getByRole("button", { name: "Other" }));
    await userEvent.type(screen.getByLabelText("What it pays each person"), "7.5");
    expect(state().amount).toBe("7.5");
  });

  it("counts people with the stepper, and calls more than one a bounty", async () => {
    render(<Harness tranches={[gig()]} />);
    await userEvent.click(screen.getByRole("button", { name: "One person more" }));
    await userEvent.click(screen.getByRole("button", { name: "One person more" }));
    expect(state().slots).toBe("3");
    expect(screen.getByText(/A bounty for 3 people/)).toBeTruthy();
  });

  it("chooses who with a tap, and is honest when invites need a plan", async () => {
    render(<Harness tranches={[gig()]} canInvite={false} />);
    await userEvent.click(screen.getByRole("button", { name: "People I invite" }));
    expect(state().invite).toBe(true);
    expect(screen.getByText(/Invite links come with Pro/)).toBeTruthy();
  });

  it("drops one of Sage's checks with a tap, and always keeps one", async () => {
    render(<Harness tranches={[gig()]} />);
    await userEvent.click(screen.getByRole("button", { name: /Drop the check: It adds a test/ }));
    expect(state().checks).toBe(1);
    expect(screen.queryByRole("button", { name: /Drop the check/ })).toBeNull();
  });

  it("asks for the contract when the work is a transaction and none is named", async () => {
    render(<Harness tranches={[gig({ verify: "onchain", toAddr: "", txChain: 1088 })]} />);
    expect(screen.getByText("The contract the transaction must go to")).toBeTruthy();
    expect(screen.getByText(/Sage checks the transaction on Metis, sent from their own wallet/)).toBeTruthy();
  });

  it("prices a grant as one total, split across its milestones", async () => {
    const spy = vi.fn();
    render(<Harness tranches={[gig({ title: "The plan" }), gig({ title: "The build" })]} spy={spy} />);
    expect(screen.getByText(/A grant in 2 milestones/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "$100" }));
    expect(state().splitTotal).toBe("100");
    expect([...document.querySelectorAll(".jc-share")].map((e) => e.textContent)).toEqual(["$50", "$50"]);
  });
});
