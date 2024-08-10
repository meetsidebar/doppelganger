# Slack Doppelganger

Impersonates a user to participate in slack conversations using GPT.

Currently supports
- Respond to IMs (with random delay)
- Respond to mentions (with random delay)
- Post to a channel on an interval
- Post to a DM on an interval

## Setup

Coming soon: bootstrap script. Until then:

- Install `pnpm`, `socat`, [jq](https://jqlang.github.io/jq/)
- `cp .env.sample .env`
- Update variables in `.env`

#### OpenAI

Get your token from [platform.openai.com](https://platform.openai.com).

#### Slack

Get app token, client ID, & redirect URI [Slack App portal](https://api.slack.com/apps/)

Get your `SLACK_USER_TOKEN` token by:
- Start `bin/token-exchange`
- Get the app's shareable URL from **Manage Distribution** in the Slack App portal
- Open the URL, approve the permission prompts
- You may have to accept/ignore the self-signed cert on redirect
- Once redirect completes, confirm that your `SLACK_USER_TOKEN` is stored in `.env`

[token-exchange](bin/token-exchange) captures the oauth redirect and requests an oauth token for you.

## Running Doppelganger

You can optionally customize the `ROLE` in `.env` (e.g. "software developer", "project manager") to nudge the role doppelganger plays.

Then run:

```
pnpm start
```

## Slack App Configuration

If you're creating a new slack app:

- Enable **Socket Mode**
- **Scopes**: `{channels, groups, im, mpim}:{history, read}`, `users:read` and `chat:write`
- **Event Subscriptions**: `message.im`, `message.channels`, `message.groups`, `message.mpim`
- Set redirect URL (e.g. `https://localhost:3000`)
- Ensure app is "installed" after making any changes
