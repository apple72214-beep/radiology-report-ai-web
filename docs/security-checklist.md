# Security checklist + incident log — Radiology report AI

## Incident 2026-09-21: mobile GitHub login loop
Symptom: red banner "The login session has expired or the authorization code has
already been used" on every attempt (Chrome Beta + Samsung Internet), plus a
scary-looking 404 on the private repo URL (that 404 is BY DESIGN for logged-out
visitors — private repos hide their existence).
Root cause: VPN exit hopping (session seen in YE, SA, DE, FR) triggered GitHub
risk control (`user_session.country_change` events in the Security log);
sessions/cookies were invalidated mid-flow, hence the loop. No compromise
found: no unknown PATs, no email/password-change events, all OAuth events
matched known integrations (Vercel) or the user's own trials.
Resolution: stale sessions revoked; unused app authorizations pruned;
standing rule added below.

## Standing rules
1. NO VPN while signing in to GitHub / email / banking. General browsing: user's choice.
2. 2FA enabled on the GitHub account (authenticator app preferred).
3. Quarterly review: Settings → Sessions, Applications, Personal access tokens.
4. Integrations kept: **Vercel only** (production deploy). Netlify + Render
   installed-apps/authorizations revoked (unused; card-wall platforms).
   OAuth apps revoked when unused: Cloudflare, Netlify Auth, GitHub CLI,
   Copilot Chat App, Manus Connector (if present).
5. PAT policy: fine-grained, scoped to `Radiology-report-AI` only, expiry
   30–90 days, stored at /home/user/tools/.gh_token, NEVER echoed in chat,
   logs, or code. Rotate before expiry; verify with a test push after rotation.
   NOTE 2026-09-21: both existing fine-grained tokens
   (`apple72214-beep-arena`, `radiology reports ai`) expire Tue 2026-09-22 →
   regenerate before then.
6. Private repo URLs returning 404 while logged out is expected, not an outage.
