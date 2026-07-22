import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { runInspectionProbe, type InspectionProbeV1 } from "./inspection-replay";

/**
 * Real-browser inspection-replay tests against CONTROLLED local products (through the guarded egress
 * proxy). Proves each classification is EARNED — a "reproduced" is emitted only after the browser actually
 * performed the action and verified the change. Skipped unless INSPECTION_REPLAY_TEST=1 (needs chromium).
 */
const LIVE = process.env.INSPECTION_REPLAY_TEST === "1";

interface Fixture { origin: string; port: number; setHandler: (h: http.RequestListener) => void; close: () => Promise<void> }
async function fixture(initial: http.RequestListener): Promise<Fixture> {
  let handler = initial;
  const server = http.createServer((req, res) => handler(req, res));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as AddressInfo).port;
  return { origin: `http://127.0.0.1:${port}`, port, setHandler: (h) => { handler = h; }, close: () => new Promise<void>((r) => server.close(() => r())) };
}
const html = (body: string): http.RequestListener => (_q, res) => { res.writeHead(200, { "content-type": "text/html" }); res.end(`<!doctype html><html><body>${body}</body></html>`); };

let fx: Fixture;
function probe(over: Partial<InspectionProbeV1>): InspectionProbeV1 {
  return {
    version: "inspection-probe-v1", id: "test-probe", startUrl: fx.origin + "/", beforeStateDigest: "b",
    verb: "click", locator: { role: "button", accessibleName: "Start" }, expectedAddedTexts: ["Talk to Yara"],
    expectedAfterUrl: fx.origin + "/", sourceTransitionId: "t", sourceFactIds: ["f"], timeoutMs: 8000, ...over,
  };
}
const hooks = () => ({ allowLoopback: new Set([`127.0.0.1:${fx.port}`]), egressAllowedPorts: new Set([80, 443, fx.port]) });

describe.runIf(LIVE)("inspection replay — real browser, controlled products", () => {
  beforeAll(async () => { fx = await fixture(html("<h1>hi</h1>")); }, 60_000);
  afterAll(async () => { await fx?.close(); });

  it("a click→text transition REPRODUCES (event emitted only after the browser verified it)", async () => {
    fx.setHandler(html(`<button id="s">Start</button><div id="o"></div><script>document.getElementById('s').onclick=()=>document.getElementById('o').textContent='Talk to Yara';</script>`));
    const r = await runInspectionProbe(probe({}), hooks());
    expect(r.classification).toBe("reproduced");
    expect(r.events.map((e) => e.event)).toContain("replay_reproduced");
    // the reproduced event comes AFTER a real action + observation
    const kinds = r.events.map((e) => e.event);
    expect(kinds.indexOf("replay_reproduced")).toBeGreaterThan(kinds.indexOf("replay_action"));
  }, 40_000);

  it("a press→state transition REPRODUCES", async () => {
    fx.setHandler(html(`<div id="o">menu</div><script>document.addEventListener('keydown',e=>{if(e.key===' '||e.code==='Space')document.getElementById('o').textContent='Talk to Yara';});</script>`));
    const r = await runInspectionProbe(probe({ verb: "press", key: "Space", locator: {} }), hooks());
    expect(r.classification).toBe("reproduced");
  }, 40_000);

  it("an AMBIGUOUS target is rejected (two matching buttons)", async () => {
    fx.setHandler(html(`<button>Start</button><button>Start</button>`));
    const r = await runInspectionProbe(probe({}), hooks());
    expect(r.classification).toBe("locator_ambiguous");
    expect(r.events.at(-1)).toMatchObject({ event: "replay_failed", category: "locator_ambiguous" });
  }, 40_000);

  it("NO observable change is honestly classified (button does nothing)", async () => {
    fx.setHandler(html(`<button>Start</button><div>static</div>`));
    const r = await runInspectionProbe(probe({}), hooks());
    expect(r.classification).toBe("no_observable_change");
    expect(r.events.map((e) => e.event)).not.toContain("replay_reproduced");
  }, 40_000);

  it("PRODUCT DRIFT — the target is gone", async () => {
    fx.setHandler(html(`<div>no start button here anymore</div>`));
    const r = await runInspectionProbe(probe({}), hooks());
    expect(r.classification).toBe("product_drift");
  }, 40_000);

  it("PRODUCT DRIFT — a change occurs but not the expected one", async () => {
    fx.setHandler(html(`<button id="s">Start</button><div id="o"></div><script>document.getElementById('s').onclick=()=>document.getElementById('o').textContent='Something Else Entirely';</script>`));
    const r = await runInspectionProbe(probe({}), hooks());
    expect(r.classification).toBe("product_drift");
    expect(r.observedChange).toBe(true);
    expect(r.events.map((e) => e.event)).not.toContain("replay_reproduced"); // never claims success it didn't verify
  }, 40_000);

  it("a hung entry navigation → probe_flake/infrastructure, cleaned up (never a false reproduced)", async () => {
    fx.setHandler(() => { /* never respond */ });
    const r = await runInspectionProbe(probe({ timeoutMs: 3000 }), hooks());
    expect(["probe_flake", "infrastructure_failure"]).toContain(r.classification);
    expect(r.events.map((e) => e.event)).not.toContain("replay_reproduced");
  }, 40_000);
});
