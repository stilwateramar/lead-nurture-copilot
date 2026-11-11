# Lead Nurture Copilot

For AKD AI Solutions. Connects to ActiveCampaign and scores each lead's engagement (hot / warm / cool) from site-tracking visits and campaign activity. It matches the lead's interests to your case studies and LinkedIn posts, then drafts a nurture email with Claude. You approve or copy the draft. **Nothing is sent from this app.**

## Run locally (VS Code)
```bash
npm install
cp .env.example .env      # leave AC_* blank to run on demo data
npm run dev               # http://localhost:3000
npm run check             # offline tests for mappers and the draft guard
```
With `APP_PASSWORD` set, the browser asks for a login (user `APP_USER`, default `admin`).

## Connect ActiveCampaign
1. In ActiveCampaign, open **Settings → Developer** and copy the API URL and key into `.env` (`AC_API_URL`, `AC_API_KEY`).
2. Site tracking must be on for `SITE_DOMAIN`, and the tracking code must be installed on the site.
3. Check the real response shapes before trusting the numbers:
   ```bash
   npm run probe -- --email a-real-contact@domain.com
   ```
   This saves raw JSON to `probe-output/` (gitignored) and prints what the mappers produce from it. Fix anything in `src/ac/map.js` that doesn't line up.

### Endpoints used
| Data | Endpoint | Status |
|---|---|---|
| Connection check | `GET /api/3/users/me` | standard v3 |
| Find lead by email | `GET /api/3/contacts?email=` | documented |
| Retrieve all leads | `GET /api/3/contacts?limit=&tagid=&listid=` | documented filters |
| Contact, deals, tags | `GET /api/3/contacts/{id}` (+ `/dealStages/{id}`, `/tags/{id}`) | standard v3 |
| Site visits | `GET /api/3/contacts/{id}/trackingLogs` (`type: "__pagevisit"`, `value` = URL) | documented; **timestamp field name unverified** |
| Sends & clicks | `GET /api/3/activities?contact={id}&include=reference.log.campaign,reference.link` | documented; **sideload key names unverified** |
| Opens | v1 `campaign_report_open_list?campaignid=` per campaign | **response shape unverified**. The v3 activity feed doesn't include opens. Set `AC_OPENS_SOURCE=off` to disable. |

What ActiveCampaign doesn't provide is shown as missing, never estimated: time on page (site tracking doesn't record it), page titles (taken from the URL via `config/topics.json`) and location.

## Your content
Put `.md` files in `content/case-studies/` and `content/linkedin-posts/`:
```markdown
---
title: SEO keyword-gap tool for an SEO agency
tags: seo, keyword research, agency
url: https://akdaisolutions.com/case-studies/seo-keyword-gap-tool
---
Short summary paragraph used in matching and in the email.
```
The 12 built-in sample items are used until this folder has files. You can still drop a folder in the UI for a one-off session.

## Deploy to Render
1. Push this folder to a GitHub repo.
2. In Render, go to **New → Blueprint**, pick the repo, and Render reads `render.yaml`.
3. Fill in the secrets it asks for: `APP_PASSWORD` (required), `AC_API_URL`, `AC_API_KEY`, `ANTHROPIC_API_KEY` (or `OPENROUTER_API_KEY` with `LLM_PROVIDER=openrouter`), and `SENDER_BOOKING_URL`.
4. Deploy. Health check: `/healthz`.

## Not done yet
- Sending: Approve only records the approval (in the browser's localStorage).
- Sample content items have no metrics and no links until you add real files.
- Approvals and snoozes are per browser, not shared across users.
