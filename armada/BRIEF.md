# Armada brief — marketing backend for adriancortez worker

Read these files FIRST (they exist and are the integration target):
- `/Users/cf/Projects/adrian/site/src/worker.js` — Cloudflare Worker: static assets + KV content + lead inbox + admin auth (HMAC cookie from ADMIN_KEY secret, `isAdmin()` helper)
- `/Users/cf/Projects/adrian/site/public/admin/index.html` — single-file admin panel (login + tabs: Leads / Listings / Site copy), vanilla JS, `esc()` for all rendered data
- `/Users/cf/Projects/adrian/site/wrangler.toml` — assets binding + KV namespace SITE (id placeholder, being provisioned)
- `/Users/cf/Projects/adrian/site/public/index.html` — public site (has a lead form that POSTs /api/lead)

## What we're adding
A text (SMS) + email marketing backend so Adrian Cortez (Miami realtor) can manage his sphere and send campaigns.

- **D1 database** `adriancortez-marketing`, binding `DB`. Tables: contacts (id, name, phone E.164, email, tags CSV/JSON, consent_sms, consent_email, source, notes, created), campaigns (id, channel sms|email, name, subject, body with {{name}} merge, segment/tag filter, status draft|scheduled|sending|sent|paused, scheduled_at, created), sends (campaign_id, contact_id, channel, status queued|sent|delivered|failed|suppressed, provider_id, error, ts), suppressions (phone/email, channel, reason, ts).
- **SMS via Twilio REST API** (fetch, no SDK). Secrets: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM. Batched sending with throttling that respects Workers subrequest limits (send in chunks via cron ticks, not one giant loop). Inbound webhook POST /api/hooks/twilio: validate X-Twilio-Signature, handle STOP/UNSUBSCRIBE/CANCEL/QUIT (suppress + confirm), HELP, START (re-opt-in).
- **Email via Resend API** (fetch). Secrets: RESEND_API_KEY, EMAIL_FROM. Every marketing email gets a signed unsubscribe link (HMAC token, GET /u/:token suppresses + friendly page) and List-Unsubscribe header.
- **Compliance, non-negotiable**: marketing SMS auto-append "Txt STOP to opt out" if missing; suppressed/no-consent contacts excluded at send time (not just in UI); default quiet hours, only send SMS 09:00–20:00 America/New_York, campaigns queued outside that window wait; a campaign send requires an explicit typed confirmation in the UI ("SEND" + recipient count shown).
- **Scheduling**: `[triggers] crons = ["*/5 * * * *"]` — the cron tick moves scheduled→sending, processes send queue in chunks (e.g. 50/tick), records per-recipient results.
- **Admin UI**: extend the EXISTING admin panel with tabs Contacts and Campaigns. Contacts: list/search, add/edit, CSV import (paste or file), one-click "import from lead inbox" (pull KV lead:* into contacts with consent flags off→ask), tag editing. Campaigns: list w/ stats (queued/sent/failed/suppressed), composer (channel, name, subject for email, body textarea with {{name}}, tag filter with live recipient count, test-send to Adrian, send now / schedule datetime). Same visual language (ink/paper/tide palette, Bodoni Moda + Archivo, same button/panel classes) and same session cookie auth.

## Constraints
- Vanilla JS only, no build step, no frameworks, no npm deps in the worker.
- Keep the existing endpoints working exactly as they are.
- Structure: add `src/marketing.js` (exports a `handleMarketing(req, env, url)` router + `runCron(env)`) imported from `src/worker.js`; admin marketing UI may be a new `public/admin/marketing.js` loaded by the existing admin page, or inline in index.html — pick ONE and be consistent.
- `esc()` everything rendered into the DOM from data. Validate/normalize phone to E.164 (+1 default).
- All /api/admin/* marketing routes gated by the existing isAdmin().
- Twilio A2P 10DLC registration is an account-level prerequisite; note it in docs, don't build around it.

## Deliverable format (STRICT, for every generator and stitcher)
Return complete, drop-in file contents in delimited blocks:
=== FILE: src/marketing.js ===
...full contents...
=== END FILE ===
Plus: the SQL migration (=== FILE: migrations/0001_marketing.sql ===), wrangler.toml additions as a diff block, list of secrets to set, and integration notes (exact lines to add to worker.js / admin index.html). Do NOT write to the repo working tree; return content only. Work only from this brief and the files listed above.
