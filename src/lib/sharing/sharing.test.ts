import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { db } from "@/lib/db";
import { campaignSharing } from "@/lib/db/schema";
import { QUIET, setSharing, sharingFor } from "./index";

/** Sharing is the builder's opt-in: quiet by default, and one switch never flips another. */

beforeEach(() => {
  db.delete(campaignSharing).run();
});

describe("sharingFor", () => {
  it("is quiet for a test the builder never answered for", () => {
    expect(sharingFor("gig-none")).toEqual(QUIET);
  });

  it("returns a copy, so a caller can't change the default", () => {
    const s = sharingFor("gig-none");
    s.postMission = true;
    expect(sharingFor("gig-none").postMission).toBe(false);
  });
});

describe("setSharing", () => {
  it("records the builder's answers", () => {
    setSharing("gig-a", { postMission: true, postResult: true, findingsPublic: true }, 100);
    expect(sharingFor("gig-a")).toEqual({ postMission: true, postResult: true, findingsPublic: true });
  });

  it("keeps the answers a partial update doesn't name", () => {
    setSharing("gig-b", { postMission: true, findingsPublic: true }, 100);
    setSharing("gig-b", { findingsPublic: false }, 200);
    expect(sharingFor("gig-b")).toEqual({ postMission: true, postResult: false, findingsPublic: false });
  });

  it("ignores fields that are not real booleans", () => {
    setSharing("gig-c", { postMission: true }, 100);
    setSharing("gig-c", { postMission: "no" as unknown as boolean, postResult: undefined }, 200);
    expect(sharingFor("gig-c").postMission).toBe(true);
    expect(sharingFor("gig-c").postResult).toBe(false);
  });

  it("keeps each test's answers apart", () => {
    setSharing("gig-d", { postResult: true }, 100);
    expect(sharingFor("gig-e")).toEqual(QUIET);
  });
});
