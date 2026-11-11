# Lead Nurture Copilot: project rules for Claude Code

Internal tool for AKD AI Solutions (akdaisolutions.com). Node 20+ / Express server plus a static single-page UI. Hosted on Render.

## Layout
- `server.js`: routes (`/api/status`, `/api/connect`, `/api/leads`, `/api/lead?email=`, `/api/draft`, `/api/content`, `/healthz`), sign-in (`/login`, `/logout`), static files. Public demo: `/demo` plus `/demo/api/status|content|draft` (draft is demo-leads-only and rate-limited). With no AC credentials, `/` redirects to `/demo`.
- `src/auth.js`: sign-in page + signed HttpOnly session cookie (no Basic-auth popup). `src/ratelimit.js`: in-memory limiter.
- `src/ac/client.js`: ActiveCampaign HTTP (v3 with `Api-Token`, v1 `admin/api.php`), throttled to ≤5 req/s.
- `src/ac/map.js`: raw ActiveCampaign JSON → lead shape. **Field names marked UNVERIFIED must be checked against `probe-output/`.**
- `src/ac/index.js`: live data source. `src/demo.js`: the same interface with 5 fictional demo leads (used when AC credentials are missing); the leads live in `public/demo-data.js`, shared with the browser-only `/demo` page (`public/app.js` answers API calls locally when the path is `/demo`).
- `src/llm.js`: the email prompt (rules live here, server side) + Anthropic / OpenRouter call + post-check (no invented links, no tracking language).
- `src/topics.js` + `config/topics.json`: URL/campaign → topics and page titles.
- `public/index.html` (styles + markup), `public/core.js` (scoring, matching, template, content parsing), `public/app.js` (UI), `public/demo-data.js` (demo leads), `public/login.html` (sign-in page, same tokens and fonts).
- `scripts/probe-ac.mjs`: saves real ActiveCampaign responses to `probe-output/` (gitignored). `scripts/smoke-test.mjs`: offline checks (`npm run check`).
- `content/case-studies/`, `content/linkedin-posts/`: real content (.md with front matter `title`, `tags`, `url`, `type`).
- `legacy/artifact-v3.html`: the original artifact, for reference only.

## Non-negotiable rules
1. Never guess ActiveCampaign endpoints or field names. Check them against the official docs (developers.activecampaign.com) and the real responses from `npm run probe`. If something can't be confirmed, leave the data missing and say so in the UI and the log. Never fill gaps with invented values.
2. The email prompt must not invent metrics, client names, dates or links, and must never tell the lead they were tracked. Keep the post-check in `src/llm.js`.
3. "Approve email" only records an approval. Do not add sending unless the user explicitly asks for it.
4. Never commit `.env`, API keys or `probe-output/`. Never log the API key or v1 URLs (they carry `api_key`).
5. Keep the design: single column, max-width 680px; verdict and one prompt on top; Activity, Matched content, Extraction log, Sources & sender and Raw payload as collapsed rows. Light/dark via CSS tokens. Fonts: Public Sans, Bricolage Grotesque, JetBrains Mono.
6. Demo mode must stay clearly labelled ("demo data") so demo numbers are never mistaken for real ones.
7. Run `npm run check` after changing mappers or the draft guard; update the fixtures in `scripts/smoke-test.mjs` to match real probe output.
