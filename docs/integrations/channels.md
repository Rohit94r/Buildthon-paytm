# Channels and app connections

Set these up in **Integrations → Connections → Add**. Secret fields are encrypted at rest and never shown again. Use **Test** after saving. Connections are picked per agent (Auto Publisher, Notifier, HTTP Action).

## LinkedIn
Posts through LinkedIn's official API when an access token exists. Without one, posts are marked **manual** (copy-ready in Content).
- **Author URN**: `urn:li:organization:<id>` (company page) or a member URN. Leave empty to use the newsroom's LinkedIn integration.
- **Access token**: from a LinkedIn developer app with `w_organization_social` (company) or `w_member_social` (member). Company posting needs LinkedIn's app review.

## Telegram
1. Create a bot with **@BotFather** → copy the **bot token**.
2. Add the bot to the channel/group **as an admin**.
3. **Chat / channel**: `@channelname` or the numeric id (`-100…`).

## X (Twitter)
Threads are prepared for **copy-paste** (X API access is paid). Set the **handle** so previews look right.

## Ghost
Ghost Admin → **Settings → Integrations → Add custom integration** → copy the **Admin API key** (`id:secret`) and the **API URL**. Choose *Publish* or *Draft*.

## Slack
Slack → **Apps → Incoming Webhooks** → add to a channel → paste the **webhook URL**. Used by the Notifier (alerts, daily digests, "new hackathons found").

## Discord
Channel settings → **Integrations → Webhooks → New webhook** → copy the **webhook URL**.

## Email (SMTP)
Any SMTP service (Google Workspace, Zoho, Amazon SES, Brevo…).

| Field | Example |
| --- | --- |
| SMTP host / port | `smtp.gmail.com` / `587` |
| Security | STARTTLS (587) or SSL/TLS (465) |
| Username / password | the mailbox user; for Gmail use an **app password** |
| From address | `alerts@client.com` |
| Default recipients | `team@client.com, owner@client.com` |

## REST API (CRM, Google Sheets, internal systems)
Lets the **HTTP Action** agent call a JSON API, for example "create the lead in the CRM" or "append a row to a sheet".
- **Base URL**: `https://api.crm.example.com/v1`
- **Auth header name / value**: e.g. `Authorization` / `Bearer …` (stored encrypted)
- **Extra allowed hosts**: requests may only go to the base URL's host plus these. Anything else is refused, and private network addresses are blocked unless the server sets `CONNECTIONS_ALLOW_PRIVATE=true`.
- **Health check path**: optional, used by **Test**.

Google Sheets without OAuth: deploy a small Apps Script web app that appends the posted JSON as a row, and use its URL as the base URL.
