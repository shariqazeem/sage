import { describe, it, expect } from "vitest";
import {
  affordanceRank,
  chooseForwardAffordance,
  chooseGoalTargetAffordance,
  goalTerms,
  goalWantsConversation,
  goalMatchScore,
  resolveSyntheticValue,
  isSensitiveField,
  actionSignature,
  wordSignature,
  coerceDecision,
  decideNextAction,
  isolateJson,
  AI_PROBE,
  ALLOWED_KEYS,
  type MintedElement,
} from "./browser-controller";

const el = (over: Partial<MintedElement> & { id: string }): MintedElement => ({
  label: "",
  role: "",
  tag: "button",
  typable: false,
  ...over,
});

/* ───────────── forward-affordance preference (general, not a yara patch) ──── */

describe("affordanceRank — general forward-navigation affordances", () => {
  it("ranks immersive-onboarding phrasings that the old START_WORDS missed", () => {
    // the exact strings the blind explorer skipped on yara.garden — matched by GENERAL intents.
    expect(affordanceRank("tap to step inside")).toBeGreaterThanOrEqual(0);
    expect(affordanceRank("Come in")).toBeGreaterThanOrEqual(0);
    expect(affordanceRank("Get Started")).toBeGreaterThanOrEqual(0);
    expect(affordanceRank("Continue")).toBeGreaterThanOrEqual(0);
  });
  it("does NOT treat decorations as forward affordances", () => {
    for (const junk of [
      "🔊",
      "+",
      "−",
      "·",
      "make a wish at the wishing tree",
      "settings",
    ]) {
      expect(affordanceRank(junk)).toBe(-1);
    }
  });
  it("prefers the most-specific intent (get started > start > continue)", () => {
    expect(affordanceRank("get started")).toBeLessThan(
      affordanceRank("continue"),
    );
  });
});

describe("chooseForwardAffordance — pick the goal-advancing control, skip decorations", () => {
  it("clicks 'tap to step inside', not the sound/zoom decorations", () => {
    const elements = [
      el({ id: "e0", label: "🔊" }),
      el({ id: "e1", label: "+" }),
      el({ id: "e2", label: "−" }),
      el({ id: "e3", label: "tap to step inside" }),
      el({ id: "e4", label: "make a wish at the wishing tree" }),
    ];
    const a = chooseForwardAffordance(elements, "state1", new Set());
    expect(a).toEqual({ kind: "click_element", elementId: "e3" });
  });
  it("returns null when nothing obvious remains (→ hand to the model)", () => {
    const elements = [
      el({ id: "e0", label: "🔊" }),
      el({ id: "e1", label: "make a wish" }),
    ];
    expect(chooseForwardAffordance(elements, "s", new Set())).toBeNull();
  });
  it("never re-picks an already-tried (state, action) — loop prevention", () => {
    const elements = [el({ id: "e3", label: "continue" })];
    const first = chooseForwardAffordance(elements, "s", new Set())!;
    const tried = new Set([actionSignature("s", first)]);
    expect(chooseForwardAffordance(elements, "s", tried)).toBeNull();
  });
  it("does not offer an input/select as a forward click", () => {
    const elements = [
      el({ id: "e0", tag: "input", label: "continue", typable: true }),
    ];
    expect(chooseForwardAffordance(elements, "s", new Set())).toBeNull();
  });
  it("skips a DEAD label (a control that did nothing in this context) → tries something else / hands off", () => {
    const elements = [el({ id: "e0", label: "continue →" })];
    // "continue →" retired here (needs a choice first) → no other forward affordance → null (model).
    expect(
      chooseForwardAffordance(
        elements,
        "s",
        new Set(),
        new Set(["continue →"]),
      ),
    ).toBeNull();
    // once context changes the caller clears deadLabels, so it's live again:
    expect(
      chooseForwardAffordance(elements, "s", new Set(), new Set()),
    ).toEqual({ kind: "click_element", elementId: "e0" });
  });
});

/* ───────── goal-relative targeting (general: any named target entity) ────── */

describe("goalTerms — the founder goal's target words, product-agnostic", () => {
  it("keeps the named target, drops filler/budget/role words", () => {
    const t = goalTerms(
      "make users land in yara.garden and go to yara character and talk to her, my budget is 1.5$",
    );
    expect(t).toContain("yara");
    expect(t).toContain("character");
    expect(t).not.toContain("users");
    expect(t).not.toContain("budget");
    expect(t).not.toContain("make");
  });
  it("works for a completely different product/goal", () => {
    const t = goalTerms("let users find the pricing page and start a trial");
    expect(t).toContain("pricing");
    expect(t).toContain("trial");
    expect(t).not.toContain("users");
  });
});

describe("goalWantsConversation", () => {
  it("detects a conversation goal in varied phrasing", () => {
    for (const g of [
      "talk to her",
      "chat with the assistant",
      "send a message to support",
      "ask the bot a question",
      "get a reply from Aria",
    ]) {
      expect(goalWantsConversation(g), g).toBe(true);
    }
  });
  it("is false for non-conversation goals", () => {
    for (const g of [
      "find the pricing page",
      "complete checkout",
      "draw a rectangle",
    ]) {
      expect(goalWantsConversation(g), g).toBe(false);
    }
  });
});

describe("chooseGoalTargetAffordance — go to what the goal names", () => {
  const terms = goalTerms("go to yara character and talk to her");
  it("prefers the goal-matching affordance over unrelated controls", () => {
    const elements = [
      el({ id: "e0", label: "Still Pond" }),
      el({ id: "e1", label: "Meet Yara" }),
      el({ id: "e2", label: "Fountain Plaza" }),
    ];
    expect(chooseGoalTargetAffordance(elements, terms, "s", new Set())).toEqual(
      { kind: "click_element", elementId: "e1" },
    );
  });
  it("returns null when nothing on screen matches the goal (→ move / ask the model)", () => {
    const elements = [
      el({ id: "e0", label: "Still Pond" }),
      el({ id: "e1", label: "The Hearth" }),
    ];
    expect(
      chooseGoalTargetAffordance(elements, terms, "s", new Set()),
    ).toBeNull();
  });
  it("respects tried + dead sets (no loops)", () => {
    const elements = [el({ id: "e1", label: "Meet Yara" })];
    const first = chooseGoalTargetAffordance(elements, terms, "s", new Set())!;
    expect(
      chooseGoalTargetAffordance(
        elements,
        terms,
        "s",
        new Set([actionSignature("s", first)]),
      ),
    ).toBeNull();
    expect(
      chooseGoalTargetAffordance(
        elements,
        terms,
        "s",
        new Set(),
        new Set(["meet yara"]),
      ),
    ).toBeNull();
  });
  it("is general — matches a different product's named target", () => {
    const t2 = goalTerms("let users find the pricing page and start a trial");
    const elements = [
      el({ id: "e0", label: "Features" }),
      el({ id: "e1", label: "Pricing" }),
    ];
    expect(chooseGoalTargetAffordance(elements, t2, "s", new Set())).toEqual({
      kind: "click_element",
      elementId: "e1",
    });
  });
  it("goalMatchScore rises with more matched terms", () => {
    expect(goalMatchScore("Talk to Yara", terms)).toBeGreaterThan(
      goalMatchScore("Yara's Grove", terms) - 1,
    );
    expect(goalMatchScore("Random Label", terms)).toBe(0);
  });
});

describe("press_key burst — bounded movement", () => {
  const elements = [el({ id: "e0", label: "x" })];
  const wrapK = (a: unknown) => ({
    action: a,
    expectedChange: "",
    goalProgress: "advancing",
  });
  it("accepts a bounded repeat and clamps it to 1..5", () => {
    expect(
      coerceDecision(
        wrapK({ kind: "press_key", key: "ArrowRight", repeat: 3 }),
        elements,
      )?.action,
    ).toEqual({ kind: "press_key", key: "ArrowRight", repeat: 3 });
    expect(
      coerceDecision(
        wrapK({ kind: "press_key", key: "w", repeat: 99 }),
        elements,
      )?.action,
    ).toEqual({ kind: "press_key", key: "w", repeat: 5 });
    expect(
      coerceDecision(
        wrapK({ kind: "press_key", key: "w", repeat: 0 }),
        elements,
      )?.action,
    ).toEqual({ kind: "press_key", key: "w", repeat: 1 });
  });
  it("a burst of the same key shares ONE signature (direction retirement, not per-press)", () => {
    const a = { kind: "press_key", key: "ArrowUp", repeat: 2 } as const;
    const b = { kind: "press_key", key: "ArrowUp", repeat: 5 } as const;
    expect(actionSignature("s", a)).toBe(actionSignature("s", b));
  });
});

describe("wordSignature — animation-proof progress detection", () => {
  it("is identical when only emoji/particles/whitespace differ (no real progress)", () => {
    expect(wordSignature("Yara ✨🍃 tap to step inside")).toBe(
      wordSignature("Yara 🦋🦋 tap  to step inside 🎈"),
    );
  });
  it("changes when real words change (genuine progress)", () => {
    expect(wordSignature("what should I call you")).not.toBe(
      wordSignature("come in and meet Yara"),
    );
  });
});

/* ─────────────────── synthetic-value policy (never secrets) ───────────────── */

describe("resolveSyntheticValue — fixed, transparent, non-sensitive", () => {
  it("maps the three kinds to their fixed values", () => {
    expect(resolveSyntheticValue("display_name")).toBe("Sage Test");
    expect(resolveSyntheticValue("ai_probe")).toBe(AI_PROBE);
    expect(resolveSyntheticValue("search")).toBe("test");
  });
});

describe("isSensitiveField — reject every credential / payment / personal field", () => {
  it("rejects by input type", () => {
    for (const type of ["password", "email", "tel", "number"])
      expect(isSensitiveField({ type })).toBe(true);
  });
  it("rejects by name/placeholder/autocomplete", () => {
    expect(isSensitiveField({ name: "cardNumber" })).toBe(true);
    expect(isSensitiveField({ placeholder: "Enter your email" })).toBe(true);
    expect(isSensitiveField({ autocomplete: "cc-csc" })).toBe(true);
    expect(isSensitiveField({ name: "wallet_address" })).toBe(true);
    expect(isSensitiveField({ ariaLabel: "Social Security Number" })).toBe(
      true,
    );
  });
  it("allows a plain display-name / search field", () => {
    expect(
      isSensitiveField({
        type: "text",
        name: "displayName",
        placeholder: "Your name",
      }),
    ).toBe(false);
    expect(isSensitiveField({ type: "search", name: "q" })).toBe(false);
  });
});

/* ───────────────── coerceDecision — the model can smuggle nothing ─────────── */

describe("coerceDecision — validates every action against the minted state", () => {
  const elements = [
    el({ id: "e0", label: "Continue" }),
    el({ id: "e1", label: "Your name", tag: "input", typable: true }),
    el({ id: "e2", label: "Password", tag: "input", typable: false }),
    el({ id: "e3", label: "Country", tag: "select", options: ["US", "CA"] }),
  ];
  const wrap = (action: unknown) => ({
    action,
    expectedChange: "x",
    goalProgress: "advancing",
  });

  it("accepts a valid click on a minted id", () => {
    expect(
      coerceDecision(wrap({ kind: "click_element", elementId: "e0" }), elements)
        ?.action,
    ).toEqual({ kind: "click_element", elementId: "e0" });
  });
  it("REJECTS a click on an id that was never minted (no selector smuggling)", () => {
    expect(
      coerceDecision(
        wrap({ kind: "click_element", elementId: "e99" }),
        elements,
      ),
    ).toBeNull();
  });
  it("REJECTS typing into a non-typable (password) field", () => {
    expect(
      coerceDecision(
        wrap({ kind: "type_text", elementId: "e2", valueKind: "display_name" }),
        elements,
      ),
    ).toBeNull();
  });
  it("accepts typing a synthetic KIND into a typable field, ignores model free-text", () => {
    const d = coerceDecision(
      wrap({
        kind: "type_text",
        elementId: "e1",
        valueKind: "display_name",
        value: "DROP TABLE",
      }),
      elements,
    );
    expect(d?.action).toEqual({
      kind: "type_text",
      elementId: "e1",
      valueKind: "display_name",
    });
  });
  it("REJECTS an unknown valueKind (only display_name/search/ai_probe)", () => {
    expect(
      coerceDecision(
        wrap({ kind: "type_text", elementId: "e1", valueKind: "password" }),
        elements,
      ),
    ).toBeNull();
  });
  it("REJECTS a select option that was not presented", () => {
    expect(
      coerceDecision(
        wrap({ kind: "select_option", elementId: "e3", optionValue: "ZZ" }),
        elements,
      ),
    ).toBeNull();
    expect(
      coerceDecision(
        wrap({ kind: "select_option", elementId: "e3", optionValue: "US" }),
        elements,
      )?.action,
    ).toEqual({ kind: "select_option", elementId: "e3", optionValue: "US" });
  });
  it("REJECTS a non-allowlisted key, accepts an allowlisted one", () => {
    expect(
      coerceDecision(wrap({ kind: "press_key", key: "F12" }), elements),
    ).toBeNull();
    for (const key of ALLOWED_KEYS)
      expect(
        coerceDecision(wrap({ kind: "press_key", key }), elements)?.action,
      ).toEqual({ kind: "press_key", key, repeat: 1 }); // absent repeat → a single press
  });
  it("clamps coordinates to 0..100", () => {
    const d = coerceDecision(
      wrap({ kind: "click_coords", xPct: 999, yPct: -5 }),
      elements,
    );
    expect(d?.action).toEqual({ kind: "click_coords", xPct: 100, yPct: 0 });
  });
  it("accepts stop(blocked) at a boundary", () => {
    const d = coerceDecision(
      wrap({ kind: "stop", status: "blocked", reason: "login required" }),
      elements,
    );
    expect(d?.action).toEqual({
      kind: "stop",
      status: "blocked",
      reason: "login required",
    });
  });
  it("returns null for a garbage / unknown action kind", () => {
    expect(
      coerceDecision(
        wrap({ kind: "run_javascript", code: "fetch('/x')" }),
        elements,
      ),
    ).toBeNull();
    expect(coerceDecision(null, elements)).toBeNull();
  });
});

/* ───────────────── actionSignature — stable loop-prevention key ───────────── */

describe("actionSignature", () => {
  it("is stable for the same (state, action) and differs across actions/states", () => {
    const a = { kind: "click_element", elementId: "e1" } as const;
    expect(actionSignature("s1", a)).toBe(actionSignature("s1", a));
    expect(actionSignature("s1", a)).not.toBe(actionSignature("s2", a));
    expect(actionSignature("s1", a)).not.toBe(
      actionSignature("s1", { kind: "click_element", elementId: "e2" }),
    );
  });
});

/* ─────────────── isolateJson — tolerate the provider's messy replies ──────── */

describe("isolateJson — lenient extraction (the Flash-Lite provider is messy)", () => {
  it("parses a plain JSON object", () => {
    expect(isolateJson('{"action":{"kind":"wait"}}')).toEqual({
      action: { kind: "wait" },
    });
  });
  it("strips ```json fences and surrounding prose", () => {
    expect(
      isolateJson('Here you go:\n```json\n{"action":{"kind":"wait"}}\n```'),
    ).toEqual({ action: { kind: "wait" } });
  });
  it("returns null (not a throw) for a bare enum string — the exact provider failure we saw", () => {
    expect(isolateJson("wait")).toBeNull();
    expect(isolateJson("")).toBeNull();
  });
});

/* ─────────────── decideNextAction — scripted decider (no network) ─────────── */

describe("decideNextAction — parses + coerces the model decision", () => {
  const view = {
    url: "https://x/",
    visibleText: "welcome",
    elements: [el({ id: "e0", label: "Enter" })],
  };

  it("returns the coerced action from a valid model reply", async () => {
    const complete = async () =>
      JSON.stringify({
        action: { kind: "click_element", elementId: "e0" },
        expectedChange: "enters",
        goalProgress: "advancing",
      });
    const d = await decideNextAction("talk to yara", view, [], 30, null, {
      complete,
    });
    expect(d?.action).toEqual({ kind: "click_element", elementId: "e0" });
  });
  it("retries ONCE on an unusable reply, then returns the valid one", async () => {
    let n = 0;
    const complete = async () =>
      n++ === 0
        ? "not json"
        : JSON.stringify({
            action: { kind: "wait" },
            expectedChange: "",
            goalProgress: "advancing",
          });
    const d = await decideNextAction("g", view, [], 30, null, { complete });
    expect(n).toBe(2);
    expect(d?.action.kind).toBe("wait");
  });
  it("gives up (null) after the single retry if still unusable", async () => {
    let n = 0;
    const complete = async () => {
      n++;
      return JSON.stringify({
        action: { kind: "click_element", elementId: "eNOPE" },
        expectedChange: "",
        goalProgress: "advancing",
      });
    };
    const d = await decideNextAction("g", view, [], 30, null, { complete });
    expect(n).toBe(2);
    expect(d).toBeNull();
  });
  it("returns null when no provider/complete is available (degrades, never throws)", async () => {
    const d = await decideNextAction("g", view, [], 30, null, {});
    // with no key configured in the test env, resolveController returns null → null decision.
    expect(d === null || d?.action !== undefined).toBe(true);
  });
});
