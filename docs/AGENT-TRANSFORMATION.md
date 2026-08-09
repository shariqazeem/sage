# The agent Sage should be, audited against the agent it is

Written 2026-08-10, before the Monday outreach. The standard is the founder's own ask, memory
set aside: *any product, any goal — when stuck, decide; when designing, ask "is this useful and
what the founder wants"; never fail, never hang, feel alive on both doors.*

## Where it stands after this weekend

| capability | state | proof |
|---|---|---|
| Hands (click any page, incl. WebGL/starved CPU) | FIXED | agora 0/4→4/4 on the VM; 5 states→10 |
| Walls (login pages without password fields) | FIXED | clawup /login now classifies; drawer trap still guarded |
| Docs (subdomains, goal-gap trigger, corpus) | FIXED | docs.clawup.org read live: "login required past this point" |
| The founder's verb becomes the mission | FIXED | `core_action`: "launch an agent" → the agent-step mission, 34 tests |
| Failure vs finding (executor honesty) | FIXED | delivered-flag; corpus excludes undelivered triggers |
| Caps that starve in silence | FIXED | every brain-view cap self-reports; starvation visible per run |
| Money rails (operator fee, launch fee) | FIXED + BUILT | 9/9 fees settled with receipts; 10% launch fee deployed, disarmed |
| Revenue honesty | BUILT | self_funded split; third-party-only figure for GOAT |
| Tangible rewards (founder overrule) | FIXED | $20 → 4×$5 not 20×$1; six old-philosophy pins rewritten; regime line at $600 |

## The model matrix (the "right model per job" ask)

Measured, not aspirational: flash-lite stalls per-request at random (6/8 → 0/10 → 3/10 across
sessions) — fine mid-exploration where a retry is cheap, poison for a founder-facing wait or a
money decision. Haiku has been the reliable workhorse everywhere it runs.

| brain | calls/run | needs | model |
|---|---|---|---|
| Browser controller | ~30, with images | vision, cheap, stall-tolerant | `VISION_MODEL=google/gemini-3.1-flash-lite-preview` (pinned; resolves FIRST) |
| Mission architect + critic | 2-3 | best reasoning per dollar | `MISSION_MODEL=deepseek/deepseek-v4-pro` ($0.44/$0.87 per M — a reasoning-tier model CHEAPER than flash-lite's $1.50 output; sonnet-5 at $2/$10 was considered and vetoed on cost until revenue) |
| Payout judgment | per submission | reliability, rubric adherence | `DEPUTY_MODEL=anthropic/claude-haiku-4-5` |
| Failover | — | measured reliability | `LLM_FALLBACK_MODEL=anthropic/claude-haiku-4-5` (gemini-3.5-flash rejected: $1.50/$9 is PRICIER than haiku; the v4-pro architect failing over to haiku is the protection that matters) |
| Concierge (both doors) | per turn | fast, alive | `CONCIERGE_MODEL=anthropic/claude-haiku-4-5` (unchanged) |
| Observation judge | per submission | calibrated (N-values set on it) | `OBS_JUDGE_MODEL=anthropic/claude-haiku-4-5` (unchanged, deliberately) |

Rules that keep this safe: the OBS judge does not move models without re-running shadow
calibration; any MISSION/VISION change re-runs the battery; the controller stays multimodal-cheap
because 30 image calls on a frontier model per inspection is cost without evidence of gain.

## What "never stuck, decides for itself" still needs (ranked, honest)

1. **Design-wait latency.** The 5-minute feel was flash-lite stalls inside architect calls.
   The v4-pro architect + the retry ladder should roughly halve it; measure on the next 5 real inspections
   before claiming it.
2. **Concierge liveness during heavy VM load.** The 2 drill timeouts coincided with builds on the
   2-core box. The durable fix is a bigger VM, not more retries; until then, avoid building during
   founder-facing hours.
3. **Stuck-state self-talk.** When the explorer stalls it stops honestly, but the founder-facing
   narration doesn't yet SAY "I hit X, so I did Y instead". The data exists (limitation, walls,
   docs, starvation); a narration pass over it is UI work, not agent work.
4. **Mission usefulness critique.** The critic scores grounding, not usefulness-to-goal. A
   "would the founder recognise this as what they asked for?" check — goal-coverage as a gate —
   is designed (P4 of the clawup plan) and half-built via core_action; the coverage gate itself
   remains.
5. **Evidence questions per mission.** Dynamic "name what the console showed" questions derived
   from docs — the architect is prompted for them; a deterministic floor (≥2 question-style
   evidence requirements on gated missions) is not yet enforced.

## What was deliberately NOT done

- No new agent framework, no orchestration rewrite: the brains are separate on purpose and the
  boundaries (frozen judgment, vault disposes) are the product's safety story.
- No model change on the payout/OBS lane beyond reliability pins: calibration is per-model.
- No web-side launch fee: the web deploy state machine cannot represent a fifth call; excluded
  structurally rather than wedged in.
