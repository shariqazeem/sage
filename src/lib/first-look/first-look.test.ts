import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { firstLooks } from "@/lib/db/schema";
import { PLAIN_ENGINE } from "./core";
import { firstLookFor, recordFirstLook, storedFirstLook, wordFirstLook, plainLookFor, type LookDeps } from "./index";

/**
 * The first look against the real table: the plain look is stored at once, a model's wording
 * replaces it only when it survives the contract, and no failure of a model is ever a dead end.
 */
const URL_ = "https://drops.example/";
const map = {
  productName: "Drops",
  category: "consumer app",
  valueProp: "Send a gift to anyone with a link.",
  limitations: [],
  fieldTest: {
    ran: true,
    startUrl: URL_,
    mode: "interactive",
    classification: null,
    limitation: null,
    durationMs: 30_000,
    pages: [],
    states: [
      { trigger: "initial load", actionKind: "load", screenshot: "/api/field-tests/J/0", visibleTextExcerpt: "Drops\nStart a drop", notableElements: [], pixelDeltaPct: 100, url: URL_ },
      { trigger: "waited out loading", actionKind: "wait", screenshot: "/api/field-tests/J/1", visibleTextExcerpt: "Loading", notableElements: [], pixelDeltaPct: 3, url: URL_ },
    ],
  },
};

beforeEach(() => {
  db.delete(firstLooks).run();
});

describe("recordFirstLook", () => {
  it("stores Sage's plain look at once, then the worded one on the DRAFT lane", async () => {
    let seenAtCall: string | null = null;
    const deps: LookDeps = {
      modelConfigured: () => true,
      complete: vi.fn(async (opts) => {
        // the plain look is already readable while the model is still thinking
        seenAtCall = storedFirstLook("job1")?.engine ?? null;
        const slow = /(E\d+) kind=slow/.exec(opts.user)![1];
        return { json: { problems: [{ evidence: [slow], title: "The first visit sits on a loading screen", fix: "Show the page frame before the data arrives." }] }, model: "m", responseModel: "m-served" };
      }),
    };
    const look = await recordFirstLook("job1", map, URL_, deps);
    expect(seenAtCall).toBe(PLAIN_ENGINE);
    expect(look?.engine).toBe("m-served");
    expect(storedFirstLook("job1")).toMatchObject({ engine: "m-served", problems: [{ wordedBy: "model", title: "The first visit sits on a loading screen" }] });
    const call = vi.mocked(deps.complete!).mock.calls[0]![0];
    expect(call.lane).toBe("DRAFT");
    expect(call.user).toContain("<<<UNTRUSTED_INSPECTED_PRODUCT>>>");
  });

  it("keeps the plain look when the model fails, is out of credit, or answers nonsense", async () => {
    for (const complete of [
      async () => {
        throw new Error("llm_status_402");
      },
      async () => ({ json: { problems: [{ evidence: ["E99"], title: "Invented", fix: "Invented fix here." }] }, model: "m" }),
      async () => ({ json: null, model: "m" }),
    ]) {
      db.delete(firstLooks).run();
      const look = await recordFirstLook("job2", map, URL_, { modelConfigured: () => true, complete });
      expect(look?.engine).toBe(PLAIN_ENGINE);
      expect(storedFirstLook("job2")).toMatchObject({ engine: PLAIN_ENGINE, problems: [{ kind: "slow", wordedBy: "sage" }] });
    }
  });

  it("asks no model when none is configured, or when there is nothing to word", async () => {
    const complete = vi.fn();
    await recordFirstLook("job3", map, URL_, { modelConfigured: () => false, complete });
    const quiet = { ...map, valueProp: "", fieldTest: { ...map.fieldTest, states: [map.fieldTest.states[0]] } };
    const plain = plainLookFor(quiet, URL_);
    expect(await wordFirstLook(plain, quiet, { modelConfigured: () => true, complete })).toBe(plain);
    expect(complete).not.toHaveBeenCalled();
  });

  it("never throws, whatever the map is", async () => {
    await expect(recordFirstLook("job4", null, "not a url", { modelConfigured: () => false })).resolves.toMatchObject({ problems: [], ran: false });
  });
});

describe("firstLookFor", () => {
  it("reads the stored look, and builds a plain one from the stored map for a run from before this existed", () => {
    expect(firstLookFor({ id: "old", productUrl: URL_, result: null })).toBeNull();
    const built = firstLookFor({ id: "old", productUrl: URL_, result: { map } });
    expect(built).toMatchObject({ engine: PLAIN_ENGINE, host: "drops.example", problems: [{ kind: "slow" }] });
    expect(storedFirstLook("old")).toBeNull();
  });
});
