# Sage on Telegram

> A thin, real Telegram presence for the Payout Deputy. It answers public
> questions from the server's existing truth and announces payouts to a
> campaign's chat. No new dependencies — plain Bot API over `fetch`. It never
> exposes anything session-gated, and it never fabricates: every number it says
> is read from a real row.

There are two independent halves. Wire either, both, or neither.

| Half          | Direction | Gated by                                     | What it does                                                          |
| ------------- | --------- | -------------------------------------------- | -------------------------------------------------------------------- |
| **Webhook**   | inbound   | `TELEGRAM_WEBHOOK_SECRET`                    | Answers `/status`, `/agent`, `/start` from public data.              |
| **Announce**  | outbound  | a campaign's `announceChatId`                | Posts `Paid ✓ …` / `Blocked by vault …` when a payout settles/blocks. |
| _(op pings)_  | outbound  | `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`    | The pre-existing private held/paid pings to the operator chat.        |

All three share one send primitive (`sendTelegram` in `src/lib/telegram/bot.ts`);
`TELEGRAM_BOT_TOKEN` is required for any of them to send.

---

## 1. Create the bot (BotFather)

1. In Telegram, open [@BotFather](https://t.me/BotFather) and send `/newbot`.
2. Give it a name and a username ending in `bot` (e.g. `SageDeputyBot`).
3. BotFather replies with a **bot token** like `123456:ABC-DEF…`. This is
   `TELEGRAM_BOT_TOKEN`. Treat it as a secret.
4. Optional polish: `/setdescription`, `/setabouttext`, and `/setcommands` with:
   ```
   status - Public stats for a campaign: /status <slug>
   agent - Sage's on-chain track record
   start - Get a campaign link
   ```

## 2. Environment variables

Add to `.env` (all optional — unset means that half is simply off):

```bash
# Required for the bot to send anything at all
TELEGRAM_BOT_TOKEN=123456:ABC-DEF...

# Inbound webhook — a secret you invent (1–256 chars of A–Z a–z 0–9 _ -).
# Telegram echoes it back in a header on every update; we reject mismatches.
TELEGRAM_WEBHOOK_SECRET=a-long-random-string

# Private operator pings (held/paid) — the pre-existing A2 notifier
TELEGRAM_CHAT_ID=-1001234567890

# Optional: point the dogfood campaign's public announces at a chat
TELEGRAM_ANNOUNCE_CHAT_ID=-1009876543210

# The webhook builds absolute links from this (proof/campaign URLs)
NEXT_PUBLIC_APP_URL=https://your-sage-deployment.example
```

`env.ts` validates these at boot; missing is fine, malformed hard-fails.

## 3. Register the webhook

Point Telegram at your deployed route (`/api/telegram/webhook`) and hand it the
same secret. Run once:

```bash
curl -sS "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -d "url=${NEXT_PUBLIC_APP_URL}/api/telegram/webhook" \
  -d "secret_token=${TELEGRAM_WEBHOOK_SECRET}"
```

Telegram now sends every update as a `POST` with the header
`X-Telegram-Bot-Api-Secret-Token: <your secret>`. The route rejects anything
without a matching secret (`401`); if `TELEGRAM_WEBHOOK_SECRET` is unset the
route `404`s as if it doesn't exist.

Verify and troubleshoot:

```bash
curl -sS "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo"   # url + last error
curl -sS "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/deleteWebhook"    # unhook
```

> The webhook needs a public HTTPS URL. For local development, expose port 3000
> with a tunnel (e.g. `cloudflared tunnel --url http://localhost:3000`) and set
> `url` to the tunnel host.

## 4. Commands (all public data only)

| Command          | Reply                                                                             |
| ---------------- | --------------------------------------------------------------------------------- |
| `/status <slug>` | Campaign title, paid-of-max, settled total (USDC), network, and the `/c/<slug>` link. |
| `/agent`         | Sage's grounded track record (settled USDC, payouts, blocks, decisions, avg confidence) + the `/agents/sage` link. |
| `/start <slug>`  | The campaign link for that slug (this is the deep-link target — see §6).           |
| `/help`          | The command list.                                                                 |

Drafts are hidden; an unknown slug replies "Campaign not found." Nothing that
requires a session (a submitter's wallet, unsettled internals) is ever reachable
here — the bot reads the same surfaces `/c/<slug>` and `/agents/sage` already
serve to the public.

## 5. Per-campaign announces

A campaign can opt into a public announce chat. When a payout **settles** or is
**blocked by the vault**, Sage posts to that chat — outbound only, and it
journals nothing new (the event is already recorded by the settle flow).

```
Compose demo
Paid ✓ $0.50 to 0x0deF…44D6 · proof https://…/proof/0x…
Explorer: https://explorer.goat.network/tx/0x…        ← mainnet payouts only
```
```
Compose demo
Blocked by vault · check 3 · https://…/c/demo
```

Set the target chat one of two ways:

- **At creation** — include `announceChatId` in the create-campaign request body
  (a signed chat id like `-1001234567890`, or an `@publicchannel`). Invalid
  values are dropped to `null`.
- **The dogfood campaign** — set `TELEGRAM_ANNOUNCE_CHAT_ID`; `ensureDemoCampaign`
  wires it to `/c/demo` automatically.

**Finding a chat id:** add the bot to the group/channel, post any message, then
read it back:

```bash
curl -sS "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates" \
  | grep -o '"chat":{"id":[-0-9]*'
```

Channels the bot posts to require the bot to be an **admin** with post rights.

## 6. ClawUp / bootcamp cohort pairing

The bootcamp pairs a project bot with the cohort so testers reach it in one tap.
The mechanism is Telegram's `start` deep link, which maps directly onto `/start`:

1. **Publish the bot handle.** Share `https://t.me/<YourBotUsername>` (from
   BotFather) in the ClawUp cohort channel / bootcamp directory as Sage's bot.
2. **Hand out per-campaign deep links.** For any campaign slug, the link
   `https://t.me/<YourBotUsername>?start=<slug>` opens the bot and fires
   `/start <slug>`; the bot replies with that campaign's `/c/<slug>` submission
   link. `/c/demo` is the cohort dogfood — its deep link is
   `https://t.me/<YourBotUsername>?start=demo`.
3. **Announce into the cohort channel.** Add the bot to the cohort channel as an
   admin and set that channel as the campaign's `announceChatId` (§5). Every real
   payout then posts to the cohort automatically — the live, verifiable feed the
   bootcamp grades.
4. **Verify from a phone.** Open the deep link, send `/agent`, and confirm the
   track record matches `/agents/sage`.

> Follow the current ClawUp bootcamp guide for where exactly to register the bot
> handle in the cohort directory — the pairing primitive itself (deep link +
> admin bot in the channel) is what this integration implements.

## 7. Security & guarantees

- **Secret-gated inbound.** No valid `X-Telegram-Bot-Api-Secret-Token`, no
  service. Unset secret = route disabled (`404`).
- **Public data only.** Every reply is built from `campaigns` / their journal /
  the agent's reputation — the same data already on public pages.
- **Outbound announces journal nothing.** They read the settle result and send;
  they never write events, so the journal stays a record of real on-chain work.
- **Never blocks a payout.** Every send is env-gated, time-boxed, and swallows
  its own errors — a Telegram outage cannot affect settlement.
- **Rate-limited.** Inbound commands are limited per chat (`rate-limit.ts`).
- **HTML-escaped.** Poster-supplied titles are escaped before sending.
```
