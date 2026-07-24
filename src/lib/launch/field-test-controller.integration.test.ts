import { describe, it, expect } from "vitest";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { runFieldTest, type FieldTestDeps } from "./field-test";

/**
 * Goal-directed controller — full-loop fixtures (real chromium, local servers). Gated on
 * FIELD_TEST_ENABLED=1 like the other browser integration tests; the always-run coverage of the
 * decision logic, safety guards, loop prevention, and the states→facts adapter lives in
 * browser-controller.test.ts + observed-facts-canvas.test.ts. These prove the loop actually CROSSES
 * onboarding, types a synthetic value, sends an AI probe, and STOPS honestly at a boundary — the exact
 * gaps that made yara.garden return goal-irrelevant states. All fixtures are general, not yara-specific.
 */

const RUN = process.env.FIELD_TEST_ENABLED === "1";

/** A scripted controller — returns the next decision only when the deterministic affordance layer defers. */
function scripted(
  steps: Array<Record<string, unknown>>,
): FieldTestDeps["controller"] {
  let i = 0;
  return {
    complete: async () =>
      JSON.stringify(
        i < steps.length
          ? steps[i++]
          : {
              action: {
                kind: "stop",
                status: "blocked",
                reason: "script exhausted",
              },
              expectedChange: "",
              goalProgress: "blocked",
            },
      ),
  };
}

async function serve(
  html:
    | string
    | ((url: string) => { code: number; body: string; type?: string }),
): Promise<{ server: Server; port: number }> {
  const server = createServer((req, res) => {
    if (typeof html === "string") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(html);
      return;
    }
    const r = html(req.url ?? "/");
    res.writeHead(r.code, { "content-type": r.type ?? "text/html" });
    res.end(r.body);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  return { server, port: typeof addr === "object" && addr ? addr.port : 0 };
}

function loopbackDeps(
  port: number,
  extra: Partial<FieldTestDeps> = {},
): FieldTestDeps {
  return {
    isPublicHost: async () => true,
    allowUrl: () => ({ allow: true, reason: "test" }),
    publicDir: mkdtempSync(join(tmpdir(), "sage-ftc-")),
    egressAllowLoopback: new Set([`127.0.0.1:${port}`]),
    egressAllowedPorts: new Set([port]),
    ...extra,
  };
}

const chromiumMissing = (s: { ran: boolean; limitation: string | null }) =>
  !s.ran && /not installed/i.test(s.limitation ?? "");

/* ── 1. normal DOM onboarding: name input + select + Continue → the controller crosses it ── */

const ONBOARD = `<!doctype html><html><head><title>Onboard</title></head><body>
<div id="s0"><h1>Welcome</h1><button id="get">Get Started</button></div>
<div id="s1" style="display:none"><label>Your name <input id="fullname" type="text" placeholder="Your name"></label>
  <label>Country <select id="c"><option value="US">US</option><option value="CA">CA</option></select></label>
  <button id="cont">Continue</button><p id="err"></p></div>
<div id="s2" style="display:none"><h2 id="done">You're all set, welcome aboard</h2></div>
<script>
  window.addEventListener('keydown', function(){});   // an APP (keyboard-aware) → interactive mode
  get.onclick=()=>{s0.style.display='none';s1.style.display='block';};
  cont.onclick=()=>{ if(fullname.value){ s1.style.display='none'; s2.style.display='block'; }
                     else { err.textContent='Please enter your name to continue'; } };
</script></body></html>`;

(RUN ? describe : describe.skip)(
  "controller — DOM onboarding (name + select + continue)",
  () => {
    it("crosses onboarding to the final state (deterministic affordance + one synthetic type)", async () => {
      const { server, port } = await serve(ONBOARD);
      try {
        // Get Started + Continue are deterministic forward affordances; the model is only consulted when
        // they stop working — it then reads the element list and fills the typable field (as a real model would).
        const controller: FieldTestDeps["controller"] = {
          complete: async (_sys: string, user: string) => {
            const m = /(e\d+): <(?:input|textarea)[^>]*typable>/.exec(user);
            return JSON.stringify(
              m
                ? {
                    action: {
                      kind: "type_text",
                      elementId: m[1],
                      valueKind: "display_name",
                    },
                    expectedChange: "name filled",
                    goalProgress: "advancing",
                  }
                : {
                    action: {
                      kind: "stop",
                      status: "blocked",
                      reason: "nothing typable",
                    },
                    expectedChange: "",
                    goalProgress: "blocked",
                  },
            );
          },
        };
        const summary = await runFieldTest(
          {
            inspectionId: "c-onb",
            startUrl: `http://127.0.0.1:${port}/`,
            host: `127.0.0.1:${port}`,
            candidateLinks: [],
            goal: "complete the signup and reach the welcome screen",
          },
          loopbackDeps(port, { controller }),
        );
        if (chromiumMissing(summary)) return;
        const text = summary.states.map((s) => s.visibleTextExcerpt).join(" ");
        const trace = summary.states
          .map((s, i) => `[${i}] ${s.trigger}`)
          .join(" | ");
        expect(text, `trace: ${trace}`).toMatch(/all set|welcome aboard/i);
      } finally {
        await new Promise<void>((r) => server.close(() => r()));
      }
    }, 60_000);
  },
);

/* ── 2. private AI-chat stub: type the probe, send, observe the reply ── */

const CHAT = `<!doctype html><html><head><title>Chat</title></head><body>
<h1>Talk to Aria</h1>
<div id="log"></div>
<input id="msg" type="text" placeholder="Message Aria">
<button id="send">Send</button>
<script>
  send.onclick=()=>{ var v=msg.value; if(!v) return; var d=document.createElement('p'); d.textContent='Aria: Hello there, nice to meet you!'; log.appendChild(d); msg.value=''; };
  msg.addEventListener('keydown',function(e){ if(e.key==='Enter') send.click(); });
</script></body></html>`;

(RUN ? describe : describe.skip)("controller — private AI/NPC chat", () => {
  it("sends the fixed probe and observes the character's reply", async () => {
    const { server, port } = await serve(CHAT);
    try {
      // no forward affordance on this screen → the model is asked: type the probe, then press Enter.
      const controller = scripted([
        {
          action: { kind: "type_text", elementId: "e0", valueKind: "ai_probe" },
          expectedChange: "probe typed",
          goalProgress: "advancing",
        },
        {
          action: { kind: "press_key", key: "Enter" },
          expectedChange: "reply arrives",
          goalProgress: "advancing",
        },
        {
          action: { kind: "stop", status: "completed", reason: "got a reply" },
          expectedChange: "",
          goalProgress: "reached",
        },
      ]);
      const summary = await runFieldTest(
        {
          inspectionId: "c-chat",
          startUrl: `http://127.0.0.1:${port}/`,
          host: `127.0.0.1:${port}`,
          candidateLinks: [],
          goal: "talk to the Aria character and get a response",
        },
        loopbackDeps(port, { controller }),
      );
      if (chromiumMissing(summary)) return;
      const text = summary.states.map((s) => s.visibleTextExcerpt).join(" ");
      expect(text).toMatch(/Aria: Hello there/i); // the reply was observed
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  }, 60_000);
});

/* ── 2b. conversation COMPLETION: the goal-target click → probe → send → real reply ── */

// A world where the character must be REACHED first (a "Meet <name>" affordance), then a chat opens.
// The reply is asynchronous, so "replied" can only be true if Sage actually waited and observed it.
const WORLD_CHAT = `<!doctype html><html><head><title>World</title></head><body>
<div id="world"><h1>The Grove</h1><span id="meet" style="cursor:pointer">Meet Aria</span>
  <span style="cursor:pointer">Still Pond</span><span style="cursor:pointer">The Hearth</span></div>
<div id="chat" style="display:none"><h2>Aria</h2><div id="log"></div>
  <input id="msg" type="text" placeholder="Say something"><button id="send">Send</button></div>
<script>
  meet.onclick=()=>{world.style.display='none';chat.style.display='block';};
  send.onclick=()=>{ var v=msg.value; if(!v) return; msg.value='';
    setTimeout(function(){ var p=document.createElement('p'); p.textContent='Aria replies: warm greetings traveller'; log.appendChild(p); }, 1200); };
  msg.addEventListener('keydown',function(e){ if(e.key==='Enter') send.click(); });
</script></body></html>`;

(RUN ? describe : describe.skip)(
  "controller — completes the target conversation",
  () => {
    it("reaches the named character, sends the fixed probe, and OBSERVES the actual reply", async () => {
      const { server, port } = await serve(WORLD_CHAT);
      try {
        // No forward affordance and no scripted model step is needed: "Meet Aria" matches the goal's terms,
        // so the deterministic goal-target layer clicks it, then the conversation routine completes.
        const summary = await runFieldTest(
          {
            inspectionId: "c-world",
            startUrl: `http://127.0.0.1:${port}/`,
            host: `127.0.0.1:${port}`,
            candidateLinks: [],
            goal: "go to the aria character and talk to her",
          },
          loopbackDeps(port, { controller: scripted([]) }),
        );
        if (chromiumMissing(summary)) return;
        const triggers = summary.states.map((s) => s.trigger).join(" | ");
        expect(triggers).toMatch(/Meet Aria/i); // located + opened the target
        expect(triggers).toMatch(/typed the test message/i); // sent the fixed probe
        expect(triggers).toMatch(/observed the reply/i); // waited for and SAW the actual response
        const text = summary.states.map((s) => s.visibleTextExcerpt).join(" ");
        expect(text).toMatch(/Aria replies/i); // the reply is in a captured state, not inferred
      } finally {
        await new Promise<void>((r) => server.close(() => r()));
      }
    }, 90_000);

    it("does NOT claim a reply when the product never answers (honest 'sent', no reply state)", async () => {
      const SILENT = WORLD_CHAT.replace(
        /setTimeout\(function\(\)\{[^}]*\}, 1200\);/,
        "/* no reply */",
      );
      const { server, port } = await serve(SILENT);
      try {
        const summary = await runFieldTest(
          {
            inspectionId: "c-silent",
            startUrl: `http://127.0.0.1:${port}/`,
            host: `127.0.0.1:${port}`,
            candidateLinks: [],
            goal: "go to the aria character and talk to her",
          },
          loopbackDeps(port, { controller: scripted([]) }),
        );
        if (chromiumMissing(summary)) return;
        const triggers = summary.states.map((s) => s.trigger).join(" | ");
        expect(triggers).toMatch(/typed the test message/i);
        expect(triggers).not.toMatch(/observed the reply/i); // never claimed
      } finally {
        await new Promise<void>((r) => server.close(() => r()));
      }
    }, 90_000);
  },
);

/* ── 3. authentication boundary: stop honestly, keep the observed states ── */

const AUTH = `<!doctype html><html><head><title>Login</title></head><body>
<h1>Sign in to continue</h1>
<form><label>Email <input type="email" name="email"></label><label>Password <input type="password" name="password"></label><button type="submit">Log in</button></form>
<script>window.addEventListener('keydown', function(){});</script>
</body></html>`;

(RUN ? describe : describe.skip)("controller — authentication boundary", () => {
  it("STOPS blocked at a login wall and preserves the states it saw (never zero)", async () => {
    const { server, port } = await serve(AUTH);
    try {
      const controller = scripted([
        {
          action: {
            kind: "stop",
            status: "blocked",
            reason: "login required — will not authenticate",
          },
          expectedChange: "",
          goalProgress: "blocked",
        },
      ]);
      const summary = await runFieldTest(
        {
          inspectionId: "c-auth",
          startUrl: `http://127.0.0.1:${port}/`,
          host: `127.0.0.1:${port}`,
          candidateLinks: [],
          goal: "reach the dashboard",
        },
        loopbackDeps(port, { controller }),
      );
      if (chromiumMissing(summary)) return;
      // a rendered page ALWAYS yields ≥1 state — the auth wall is observed, not erased.
      expect(summary.states.length).toBeGreaterThanOrEqual(1);
      expect(summary.states.map((s) => s.visibleTextExcerpt).join(" ")).toMatch(
        /sign in|log in/i,
      );
      // and it never typed into the password/email fields (those are non-typable + re-guarded).
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  }, 60_000);
});
