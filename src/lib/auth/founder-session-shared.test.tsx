import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";

import { useFounderSession, __resetFounderSessionForTest } from "./use-founder-session";

/**
 * ONE ANSWER, SHARED.
 *
 * Eleven components use this hook. Each used to mount its own uncached fetch of a `force-dynamic`
 * route, so opening a campaign page fired a burst of identical requests that raced: the rail could
 * still be waiting while the page already knew, and rendered "Sign in" to a founder who was signed
 * in. On a slow reply the shell felt stuck until a manual refresh.
 */

const fetchMock = vi.fn();

function Probe({ id }: { id: string }) {
  const s = useFounderSession();
  return (
    <div data-testid={id}>
      {s.loading ? "loading" : (s.address ?? "signed-out")}
    </div>
  );
}

beforeEach(() => {
  __resetFounderSessionForTest();
  fetchMock.mockReset().mockResolvedValue({
    json: async () => ({ address: "0x5db1", chain: "starknet" }),
  });
  vi.stubGlobal("fetch", fetchMock);
});

describe("mounting many components", () => {
  it("asks the server ONCE, not once per component", async () => {
    render(
      <>
        <Probe id="a" />
        <Probe id="b" />
        <Probe id="c" />
        <Probe id="d" />
      </>,
    );
    await waitFor(() => expect(screen.getByTestId("a")).toHaveTextContent("0x5db1"));
    const sessionCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes("/api/auth/founder"));
    expect(sessionCalls.length, "one request for the whole page").toBe(1);
  });

  it("gives every component the SAME answer, so none contradicts another", async () => {
    render(
      <>
        <Probe id="rail" />
        <Probe id="page" />
      </>,
    );
    await waitFor(() => expect(screen.getByTestId("rail")).toHaveTextContent("0x5db1"));
    // The reported symptom: the rail saying "Sign in" while the page knew otherwise.
    expect(screen.getByTestId("page")).toHaveTextContent("0x5db1");
    expect(screen.getByTestId("rail").textContent).toBe(screen.getByTestId("page").textContent);
  });

  it("a component mounted LATER reads the answer instead of asking again", async () => {
    const first = render(<Probe id="a" />);
    await waitFor(() => expect(screen.getByTestId("a")).toHaveTextContent("0x5db1"));
    first.rerender(
      <>
        <Probe id="a" />
        <Probe id="late" />
      </>,
    );
    await waitFor(() => expect(screen.getByTestId("late")).toHaveTextContent("0x5db1"));
    const sessionCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes("/api/auth/founder"));
    expect(sessionCalls.length).toBe(1);
  });

  it("keeps the last known identity when a poll fails, rather than signing a founder out", async () => {
    render(<Probe id="a" />);
    await waitFor(() => expect(screen.getByTestId("a")).toHaveTextContent("0x5db1"));
    fetchMock.mockRejectedValue(new Error("offline"));
    const { refreshFounderSession } = await import("./use-founder-session");
    await act(async () => {
      await refreshFounderSession();
    });
    // Flushed through React before asserting: the first version of this test read the DOM before
    // the re-render and so passed even when a failed poll DID clear the identity.
    expect(screen.getByTestId("a")).toHaveTextContent("0x5db1");
  });

  it("never reports 'loading' forever when the request fails on the very first try", async () => {
    __resetFounderSessionForTest();
    fetchMock.mockRejectedValue(new Error("offline"));
    render(<Probe id="a" />);
    // A permanent spinner is what made the shell feel stuck.
    await waitFor(() => expect(screen.getByTestId("a")).toHaveTextContent("signed-out"));
  });
});
