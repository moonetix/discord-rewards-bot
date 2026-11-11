# Discord Rewards Bot

**Give your Discord members a private way to earn your server coins by completing offers, within Discord's rules.**

[![CI](https://github.com/moonetix/discord-rewards-bot/actions/workflows/ci.yml/badge.svg)](https://github.com/moonetix/discord-rewards-bot/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Docs](https://img.shields.io/badge/docs-docs.moonetix.com-004ABB)](https://docs.moonetix.com/postbacks)
[![Get keys](https://img.shields.io/badge/get%20keys-moonetix.com-004ABB)](https://moonetix.com/register)
[![Node 22](https://img.shields.io/badge/node-22-339933)](https://moonetix.com/academy/integrations/discord-bot-offerwall)
[![Zero dependencies](https://img.shields.io/badge/dependencies-zero-brightgreen)](https://moonetix.com/industries/discord)

A Discord app built on the HTTP Interactions endpoint, with `/earn` and `/balance`, a private earn page on your site with the [Moonetix](https://moonetix.com) offerwall, and a postback handler that credits coins. Moonetix is a pay-per-result affiliate network: your members earn your own currency by completing offers, and you earn per completed offer.

> **Get your App ID and keys: sign up free at https://moonetix.com/register**

## Design choices

1. **Discord IDs stay with you.** The offerwall only sees your own site account ID. The bot never builds a link from a Discord ID and never posts a signed link in Discord.
2. **No gateway, no intents.** Discord sends commands to your HTTPS endpoint, signed with Ed25519. The app cannot read messages, so it cannot reward chat, joins or invites even by mistake.
3. **Runs as is.** Node 22, no npm packages, SQLite built into Node, and 26 tests with a local Ed25519 key pair and real Moonetix postback vectors.

## How it fits together

```mermaid
sequenceDiagram
    actor U as Member
    participant D as Discord
    participant S as Your server
    participant M as Moonetix offerwall
    U->>D: /earn
    D->>S: Signed interaction (Ed25519)
    S->>S: Verify signature, find the linked site account
    S-->>D: Ephemeral reply with a one-time earn page button
    U->>S: Opens the earn page
    S->>S: Sign the offerwall link for the site account ID
    S-->>U: Earn page with the offerwall
    U->>M: Completes an offer
    M->>S: Signed postback (status 1 credited, 2 reversed)
    S->>S: Verify hash, credit once per transaction_id
    U->>D: /balance
    D->>S: Signed interaction
    S-->>D: Ephemeral reply with the balance
```

## Quick start

You need Node.js 22.13 or later, an app in the [Discord Developer Portal](https://discord.com/developers/applications), an https host, and a Moonetix app.

```bash
git clone https://github.com/moonetix/discord-rewards-bot.git
cd discord-rewards-bot
cp .env.example .env          # fill in your Discord and Moonetix values
npm run register-commands     # once: registers /earn and /balance
npm start                     # listens on PORT (default 3000)
```

Then:

1. In the Discord Developer Portal, set Interactions Endpoint URL to `https://YOUR_HOST/interactions`. Discord sends a signed PING and a request with a bad signature to check it. This server answers both correctly.
2. In the Moonetix dashboard, open Offerwalls, your offerwall, Integration, and copy the App ID and link hash salt into `.env`.
3. On the Postback page, copy the postback secret key into `.env` and save this postback URL:

```
https://YOUR_HOST/moonetix/postback?user={user_id}&tx={transaction_id}&event={event_id}&status={status}&reward={reward}&payout={payout}&offer={offer_name}&hash={hash}
```

4. Link a test member. On your real site this is sign-up plus Discord OAuth2 linking. For local testing:

```bash
npm run link-account -- --discord YOUR_DISCORD_USER_ID --name Ana --age-16-plus
```

| Variable | What it is |
| --- | --- |
| `DISCORD_PUBLIC_KEY` | Public key from General Information. Used to verify every interaction. |
| `DISCORD_APPLICATION_ID`, `DISCORD_BOT_TOKEN` | Only for `scripts/register-commands.js`. |
| `DISCORD_GUILD_ID` | Optional. Registers the commands in one server, where they show up right away. |
| `SITE_URL` | Public https address of your site. The earn page is `SITE_URL/earn`. |
| `LINK_ACCOUNT_URL` | Your page where members link Discord. Default `SITE_URL/account`. |
| `MOONETIX_APP_ID` | App ID from the Integration section. |
| `MOONETIX_LINK_SALT` | Link hash salt from the Integration section. |
| `MOONETIX_POSTBACK_KEY` | Postback secret key from the Postback page. |
| `EARN_COOLDOWN_SECONDS` | Time between two `/earn` uses per member. Default 30. |
| `DATABASE_PATH`, `PORT`, `CURRENCY_NAME` | Optional. |

## How it works

1. Members have an account on your site and link Discord to it with OAuth2. The link is stored in `discord_links`. One Discord account per site account.
2. Discord posts every command to `POST /interactions`. The server verifies `X-Signature-Ed25519` over the timestamp and raw body with your public key, rejects old timestamps, and answers 401 when the check fails.
3. `/earn` looks up the linked account. Not linked: a button to your account page. Under 16: no link. Otherwise an ephemeral reply, which only that member sees, with a button to `SITE_URL/earn?code=...`. The code is random, works once and expires in 10 minutes. It holds no Discord ID and no offerwall link.
4. The earn page swaps the code for an HttpOnly session cookie, redirects to `/earn`, and builds the signed offerwall link there, on the server, from the site account ID.
5. Moonetix calls `GET /moonetix/postback`. The server checks the hash first, credits on status 1 once per `transaction_id`, takes the credited amount back on status 2, and answers 200 after the change is stored.
6. There are no DMs. Members see new rewards with `/balance` and in the Recent rewards list on the earn page.

| Path | Purpose |
| --- | --- |
| `src/discord.js` | Ed25519 signature check |
| `src/commands.js` | `/earn` and `/balance` |
| `src/earn-page.js` | Earn page HTML |
| `src/moonetix.js` | Signed link, postback hash, exact amounts |
| `src/postback.js` | Postback handler |
| `src/store.js` | SQLite accounts, links, sessions, transactions |
| `src/server.js` | HTTP routes |
| `scripts/register-commands.js` | Registers the commands with Discord |
| `scripts/link-account.js` | Links a test account for local testing |

## Security notes

- Secrets come from environment variables only. The interactions endpoint needs just the public key; the bot token is only used by the register script.
- Every interaction is checked with `crypto.verify` and Ed25519 before the body is parsed.
- The offerwall `user_id` is your site account ID. Discord's Developer Policy does not let you disclose API Data, such as a Discord user ID, to monetization services.
- Signed offerwall links are only built on the earn page for the signed-in member. They never appear in Discord. Earn codes and session tokens are stored as SHA-256 hashes.
- The earn page sends a Content-Security-Policy that only allows frames from `wall.moonetix.com`, plus `no-store` and `no-referrer`.
- The postback hash is checked with a constant-time comparison before anything else. Tampered or wrongly signed postbacks get 403.
- `transaction_id` is the primary key of the transactions table, so a retry cannot credit twice. A reversal subtracts the stored credited amount, only for a transaction credited to the same account.
- Amounts are stored as integers in millionths of a coin, so decimal rewards add up exactly.

## Discord rules this app follows

- Coins only for completed offers. Never for joining, inviting, boosting, bumping, reviews, messages or reactions. The app has no gateway connection and cannot see any of those.
- Links only on request, in an ephemeral reply. No offers or links in channels, and no DMs about offers.
- Members must be 16 or older, with a parent's permission under 18. Check age on your site.
- Keep offer-earned coins away from slots, coin flips and other chance games.

Read the current [Discord Developer Policy](https://support-dev.discord.com/hc/en-us/articles/8563934450327-Discord-Developer-Policy) and [Developer Terms of Service](https://support-dev.discord.com/hc/en-us/articles/8562894815383-Discord-Developer-Terms-of-Service) before launch.

## Test it locally

```bash
npm test
```

The tests need no Discord app and no network. They:

- create a local Ed25519 key pair, then check that a valid signature passes and a changed body, timestamp or signature, another key, missing headers and old timestamps fail;
- start the server on a random port with an in-memory database and send signed interactions: PING gets PONG, bad signatures get 401, `/earn` is ephemeral with a link button that holds no Discord ID and no offerwall link, the cooldown works, and unlinked or under-16 members get no link;
- follow the button: the code signs in once, the earn page holds the signed link for the site account, and a reused code, a missing cookie and a forged cookie all fail;
- replay real Moonetix postbacks (`test/fixtures/moonetix-vectors.json`): credit, retry, decimals, reversal, repeated reversal, uncredited `test_` reversal, unknown users, and tampered or wrongly signed postbacks, with `/balance` checked after each step.

## Test it with Moonetix

1. Link your own Discord account to a test site account and run `/earn` in your server. Only you see the reply.
2. Open the earn page. In the dashboard, open Offerwalls, your offerwall, Integration, and use Check a link to compare Test a link for your site account ID with the link on the page.
3. Click Send a test postback for that account ID with status 1. `/balance` goes up once. Resending it from Reports, Postbacks changes nothing.
4. A status 2 test gets a new `test_` transaction ID that was never credited, so the server answers 200 and changes nothing. You can also resend from the Postback page.
5. Open the offerwall from a normal home or mobile connection. VPNs, proxies, Tor and data center networks see a block page.
6. Before launch, remove the test rewards from your test account.

The offerwall iframe only loads on https pages of the website you registered for your Moonetix app. The earn page also has a plain link that opens the offerwall in a new tab.

## Learn more

- Guide: [How to Add an Offerwall to a Discord Bot](https://moonetix.com/academy/integrations/discord-bot-offerwall)
- Guide: [Offerwalls for Discord bots compared](https://moonetix.com/academy/monetization/best-offerwall-for-discord-bots)
- Moonetix for Discord: [moonetix.com/industries/discord](https://moonetix.com/industries/discord)
- Docs: [Postbacks](https://docs.moonetix.com/postbacks), [Offerwall link](https://docs.moonetix.com/offerwall-link), [Credits and reversals](https://docs.moonetix.com/credits-and-reversals), [Testing](https://docs.moonetix.com/testing)
- Free tools: [Offerwall link builder](https://moonetix.com/tools/offerwall-link-builder) and [Postback hash checker](https://moonetix.com/tools/postback-hash-checker)

## Get started

**Get your App ID and keys: sign up free at https://moonetix.com/register**

Every publisher application is reviewed by hand. Once you are approved, add your site as an app, set your coin name and rate, and paste the keys into `.env`.

## License

MIT. See [LICENSE](LICENSE).
