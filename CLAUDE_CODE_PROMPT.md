I'm continuing work on **Lead Nurture Copilot**, an internal tool for AKD AI Solutions (akdaisolutions.com). This folder is the codebase. Read `CLAUDE.md` first, then `README.md`, `src/ac/map.js` and `src/ac/index.js`.

**What it is**
A Node/Express app with a static single-page UI, deployed on Render. It connects to ActiveCampaign, lists leads by engagement score or retrieves one lead by email, and reads site-tracking visits and campaign sends, clicks and opens. It scores the lead hot, warm or cool, matches case studies and LinkedIn posts from `content/`, and drafts a nurture email with Claude (server-side, with a template fallback). "Approve email" only records an approval. Nothing is sent.

**Current state (be honest about this)**
- Without `AC_API_URL` / `AC_API_KEY` the app runs on 5 fictional demo leads and says "demo data" in the UI.
- The live ActiveCampaign code has only been tested against a mock server, not a real account.
- These are NOT confirmed by ActiveCampaign's docs and must be checked against real responses:
  1. the timestamp field on `GET /api/3/contacts/{id}/trackingLogs` entries (the code tries `tstamp`, `timestamp`, `cdate`, …);
  2. the sideload key names and pointer fields in `GET /api/3/activities?include=reference.log.campaign,reference.link` (the code tries `logs`/`log`, `linkData`, `links`, `campaigns`, with `campaignid`/`campaign` and `link`/`linkid`);
  3. the response shape of v1 `campaign_report_open_list` (numbered keys with `subscriberid`, `email`, `times`). Opens are not in the v3 activity feed.
- Content in `content/` is empty, so the 12 sample items are used.

**Do this, in order**
1. `npm install`, then `npm run check`, then `npm run dev`. Confirm the demo flow works at http://localhost:3000.
2. Ask me for my ActiveCampaign API URL and key, and a real contact email that has site visits and campaign activity. I'll put the URL and key in `.env` myself; don't print them.
3. Run `npm run probe -- --email <that email>`. Read every file in `probe-output/`. For each UNVERIFIED item above, show me the real field names you found and fix `src/ac/map.js` to use them. Don't guess: if the data isn't in the response, leave it missing and say so in the log and UI. If a needed endpoint is missing, look it up on developers.activecampaign.com and tell me what you found before using it.
4. Update the fixtures in `scripts/smoke-test.mjs` to match the real shapes (no personal data in fixtures), and make `npm run check` pass.
5. Run the app against the real account. Check that the numbers for that contact match what ActiveCampaign's UI shows: page visits, campaigns, clicks and opens. Report any mismatch.
6. Help me deploy to Render with `render.yaml` (New → Blueprint). Remind me which secrets to set: `APP_PASSWORD`, `AC_API_URL`, `AC_API_KEY`, `ANTHROPIC_API_KEY` (or OpenRouter), `SENDER_BOOKING_URL`. Initialise git and commit, but never commit `.env` or `probe-output/`.

**Rules to keep**
- Same design: single narrow column (max-width 680px); verdict and one prompt on top; Activity, Matched content, Extraction log, Sources & sender and Raw payload as collapsed rows; light/dark tokens; Public Sans, Bricolage Grotesque, JetBrains Mono.
- The email prompt (in `src/llm.js`) must not invent metrics, client names or links, and must never tell the lead they were tracked. Keep the post-check.
- Don't add email sending unless I ask.

Start with step 1 and report back briefly.
