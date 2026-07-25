import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  recordFieldTestStep,
  readFieldTestProgress,
  endFieldTestTrail,
} from "./field-test-progress";

/**
 * The live trail is the only thing standing between a founder and a motionless spinner, so it has
 * exactly two obligations: never invent a step, and never break the inspection.
 */

let cwd: string;
let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(tmpdir(), "sage-trail-"));
  cwd = process.cwd();
  process.chdir(tmp);
});
afterEach(async () => {
  process.chdir(cwd);
  await rm(tmp, { recursive: true, force: true });
});

const dirFor = (id: string) => path.join(tmp, "public", "field-tests", id);

describe("the trail records real steps in order", () => {
  it("appends each step with its own index and keeps the order", async () => {
    endFieldTestTrail("job1");
    await recordFieldTestStep("job1", { label: "initial load", screenshot: "/s/0", url: "https://x/" }, 1000);
    await recordFieldTestStep("job1", { label: 'clicked "come in →"', screenshot: "/s/1", url: "https://x/" }, 2000);

    const steps = await readFieldTestProgress("job1");
    expect(steps).toHaveLength(2);
    expect(steps.map((s) => s.n)).toEqual([0, 1]);
    expect(steps[0]!.label).toBe("initial load");
    expect(steps[1]!.label).toBe('clicked "come in →"');
    expect(steps[0]!.at).toBe(1000);
  });

  it("keeps a step that produced no screenshot — the action still happened", async () => {
    endFieldTestTrail("job2");
    await recordFieldTestStep("job2", { label: "pressed Enter", screenshot: null, url: "https://x/" });
    const steps = await readFieldTestProgress("job2");
    expect(steps).toHaveLength(1);
    expect(steps[0]!.screenshot).toBeNull();
  });

  it("writes beside the screenshots it references", async () => {
    endFieldTestTrail("job3");
    await recordFieldTestStep("job3", { label: "a", screenshot: null, url: "u" });
    const raw = await readFile(path.join(dirFor("job3"), "progress.json"), "utf8");
    expect(JSON.parse(raw)).toMatchObject({ version: 1 });
  });
});

describe("it never invents and never breaks", () => {
  it("no trail yet is an empty list, not an error", async () => {
    await expect(readFieldTestProgress("never-ran")).resolves.toEqual([]);
  });

  it("a corrupt trail file reads as empty rather than throwing", async () => {
    await mkdir(dirFor("job4"), { recursive: true });
    await writeFile(path.join(dirFor("job4"), "progress.json"), "{not json", "utf8");
    await expect(readFieldTestProgress("job4")).resolves.toEqual([]);
  });

  it("a trail file with junk entries yields only the well-formed steps", async () => {
    await mkdir(dirFor("job5"), { recursive: true });
    await writeFile(
      path.join(dirFor("job5"), "progress.json"),
      JSON.stringify({ version: 1, steps: [null, { n: 0, label: "real", screenshot: null, url: "u" }, { nope: 1 }] }),
      "utf8",
    );
    const steps = await readFieldTestProgress("job5");
    expect(steps).toHaveLength(1);
    expect(steps[0]!.label).toBe("real");
  });

  it("recording never throws, even when the path cannot be written", async () => {
    endFieldTestTrail("job6");
    // a file where the directory must go — mkdir will fail
    await writeFile(path.join(tmp, "public"), "blocked", "utf8");
    await expect(
      recordFieldTestStep("job6", { label: "x", screenshot: null, url: "u" }),
    ).resolves.toBeUndefined();
  });

  it("is bounded — a runaway run cannot grow the trail without limit", async () => {
    endFieldTestTrail("job7");
    for (let i = 0; i < 420; i++) {
      await recordFieldTestStep("job7", { label: `step ${i}`, screenshot: null, url: "u" });
    }
    const steps = await readFieldTestProgress("job7");
    expect(steps.length).toBeLessThanOrEqual(400);
  });

  it("two inspections keep separate trails", async () => {
    endFieldTestTrail("a1");
    endFieldTestTrail("b1");
    await recordFieldTestStep("a1", { label: "from a", screenshot: null, url: "u" });
    await recordFieldTestStep("b1", { label: "from b", screenshot: null, url: "u" });
    expect((await readFieldTestProgress("a1")).map((s) => s.label)).toEqual(["from a"]);
    expect((await readFieldTestProgress("b1")).map((s) => s.label)).toEqual(["from b"]);
  });
});
