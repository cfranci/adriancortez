# Deploy status — adriancortez Worker

## Live now
- Static site: https://cfranci.github.io/adriancortez/ (GitHub Pages, repo cfranci/adriancortez, serves from docs/)
- Backend (admin login + CRM + marketing): CODE COMPLETE, NOT deployed — blocked on Cloudflare token scopes.

## Blocker (Adrian's side, 2 minutes)
Adrian's Cloudflare account: a19dd580b1f108690dcd9b400cfd0898 (Acortezrealtor@gmail.com).
Token he sent verifies + can read the account, but has NO Workers/KV/D1 scopes, and the account
has no workers.dev subdomain yet. Both need Adrian:
1. Dashboard > Workers & Pages (opening it once creates his workers.dev subdomain).
2. My Profile > API Tokens > Create Token > Custom, add permissions:
   Account · Workers Scripts · Edit
   Account · Workers KV Storage · Edit
   Account · D1 · Edit
   Account · Account Settings · Read
   (no IP filter), then send the new token.
3. Put it in site/.env as CLOUDFLARE_API_TOKEN, run `bash deploy.sh`. Done.

## Fallback
Host on Chase's own Cloudflare instead (needs a fresh API KING token — old one is dead/IP-locked).
Then it's Chase-controlled, not fully Adrian's.
