import sys; sys.path.insert(0, ".")
from lib import *

prs = deck()

# ── 1 · TITLE (dark) ────────────────────────────────────────────────────────
s = slide(prs, dark=True)
eyebrow(s, 1.0, 1.15, "OpenClaw Summer Builder Bootcamp  ·  Demo Day", LGREY)
text(s, 1.0, 1.68, 11.4, 1.62, "Sage", size=86, color=PAPER, bold=True)
text(s, 1.0, 3.42, 10.6, 1.0,
     [[("An AI agent that pays real people ", {}),
       ("in USDC", {"color": TERRA, "bold": True}),
       (" to test your product.", {})]],
     size=30, color=PAPER, spacing=1.15)
rule(s, 1.0, 4.5, 3.2, TERRA, 2.5)
text(s, 1.0, 4.9, 11.4, 1.4,
     [[("$48.10", {"bold": True, "color": PAPER, "font": MONO}),
       ("  settled autonomously   ·   ", {"color": LGREY}),
       ("16", {"bold": True, "color": PAPER, "font": MONO}),
       ("  people paid   ·   ", {"color": LGREY}),
       ("20 of 42", {"bold": True, "color": PAPER, "font": MONO}),
       ("  submissions refused", {"color": LGREY})]],
     size=17, color=LGREY, spacing=1.3)
text(s, 1.0, 6.35, 11.4, 0.4, "GOAT Network mainnet  ·  sagepays.xyz", size=13, color=GREY, font=MONO)
notes(s, "[0:00-0:20]\n\nHi, I'm Shariq, and this is Sage.\n\n"
         "Sage is an AI agent that pays real people in USDC to test your product.\n\n"
         "Not a demo. Forty-eight dollars has moved on GOAT mainnet to sixteen real "
         "people, and the agent refused twenty of the forty-two reports it was sent.\n\n"
         "Let me show you what it actually does.")

# ── 2 · WHAT IT DOES — the five steps ───────────────────────────────────────
s = slide(prs)
eyebrow(s, 0.9, 0.72, "What the agent does")
text(s, 0.9, 1.12, 11.5, 0.8, "Five steps. A human is in none of them.", size=38, bold=True)
steps = [
    ("Opens your product in a real browser", "Screenshots, rendered pages, console errors — the states a visitor can actually reach."),
    ("Writes the testing missions itself", "From what it observed, not from your marketing copy."),
    ("Real people complete them", "Strangers, paid per completed mission."),
    ("Checks every report against its own browsing", "An account that could have been written without opening the product does not clear."),
    ("Pays in USDC — or refuses", "With a written reason either way."),
]
y = 2.28
for i, (t, sub) in enumerate(steps, 1):
    dot(s, 0.9, y - 0.03, 0.44, TERRA, str(i), size=16)
    text(s, 1.58, y - 0.04, 10.6, 0.36, t, size=18.5, bold=True)
    text(s, 1.58, y + 0.34, 10.6, 0.34, sub, size=13.5, color=GREY)
    y += 0.92
notes(s, "[0:20-0:55]\n\nFive steps.\n\nIt opens your product in a real browser and explores it. "
         "It writes the testing missions from what it saw. Real people complete them. "
         "It checks each report against its own observations. Then it pays, or it refuses.\n\n"
         "The founder does two things in that entire loop: approve the plan, and fund it. "
         "That's it. No human is in any of those five steps.")

# ── 3 · THE PROBLEM ─────────────────────────────────────────────────────────
s = slide(prs)
eyebrow(s, 0.9, 0.72, "The problem")
text(s, 0.9, 1.12, 6.6, 1.9,
     [[("You shipped it.\n", {}), ("Nobody has used it.", {"color": TERRA})]],
     size=46, bold=True, spacing=1.08)
text(s, 0.9, 3.25, 6.5, 2.4,
     "Building stopped being the hard part. Getting real strangers to touch the thing "
     "and tell you the truth is now the hard part — and every existing option asks you "
     "to do the work yourself.",
     size=17, color=MID, spacing=1.4)
opts = [
    ("An agency", "$5,000 and two weeks before anyone opens your app."),
    ("A bug bounty", "Noise, duplicates, and nothing about whether onboarding makes sense."),
    ('"Please try my app"', "Friends being kind. Nobody tells you it was confusing."),
]
x = 7.75; y = 1.35
for t, sub in opts:
    card(s, x, y, 4.7, 1.5, fill=None)
    text(s, x + 0.42, y + 0.3, 3.9, 0.34, t, size=17, bold=True)
    text(s, x + 0.42, y + 0.72, 3.9, 0.6, sub, size=13, color=GREY, spacing=1.25)
    y += 1.72
notes(s, "[0:55-1:30]\n\nHere's the problem I kept hitting.\n\n"
         "Building stopped being the hard part. Getting real strangers to use your product "
         "and tell you the truth — that's the hard part now.\n\n"
         "An agency costs five thousand dollars and two weeks. A bug bounty gives you noise "
         "and duplicates and tells you nothing about whether onboarding makes sense. And "
         "posting 'please try my app' gets you friends being kind to you.\n\n"
         "All three make you do the work: find people, brief them, check their work, pay them one by one.")

# ── 4 · THE SOLUTION / SAFETY ───────────────────────────────────────────────
s = slide(prs)
eyebrow(s, 0.9, 0.72, "The solution")
text(s, 0.9, 1.12, 11.5, 0.85,
     [[("The agent proposes. ", {}), ("The vault disposes.", {"color": TERRA})]],
     size=40, bold=True)
text(s, 0.9, 2.1, 11.4, 0.75,
     "You fund an on-chain vault once. The agent can spend inside it and can never exceed it — "
     "because the limit is a contract, not an instruction in a prompt.",
     size=17, color=MID, spacing=1.35)
cols = [
    ("Mission Brain", "Designs the missions from what was\nobserved. Output is untrusted until a\ndeterministic gate accepts it."),
    ("Payout Brain", "Judges the evidence and proposes\npay, hold or refuse. Forbidden from\never stating an amount."),
    ("The Vault", "Computes the exact reward, enforces\nevery cap, rejects replays, and emits\nthe settlement event."),
]
x = 0.9
for i, (t, sub) in enumerate(cols):
    last = i == 2
    card(s, x, 3.28, 3.83, 2.25, fill=RGBColor(0xF5, 0xF3, 0xEF) if last else None,
         border=TERRA if last else LINE)
    text(s, x + 0.4, 3.62, 3.1, 0.36, t, size=19, bold=True, color=TERRA if last else INK)
    text(s, x + 0.4, 4.12, 3.15, 1.2, sub, size=13, color=MID if last else GREY, spacing=1.3)
    x += 4.05
text(s, 0.9, 5.85, 11.5, 0.5,
     "No model in this system computes a money amount. If one were jailbroken tomorrow, it still could not move a dollar.",
     size=15, color=INK, bold=True)
notes(s, "[1:30-2:05]\n\nSage's answer is one sentence: the agent proposes, the vault disposes.\n\n"
         "You fund an on-chain vault once. The agent can spend inside it and can never exceed it, "
         "because the limit is a contract — not an instruction in a prompt.\n\n"
         "Three separate layers. One designs missions. One judges evidence and is forbidden from "
         "ever stating an amount. And the vault computes the actual money and enforces every cap.\n\n"
         "No model in this system computes a money amount. If one got jailbroken tomorrow, it still "
         "couldn't move a dollar.")

# ── 5 · DEMO CUE (dark) ─────────────────────────────────────────────────────
s = slide(prs, dark=True)
eyebrow(s, 1.0, 2.35, "Live product demo", LGREY)
text(s, 1.0, 2.78, 11.4, 1.1, "Watch it work.", size=64, color=PAPER, bold=True)
rule(s, 1.0, 4.1, 3.2, TERRA, 2.5)
items = ["A product it has never seen", "The missions it writes from what it saw",
         "A real tester paid in USDC", "A real tester refused"]
x = 1.0
for i, t in enumerate(items):
    text(s, x, 4.55, 2.72, 0.9,
         [[(f"0{i+1}", {"font": MONO, "size": 13, "color": TERRA, "bold": True})],
          [(t, {"size": 14.5, "color": PAPER})]],
         spacing=1.25, space_after=4)
    x += 2.85
notes(s, "[2:05-2:15]\n\nRather than describe it, let me show you.\n\n"
         "I'm going to point Sage at a product it has never seen, let it write the missions "
         "itself, and then have two people submit work — one real, one not.\n\n"
         "[SWITCH TO SCREEN RECORDING]")

# ── 6 · THE NUMBER THAT MATTERS ─────────────────────────────────────────────
s = slide(prs)
eyebrow(s, 0.9, 0.8, "The number nobody else can show")
text(s, 0.9, 1.30, 6.4, 2.20, "48%", size=120, color=TERRA, bold=True)
text(s, 0.9, 3.55, 6.4, 1.0, "of submissions were refused.", size=30, bold=True)
text(s, 0.9, 4.6, 6.1, 2.0,
     "Twenty of forty-two. Every one with a written reason, and every one decided by the "
     "agent without a person in the room.",
     size=17, color=MID, spacing=1.4)
card(s, 7.55, 1.35, 4.9, 4.15, fill=RGBColor(0xF5, 0xF3, 0xEF), border=None)
text(s, 8.0, 1.85, 4.0, 1.5,
     "Anyone can build an agent that pays.",
     size=22, bold=True, color=INK, spacing=1.25)
rule(s, 8.0, 3.05, 1.6, TERRA, 2)
text(s, 8.0, 3.4, 4.0, 1.9,
     "Building one that looks at real work and says no is the whole difficulty — "
     "and it is what makes the payouts mean anything.",
     size=17, color=MID, spacing=1.4)
notes(s, "[Post-demo · 4:00-4:20]\n\nThat refusal you just watched is the number I care about most.\n\n"
         "Forty-eight percent. Twenty of forty-two submissions refused, each with a written reason, "
         "each decided without a person in the room.\n\n"
         "Anyone can build an agent that pays. Building one that looks at real work and says no "
         "is the whole difficulty — and it's what makes the payouts mean anything.")

# ── 7 · TRACTION ────────────────────────────────────────────────────────────
s = slide(prs)
eyebrow(s, 0.9, 0.72, "Traction")
text(s, 0.9, 1.12, 11.5, 0.8, "Real money. Real people. Verifiable.", size=38, bold=True)
stats = [("$48.10", "settled in USDC"), ("16", "people paid"), ("20", "autonomous payouts"),
         ("68", "products inspected"), ("42", "reports judged"), ("175s", "median time to payout")]
x, y = 0.9, 2.35
for i, (n, l) in enumerate(stats):
    if i == 3:
        x, y = 0.9, 4.15
    text(s, x, y, 3.7, 0.95, n, size=52, bold=True, color=TERRA if i == 0 else INK, font=MONO)
    text(s, x, y + 0.92, 3.7, 0.4, l, size=15, color=GREY)
    x += 4.05
rule(s, 0.9, 5.72, 11.5)
text(s, 0.9, 6.0, 11.5, 0.85,
     [[("Every one of those payouts is a public transaction on GOAT mainnet. ", {"bold": True}),
       ("You do not need my cooperation to check a single number on this slide.", {"color": MID})]],
     size=16.5, spacing=1.3)
notes(s, "[4:20-4:40]\n\nHere's where Stage 2 ended.\n\n"
         "Forty-eight dollars ten settled in USDC. Sixteen people paid across twenty autonomous "
         "payouts. Sixty-eight products inspected. Forty-two reports judged. Median time from a "
         "stranger submitting to USDC arriving in their wallet: a hundred and seventy-five seconds.\n\n"
         "And every one of those payouts is a public transaction on GOAT mainnet. You don't need "
         "my cooperation to check a single number on this slide.")

# ── 8 · WHAT'S NEXT ─────────────────────────────────────────────────────────
s = slide(prs)
eyebrow(s, 0.9, 0.72, "What's next")
text(s, 0.9, 1.12, 11.5, 0.8, "Supply is solved. Demand is the work.", size=38, bold=True)
text(s, 0.9, 2.05, 11.0, 0.7,
     "Ten strangers did paid testing in forty-five minutes. The constraint was never finding testers — it is founders with budgets.",
     size=17, color=MID, spacing=1.35)
nxt = [("Founder self-serve", "Outside founders funding their own vaults, starting with builders who need user evidence for grant applications."),
       ("Deeper missions", "Effort-weighted rewards so a fifteen-minute journey pays fairly against a five-minute one."),
       ("Agent-to-agent", "Sage is already callable over MCP and x402 — other agents commissioning testing without a human at all.")]
y = 3.05
for i, (t, sub) in enumerate(nxt, 1):
    dot(s, 0.9, y + 0.02, 0.42, INK, str(i), size=15)
    text(s, 1.55, y, 10.9, 0.36, t, size=20, bold=True)
    text(s, 1.55, y + 0.42, 10.6, 0.6, sub, size=14.5, color=GREY, spacing=1.3)
    y += 1.22
notes(s, "[4:40-4:55]\n\nWhat's next.\n\n"
         "Supply is solved — ten strangers did paid testing work in forty-five minutes. The "
         "constraint was never finding testers. It's founders with budgets.\n\n"
         "So: founder self-serve, starting with builders who need real user evidence for grant "
         "applications. Effort-weighted rewards. And agent-to-agent — Sage is already callable "
         "over MCP and x402, so other agents can commission testing with no human at all.")

# ── 9 · CLOSE (dark) ────────────────────────────────────────────────────────
s = slide(prs, dark=True)
text(s, 1.0, 2.15, 11.4, 2.4,
     [[("Most agents ", {"color": LGREY}), ("talk.", {"color": PAPER})],
      [("Sage ", {"color": LGREY}), ("decides", {"color": TERRA, "bold": True}), (" — and pays.", {"color": PAPER})]],
     size=52, bold=True, spacing=1.2)
rule(s, 1.0, 4.85, 3.2, TERRA, 2.5)
text(s, 1.0, 5.3, 11.4, 0.5, "sagepays.xyz   ·   @sagepaysai   ·   github.com/shariqazeem/sage",
     size=17, color=PAPER, font=MONO)
text(s, 1.0, 5.95, 11.4, 0.45, "Every payout above has a public receipt. Go and check one.",
     size=15, color=GREY)
notes(s, "[4:55-5:00]\n\nMost agents talk. Sage decides — and pays.\n\n"
         "Everything I showed you is live at sagepays.xyz, and every payout has a public receipt.\n\n"
         "Thank you.")

prs.save("Sage-DemoDay.pptx")
print("saved", len(prs.slides.__iter__.__self__._sldIdLst), "slides")
