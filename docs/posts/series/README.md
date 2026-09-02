# The series — the compressed schedule (deadline week)

Post 1 is out. Two a day from Wed: **18:30 PKT** (FC / Caribbean morning) and **23:00 PKT**
(Starknet / crypto peak). Video on the post, link in the FIRST reply, reply to every reply.

| day | 18:30 PKT | 23:00 PKT |
| --- | --- | --- |
| Wed 3 | 02 the ledger | 05 teams |
| Thu 4 | 03 credit file + advance (tag Future Caribbean) | 06 private payouts + the $25 gig (link in reply) |
| Fri 5 | 04 composer + J$ currencies (combined) | the Caribbean post ("this is for you") |
| Sat 6 | results (tag @EliBenSasson, Starknet, Future Caribbean) | the thesis post |
| Sat 6 (last 10 h) | **final demo videos**: `07-fc-demo` (~65 s) and `08-strk20-demo` (~45 s) — boards drafted AND dry-rendered clean Thu (62 s / 45.5 s, captions fit one line, receipt scene = the autonomous Starknet settlement); Saturday: capture fresh shots, refresh the LIVE captions, render, submit both together | — |

Rebuild any video after a product change: `node scripts/video/capture.mjs` then
`node scripts/video/render.mjs --board docs/posts/videos/boards/<n>.json`.

## Rendering the final demos (Saturday)

```bash
node scripts/video/capture.mjs --out docs/posts/videos/shots --base https://sagepays.xyz
node scripts/video/render.mjs --board docs/posts/videos/boards/07-fc-demo.json --out docs/posts/videos
node scripts/video/render.mjs --board docs/posts/videos/boards/08-strk20-demo.json --out docs/posts/videos
```

Before rendering, update every caption marked LIVE in the two boards with the explorer's current
numbers; the `_refresh` field in each board says exactly which ones.
