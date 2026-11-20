# Google tag gateway checker: GitHub Pages + Cloudflare Worker (free)

A public page where anyone enters a URL and sees whether Google tag gateway (GTG) is set up, which CDN or
load balancer the site runs on, and which layer serves the gateway. The full report is unlocked with contact
details, which become a graded lead.

```
Visitor ──> https://<you>.github.io/<repo>/      the website (GitHub Pages, static, free)
                │  POST /api/scan, /api/lead
                ▼
            https://dh-gtg-checker-api.<you>.workers.dev   the scanner (Cloudflare Worker, free plan)
                │  fetches the site, DNS (1.1.1.1), /<path>/healthy
                ▼
            the website being checked                     leads ──> Zoho Flow ──> Zoho CRM (after go-live)
```

Why two parts: a page on github.io runs in the visitor's browser, and browsers do not let a page read another
website's response or headers (CORS). The scan has to come from a server; the Worker is that server.

```
engine/    detection rules: 69 providers, verdict, gateway deployment, lead grading (pure JS, 130 tests)
worker/    Cloudflare Worker API (12 tests)
web/       Next.js site, exported as static files for GitHub Pages
.github/workflows/
  ci.yml      every push and pull request: all tests, Worker bundle check, site build
  pages.yml   push to main (web/ changed): builds the site and publishes it to github.io
  worker.yml  push to main (worker/ or engine/ changed): tests, then deploys the Worker after your approval
```

## Before you start: public repo = public code

GitHub Pages is free for **public** repositories. A public repo makes all of this code public, including the
detection rules in `engine/`. Fine for a personal test. For the Datahash launch, keep `engine/` and `worker/`
in a private repo (GitHub Actions also works there) and publish only `web/` publicly, or use a paid GitHub plan,
which can publish Pages from a private repo.

## One-time setup (about 20 minutes)

### 1. Put the code on GitHub
Create a repository (for example `gtg-checker`) and push this folder to its `main` branch.

### 2. Cloudflare account and API token (free)
1. Sign up at dash.cloudflare.com (the free plan is enough).
2. Copy your **Account ID**: Workers & Pages > Overview, right-hand panel.
3. Create an **API token**: My Profile > API Tokens > Create Token > template **"Edit Cloudflare Workers"**.
   Copy it once; Cloudflare will not show it again.

### 3. GitHub secrets and the approval step
In the repo: **Settings > Secrets and variables > Actions**
- Secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`

In **Settings > Environments**: create an environment named `production`, tick **Required reviewers**, add
yourself. Every Worker deploy now waits for your click.

### 4. Deploy the scanner (Worker)
**Actions** tab > "Deploy scanner API (Cloudflare Worker)" > **Run workflow**, then approve it.
At the end of the deploy log, copy the URL, for example `https://dh-gtg-checker-api.<you>.workers.dev`.
Check it in a browser: `https://dh-gtg-checker-api.<you>.workers.dev/api/health` should show `ok`.

### 5. Deploy the website (Pages)
1. **Settings > Secrets and variables > Actions > Variables**: add `API_BASE_URL` = the Worker URL from step 4.
2. **Settings > Pages > Build and deployment > Source**: choose **GitHub Actions**.
3. **Actions** tab > "Deploy website to GitHub Pages" > **Run workflow**.
4. Open `https://<you>.github.io/<repo>/`.

After this, every push to `main` redeploys whatever changed. The site goes live directly; the Worker waits
for your approval.

### 6. Before sharing the link: bot protection (free)
1. Cloudflare dashboard > **Turnstile** > Add widget, hostname `<you>.github.io`.
2. GitHub variable `TURNSTILE_SITE_KEY` = the site key. Re-run the Pages workflow.
3. Worker secret `TURNSTILE_SECRET` = the secret key: Workers & Pages > dh-gtg-checker-api > Settings >
   Variables and Secrets > Add (type Secret).

### 7. Turn on the browser check (free allowance)
Sites that add their Google tag with a script need a real browser. The Worker uses Cloudflare Browser Run for those.
1. Cloudflare > My Profile > API Tokens > Create Token. Policy: **Account > Browser Rendering > Edit** for your
   account. Copy the token.
2. Cloudflare > Workers & Pages > dh-gtg-checker-api > Settings > Variables and Secrets > Add: type **Secret**,
   name `BROWSER_API_TOKEN`, value = the token.
3. Re-run the Worker deploy (it sets `BROWSER_ACCOUNT_ID` itself).
Free plan: 10 minutes of browser time a day and one browser request every 10 seconds. The check runs only when the
page HTML cannot settle the answer; when the allowance is used up, the result stays "could not confirm".
Switch it off with `BROWSER_CHECK = "false"` in `worker/wrangler.toml`.

### Optional settings
| Where | Name | What |
|---|---|---|
| GitHub variable | `BOOKING_URL` | Where "Book a call" buttons go |
| GitHub variable | `PRIVACY_URL` | Privacy policy link in the consent text |
| GitHub variable | `EXTRA_ALLOWED_ORIGINS` | Other sites allowed to call the API, for example `https://datahash.com` |
| Worker (KV) | `SCAN_CACHE` | Shared 24-hour cache: `npx wrangler kv namespace create SCAN_CACHE`, then uncomment it in `worker/wrangler.toml` |

## Leads

**Dry run is on** (`LEADS_DRY_RUN = "true"` in `worker/wrangler.toml`): the visitor gets the full report, and
nothing reaches the CRM. An internal test webhook can receive copies: Worker secret `DRY_RUN_WEBHOOK_URL`.

To go live, after the approvals below: Worker secret `ZOHO_FLOW_WEBHOOK_URL`, then set
`LEADS_DRY_RUN = "false"` in `worker/wrangler.toml` and push (the deploy waits for approval).

Payload: tool, lead (email, name, company, phone, role, consent, consent version), grade A/B/C with reasons,
scanned site, result (status, CDN, proxy type, platform, route, eligibility, gateway runs on, stack, tag IDs,
warnings), UTM, page.

## Kill switch

| To stop | Do | Takes effect |
|---|---|---|
| Scanning | Cloudflare > Worker > Settings > Variables: `SCANNER_ENABLED` = `false` | Immediately |
| Lead capture | Same place: `LEADS_ENABLED` = `false` | Immediately |
| Sending leads to the CRM | Same place: `LEADS_DRY_RUN` = `true` | Immediately |
| The website | Settings > Pages > Unpublish site | Within minutes |

A dashboard change is overwritten by the next Worker deploy, so also change the same value in
`worker/wrangler.toml` and push. Kill-switch owner: **TO BE NAMED**.

## How a scan works (Worker)

1. Validate the URL; resolve it through DNS-over-HTTPS (1.1.1.1). Private, loopback, link-local and
   metadata addresses are refused, on every redirect too.
2. Read the first 400 KB of the home page (the free plan allows ~10 ms CPU per request; the tag snippet is at
   the top) and follow the CNAME chain.
3. Find every Google tag loader. A same-domain `/<path>/?id=GTM-…` is a gateway candidate: it gets
   `/<path>/healthy` (must answer `ok`) and the loader fetch (must return Google tag code). The loader's
   response headers show **which layer runs the gateway**.
4. Identify the CDN, WAF, load balancer, host and server (70 providers), platform, and setup route. Besides
   headers and CNAMEs, the scanner looks up **which network owns the site's address** (Team Cymru's free
   IP-to-ASN lookup over DNS). That recognises Gcore, Qrator, Fastly, Akamai, Bunny, Sucuri, Imperva and others
   even when headers are hidden, and shows "Hosted on Amazon Web Services / DigitalOcean / …" when no CDN is in front.
5. When the HTML alone cannot settle it, Cloudflare Browser Run renders the page and the scanner reads the tag
   loaders the scripts added; any first-party path then gets the `/healthy` check.

**Cloudflare rewrites headers.** Responses the Worker fetches arrive with `server: cloudflare` whatever the site
sent. So Cloudflare headers count only when the site's address is in Cloudflare's published ranges, and the real
web server name (Nginx, Apache…) of a site with no CDN cannot be seen from the Worker.

**Without the browser check** (no token, or the free allowance used up), a site whose tag is added by a script
gets **"could not confirm"** (never "not set up") and the visitor is offered a manual check.

## Limits of the free setup

- Cloudflare Workers free plan: a daily request allowance and ~10 ms CPU per request. Plenty for a lead tool.
- Rate limit (10 scans a minute per visitor) is kept per Worker instance; the KV cache is shared once enabled.
  Cached results do not count against it.
- `workers.dev` and `github.io` addresses; both can move to Datahash domains later.

## Run locally

```bash
cd engine && npm test
cd ../worker && npm ci && npm test
npx wrangler dev --var ALLOWED_ORIGINS:http://localhost:3000     # API on http://localhost:8787
cd ../web && npm ci
NEXT_PUBLIC_API_BASE=http://localhost:8787 npx next dev          # site on http://localhost:3000
```

The Worker checks addresses through public DNS (1.1.1.1), so, unlike the earlier localhost version, a VPN or
DNS filter on your laptop no longer makes it refuse public sites.

Adding a provider: edit `engine/providers.js`, add a fixture in `engine/test/providers.test.js`, `npm test`,
then `cd web && npm run catalog` to refresh the platform list on the page.

## Go-live checklist (Datahash org rules)

- [ ] Hosting approved (Akshat or Gaurav): this uses Cloudflare Workers and GitHub Pages
- [ ] Repo and visibility decided (see "public repo = public code")
- [ ] Turnstile on
- [ ] Consent copy and privacy policy approved; retention period stated
- [ ] Report email and nurture templates approved as exact versions
- [ ] Dry run complete with internal test scans
- [ ] Kill-switch owner named above
- [ ] Then `LEADS_DRY_RUN = "false"` + `ZOHO_FLOW_WEBHOOK_URL`
