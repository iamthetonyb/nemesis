# Cloudflare Security Hardening

Use Cloudflare Pages as the public surface. Do not expose a VPS, MacBook, database, SSH, or admin UI to the Internet.

## Public Release Modes

### Private alpha

- Protect the entire Pages site with Cloudflare Access.
- Allow only your email, trusted collaborators, or a small org group.
- Keep `frontend/robots.txt` and `X-Robots-Tag` as noindex.

### Public demo with anti-bot gate

- Keep the site static on Cloudflare Pages.
- Add a Cloudflare WAF custom rule with a Managed Challenge for:
  - `(http.host eq "YOUR_DOMAIN" and (http.request.uri.path eq "/" or starts_with(http.request.uri.path, "/data/")))`
  - add any future API/search routes before launch
- Use Challenge Passage so humans do not get challenged on every request.
- If you want a visible human check, use Turnstile Pre-clearance so the visitor gets a `cf_clearance` cookie before WAF-protected routes.

Do not implement a fake static JavaScript CAPTCHA. Turnstile tokens must be verified through Siteverify unless you are using Cloudflare-managed pre-clearance/WAF flow.

### Full public release

- Keep static summaries open.
- Put high-volume search behind a Worker + D1 only after indexes exist.
- Rate-limit API/search routes.
- Keep raw source buckets private.
- Keep preview/admin routes behind Access.

## Recommended Cloudflare Settings

- DNS: proxied only; no origin IP because Pages has no origin server.
- SSL/TLS: Full strict where applicable; HTTPS-only.
- Security level: Medium or higher during alpha.
- WAF Custom Rules:
  - Managed Challenge for `/` and `/data/*` during alpha/public demo.
  - Block obvious scanner paths: `/wp-*`, `/phpmyadmin*`, `/.env`, `/server-status`.
  - Rate limit future `/api/*` and `/search*` routes.
- Bots:
  - Free: Bot Fight Mode can help but is blunt.
  - Pro+: Super Bot Fight Mode gives more control and can challenge/block bot groups.
  - Use "Block AI bots" if you do not want crawler/model training traffic.
- Access:
  - Protect preview/admin/private paths.
  - Require MFA on the identity provider.
- Analytics:
  - Watch Security Events after any rule change.
  - Tune challenges if legitimate users get blocked.

## Headers Already Added

`frontend/_headers` sets:

- `Content-Security-Policy`
- `X-Frame-Options`
- `X-Content-Type-Options`
- `Referrer-Policy`
- `Permissions-Policy`
- `X-Robots-Tag`
- cross-origin isolation guardrails

Current CSP permits `unpkg.com` and Google Fonts because the inherited static frontend still loads MapLibre and fonts from CDNs. It also temporarily permits `unsafe-inline` scripts because the inherited UI still uses inline event handlers in generated HTML. For a stricter release, move UI actions to delegated event listeners, vendor external assets locally, and remove external script/style/font domains plus `unsafe-inline`.

Current CSP also permits `tile.openstreetmap.org` for the public demo basemap. Keep this for low-volume testing only. Before broader launch, switch to a paid/free-tier tile provider with production terms, self-host PMTiles, or use Cloudflare/R2-hosted vector tiles so the app does not depend on best-effort public OSM tiles.

## Privacy/Anonymity Boundaries

What helps:

- Cloudflare Pages instead of home-hosting.
- Domain privacy or org/LLC/nonprofit registration.
- Separate project email, password manager vault, and MFA hardware key.
- No home IP in DNS.
- No analytics that logs unnecessary personal data.
- Private R2/B2 buckets with scoped tokens.
- Publish factual records only with source links.

What does not guarantee anonymity:

- VPN alone.
- Static CAPTCHA in client-side JavaScript.
- `robots.txt`.
- Hiding repo history after personal details were committed.

Use a VPN for admin browsing on public/untrusted networks. Do not use VPNs, residential proxies, or rotating proxies to bypass official source rate limits, access controls, or terms.

## Source Safety

- Store raw source snapshots privately.
- Publish only generated, source-linked records.
- Use "flag", "risk", "needs review", and "source discrepancy".
- Avoid labeling conduct as fraud/crime/corruption unless quoting official enforcement documents.
- Provide a correction contact path before broad public launch.

## References

- Cloudflare Turnstile Pre-clearance: https://developers.cloudflare.com/turnstile/get-started/pre-clearance/
- Cloudflare Challenge Pages / Challenge Passage: https://developers.cloudflare.com/waf/tools/challenge-passage/
- Cloudflare Super Bot Fight Mode: https://developers.cloudflare.com/bots/get-started/super-bot-fight-mode/
- Cloudflare Pages headers: https://developers.cloudflare.com/pages/configuration/headers/
- Cloudflare Access self-hosted apps: https://developers.cloudflare.com/cloudflare-one/applications/configure-apps/self-hosted-apps/
