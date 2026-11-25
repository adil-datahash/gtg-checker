import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeHandler, runScan } from '../src/index.js';
import { browserTagRequests, tagRequestsFromHtml } from '../src/browser.js';
import { normalizeInputUrl, isPrivateIp, makeDeps, siteHeaders, isCloudflareIp } from '../src/net.js';
import { GTM_GTG, GTM_STANDARD, page } from '../../engine/test/fixtures.js';

// Simulated internet: DNS-over-HTTPS answers + site responses.
const DNS = {
  'gtg-site.com': { a: '104.16.1.1' }, 'www.gtg-site.com': { a: '104.16.1.2', cname: 'www.gtg-site.com.cdn.cloudflare.net.' },
  'plain-site.com': { a: '23.1.1.1', cname: 'plain-site.com.edgekey.net.' },
  'spa-site.com': { a: '76.76.21.21' },
  'internal.example.com': { a: '10.0.0.5' },
  'rebind.example.com': { a: '169.254.169.254' },
  'fortress-shop.com': { a: '23.2.2.2', cname: 'fortress-shop.com.edgekey.net.' }, 'walled-shop.com': { a: '23.2.2.3' },
  'nginx-site.org': { a: '3.125.197.172' }, 'vip-site.com': { a: '192.0.66.32' }, 'gcore-site.com': { a: '92.223.116.254' }
};
const SITES = {
  'https://gtg-site.com/': { status: 301, headers: { location: 'https://www.gtg-site.com/' } },
  'https://www.gtg-site.com/': { body: page(GTM_GTG), headers: { 'cf-ray': 'abc-BOM', server: 'cloudflare' } },
  'https://www.gtg-site.com/k9Pm2Qx7/healthy': { body: 'ok', headers: { 'cf-ray': 'abc-BOM', server: 'cloudflare' } },
  'https://www.gtg-site.com/k9Pm2Qx7/?id=GTM-ABC1234': { body: 'window.google_tag_manager={}', headers: { 'cf-ray': 'abc-BOM', server: 'cloudflare', 'cf-cache-status': 'HIT' } },
  'https://plain-site.com/': { body: page(GTM_STANDARD), headers: { server: 'AkamaiGHost', 'akamai-grn': '0.1' } },
  // A non-Cloudflare site whose response picked up Cloudflare's cf-* headers on the way to the Worker.
  'https://nginx-site.org/': { body: page('<p>no tags</p>'), headers: { server: 'cloudflare', 'cf-cache-status': 'MISS', 'cf-ray': 'abc-FRA', 'x-frame-options': 'DENY' } },
  'https://gcore-site.com/': { body: page(GTM_STANDARD), headers: { server: 'cloudflare' } },
  // Akamai bot protection: the server only ever gets "Access Denied".
  'https://fortress-shop.com/': { status: 403, body: '<html><head><title>Access Denied</title></head><body>Access Denied. Reference #18.1</body></html>', headers: { server: 'AkamaiGHost' } },
  'https://fortress-shop.com/metrics/healthy': { status: 403, body: 'Access Denied', headers: { server: 'AkamaiGHost' } },
  'https://walled-shop.com/': { status: 403, body: '<html><head><title>Access Denied</title></head><body>Access Denied</body></html>', headers: { server: 'AkamaiGHost' } },
  'https://spa-site.com/m9x/healthy': { body: 'ok', headers: { 'x-vercel-id': 'bom1::h' } },
  'https://spa-site.com/m9x/?id=GTM-SPA1234': { body: 'window.google_tag_manager={}', headers: { 'x-vercel-id': 'bom1::j' } },
  'https://vip-site.com/': { body: page(GTM_STANDARD), headers: { server: 'nginx', 'x-ac': '1.bom _dca MISS' } },
  'https://spa-site.com/': { body: page('<script>window.c={gtm:"GTM-SPA1234"}</script>'), headers: { 'x-vercel-id': 'bom1::x', server: 'Vercel' } }
};

// What the in-page probe reports on a Tealium + OneTrust shop with a gateway at /metrics/.
const FORTRESS_PROBE = {
  v: 1, mode: 'server', url: 'https://fortress-shop.com/', host: 'fortress-shop.com', title: 'Shop', resources: 150,
  loaders: [{ url: 'https://fortress-shop.com/metrics/gtag/js?id=G-FORT123456', host: 'fortress-shop.com', path: '/metrics/gtag/js', id: 'G-FORT123456', sameHost: true, afterConsent: true }],
  measurement: [], ids: ['G-FORT123456'], tagManagers: ['Tealium iQ'],
  consent: { cmp: 'OneTrust', requested: true, action: { method: 'button', by: '#onetrust-accept-btn-handler' }, consentMode: [{ type: 'default', state: { ad_storage: 'denied', analytics_storage: 'denied' } }] },
  checks: [{ path: '/metrics/', healthStatus: 200, healthy: true, loaderStatus: 200, servesGoogleJs: true, headers: { server: 'AkamaiGHost', 'akamai-cache-status': 'Miss from child' } }]
};

function fakeFetch(log = []) {
  return async (url, init = {}) => {
    const u = String(url);
    log.push(u);
    if (u.startsWith('https://cloudflare-dns.com/dns-query')) {
      const q = new URL(u); const name = q.searchParams.get('name'); const type = q.searchParams.get('type');
      if (type === 'TXT') {
        // Team Cymru IP-to-ASN answers for the fake addresses.
        const ASN = { '92.223.116.254': ['199524', 'GCORE - G-Core Labs S.A., LU'], '3.125.197.172': ['16509', 'AMAZON-02 - Amazon.com, Inc., US'] };
        const m = name.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)\.origin\.asn\.cymru\.com$/);
        if (m) {
          const ip = [m[4], m[3], m[2], m[1]].join('.');
          return Response.json({ Answer: ASN[ip] ? [{ type: 16, data: `"${ASN[ip][0]} | 0.0.0.0/8 | US | arin | 2010-01-01"` }] : [] });
        }
        const a = name.match(/^AS(\d+)\.asn\.cymru\.com$/);
        const hit = a && Object.values(ASN).find((x) => x[0] === a[1]);
        return Response.json({ Answer: hit ? [{ type: 16, data: `"${hit[0]} | US | arin | 2010-01-01 | ${hit[1]}"` }] : [] });
      }
      const d = DNS[name];
      if (!d || type === 'AAAA') return Response.json({ Answer: [] });
      const ans = [];
      if (d.cname) ans.push({ type: 5, data: d.cname });
      ans.push({ type: 1, data: d.a });
      return Response.json({ Answer: ans });
    }
    if (u.includes('/browser-rendering/content')) {
      const target = JSON.parse(init.body).url;
      if (target.startsWith('https://fortress-shop.com')) {
        const probe = JSON.stringify(FORTRESS_PROBE).replace(/</g, '\\u003c');
        return Response.json({ success: true, meta: { status: 200 }, result: `<html><head></head><body>shop<script type="application/json" id="dh-gtg-probe">${probe}</script></body></html>` });
      }
      if (target.startsWith('https://walled-shop.com')) {
        return Response.json({ success: true, meta: { status: 403 }, result: '<html><body>Access Denied</body></html>' });
      }
      if (target.startsWith('https://spa-site.com')) {
        return Response.json({ success: true, result: '<html><head><script async src="/m9x/?id=GTM-SPA1234"></script></head><body></body></html>' });
      }
      return Response.json({ success: true, result: '<html><head></head><body>rendered, no tags</body></html>' });
    }
    if (u.startsWith('https://flow.example/')) return new Response('ok');
    const s = SITES[u];
    if (!s) return new Response('not found', { status: 404 });
    return new Response(s.body ?? '', { status: s.status ?? 200, headers: s.headers || {} });
  };
}

const ORIGIN = 'https://adil.github.io';
const ENV = { ALLOWED_ORIGINS: `${ORIGIN},http://localhost:3000` };
const req = (path, body, { origin = ORIGIN, ip = '1.1.1.1', method = 'POST' } = {}) =>
  new Request(`https://api.example.workers.dev${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}), 'cf-connecting-ip': ip },
    body: method === 'POST' ? JSON.stringify(body) : undefined
  });

test('scan from the github.io site returns only the free summary, with CORS for that origin', async () => {
  const handle = makeHandler({ fetchImpl: fakeFetch() });
  const res = await handle(req('/api/scan', { url: 'gtg-site.com' }), ENV);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), ORIGIN);
  const d = await res.json();
  assert.equal(d.summary.status, 'implemented');
  assert.equal(d.summary.gtgServedBy, 'Cloudflare');
  assert.equal(d.report, undefined);
  assert.ok(!JSON.stringify(d).includes('k9Pm2Qx7'));
});

test('other sites cannot call the API', async () => {
  const handle = makeHandler({ fetchImpl: fakeFetch() });
  const res = await handle(req('/api/scan', { url: 'gtg-site.com' }, { origin: 'https://evil.example' }), ENV);
  assert.equal(res.status, 403);
  assert.equal(res.headers.get('access-control-allow-origin'), null);
});

test('preflight and health', async () => {
  const handle = makeHandler({ fetchImpl: fakeFetch() });
  const pre = await handle(req('/api/scan', null, { method: 'OPTIONS' }), ENV);
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-methods'), 'POST, OPTIONS');
  const h = await handle(req('/api/health', null, { method: 'GET' }), ENV);
  assert.equal(await h.text(), 'ok');
});

test('private targets are refused through public DNS', async () => {
  const handle = makeHandler({ fetchImpl: fakeFetch() });
  for (const url of ['internal.example.com', 'rebind.example.com']) {
    const d = await (await handle(req('/api/scan', { url }, { ip: '2.2.2.' + url.length }), ENV)).json();
    assert.equal(d.error, 'blocked_target', url);
  }
  const bad = await (await handle(req('/api/scan', { url: 'localhost' }), ENV)).json();
  assert.equal(bad.error, 'invalid_url');
});

test('script-added tag with no browser -> "unconfirmed" (browser_not_run), never "not set up"', async () => {
  const r = await runScan('spa-site.com', makeDeps(fakeFetch()));
  assert.equal(r.verdict.status, 'unconfirmed');
  assert.equal(r.verdict.reason, 'browser_not_run');
  assert.equal(r.infra.primary, 'Vercel');
});

test('Akamai found through DNS CNAME and header; standard GTM -> not set up', async () => {
  const r = await runScan('plain-site.com', makeDeps(fakeFetch()));
  assert.equal(r.verdict.status, 'not_implemented');
  assert.equal(r.infra.primary, 'Akamai');
  assert.ok(r.infra.signals.some((s) => s.check === 'DNS CNAME'));
});

test('cached scans do not count against the rate limit', async () => {
  const handle = makeHandler({ fetchImpl: fakeFetch() });
  const env = { ...ENV, SCAN_RATE_PER_MINUTE: '1' };
  const codes = [];
  for (const url of ['gtg-site.com', 'gtg-site.com', 'gtg-site.com', 'plain-site.com', 'spa-site.com']) {
    codes.push((await handle(req('/api/scan', { url }, { ip: '7.7.7.7' }), env)).status);
  }
  assert.equal(codes[1], 200);
  assert.equal(codes[2], 200);
  assert.ok(codes.includes(429));
});

test('kill switches', async () => {
  const handle = makeHandler({ fetchImpl: fakeFetch() });
  assert.equal((await handle(req('/api/scan', { url: 'gtg-site.com' }), { ...ENV, SCANNER_ENABLED: 'false' })).status, 503);
  assert.equal((await handle(req('/api/lead', { url: 'gtg-site.com' }), { ...ENV, LEADS_ENABLED: 'false' })).status, 503);
});

test('lead in dry run: full report back, nothing sent to the live webhook', async () => {
  const log = [];
  const handle = makeHandler({ fetchImpl: fakeFetch(log) });
  const res = await handle(req('/api/lead', { url: 'plain-site.com', name: 'Asha', email: 'asha@plain-site.com', consent: true }, { ip: '3.3.3.3' }),
    { ...ENV, ZOHO_FLOW_WEBHOOK_URL: 'https://flow.example/live' });
  const d = await res.json();
  assert.equal(res.status, 200);
  assert.equal(d.dryRun, true);
  assert.equal(d.report.infra.primary, 'Akamai');
  assert.ok(!log.includes('https://flow.example/live'));
});

test('lead live: posts the graded lead to Zoho Flow', async () => {
  const log = [];
  const handle = makeHandler({ fetchImpl: fakeFetch(log) });
  const res = await handle(req('/api/lead', { url: 'gtg-site.com', name: 'R', email: 'r@agency.io', consent: true }, { ip: '4.4.4.4' }),
    { ...ENV, LEADS_DRY_RUN: 'false', ZOHO_FLOW_WEBHOOK_URL: 'https://flow.example/live' });
  const d = await res.json();
  assert.equal(d.delivered, true);
  assert.ok(log.includes('https://flow.example/live'));
});

test('lead validation and missing live webhook', async () => {
  const handle = makeHandler({ fetchImpl: fakeFetch() });
  const bad = await handle(req('/api/lead', { url: 'gtg-site.com', name: 'R', email: 'nope', consent: true }, { ip: '5.5.5.5' }), ENV);
  assert.equal(bad.status, 400);
  const missing = await handle(req('/api/lead', { url: 'gtg-site.com', name: 'R', email: 'r@x.io', consent: true }, { ip: '5.5.5.6' }), { ...ENV, LEADS_DRY_RUN: 'false' });
  assert.equal(missing.status, 503);
});

test('URL guard and private IP check', () => {
  for (const bad of ['localhost', 'http://127.0.0.1', 'ftp://x.com', 'http://a.internal', 'https://u:p@x.com', 'http://x.com:8080']) assert.throws(() => normalizeInputUrl(bad), undefined, bad);
  for (const ip of ['10.1.2.3', '169.254.169.254', '192.168.1.1', '198.18.0.1', '::1', 'fd00::1']) assert.ok(isPrivateIp(ip), ip);
  assert.ok(!isPrivateIp('104.16.1.1'));
});

test('a non-Cloudflare site rewritten to "server: cloudflare" on the way in is not reported as Cloudflare', async () => {
  const r = await runScan('nginx-site.org', makeDeps(fakeFetch()));
  assert.notEqual(r.infra.primary, 'Cloudflare');
  assert.ok(!r.infra.stack.some((x) => x.id === 'cloudflare'));
});

test('Cloudflare address ranges', () => {
  for (const ip of ['104.16.1.2', '104.21.5.9', '172.67.180.1', '188.114.97.3', '162.159.1.1', '2606:4700::6810:84e5', '2a06:98c1:3120::3']) assert.ok(isCloudflareIp(ip), ip);
  for (const ip of ['3.125.197.172', '23.1.1.1', '76.76.21.21', '151.101.1.57', '2a04:4e42::81']) assert.ok(!isCloudflareIp(ip), ip);
  const kept = siteHeaders(new Headers({ server: 'cloudflare', 'cf-ray': 'x' }), ['104.16.1.2']);
  assert.equal(kept.get('cf-ray'), 'x');
  const dropped = siteHeaders(new Headers({ server: 'cloudflare', 'cf-ray': 'x', 'x-served-by': 'cache-bom1' }), ['151.101.1.57']);
  assert.equal(dropped.get('server'), null);
  assert.equal(dropped.get('cf-ray'), null);
  assert.equal(dropped.get('x-served-by'), 'cache-bom1');
});

test('a real Cloudflare site keeps its Cloudflare headers', async () => {
  const r = await runScan('gtg-site.com', makeDeps(fakeFetch()));
  assert.equal(r.infra.primary, 'Cloudflare');
  assert.equal(r.gtg.servedBy, 'Cloudflare');
});

test('192.0.66.x (public) is scanned; only 192.0.0.x and 192.0.2.x are reserved', async () => {
  assert.ok(!isPrivateIp('192.0.66.32'));
  assert.ok(!isPrivateIp('192.0.66.110'));
  assert.ok(isPrivateIp('192.0.0.8'));
  assert.ok(isPrivateIp('192.0.2.1'));
  assert.ok(isPrivateIp('198.51.100.7'));
  assert.ok(isPrivateIp('203.0.113.9'));
  const r = await runScan('vip-site.com', makeDeps(fakeFetch()));
  assert.equal(r.verdict.status, 'not_implemented');
});

// ---------- network (ASN) lookup ----------

test('Gcore is recognised from its network even when headers are rewritten', async () => {
  const r = await runScan('gcore-site.com', makeDeps(fakeFetch()));
  assert.equal(r.infra.primary, 'Gcore');
  assert.ok(r.infra.signals.some((x) => x.check === 'IP network' && x.points_to === 'Gcore'));
});

test('site with no CDN: shows the hosting network instead of "not identified"', async () => {
  const handle = makeHandler({ fetchImpl: fakeFetch() });
  const d = await (await handle(req('/api/scan', { url: 'nginx-site.org' }, { ip: '6.6.6.6' }), ENV)).json();
  assert.equal(d.summary.hostedOn, 'Amazon Web Services');
  assert.equal(d.summary.cdn, null);
});

// ---------- browser check (Cloudflare Browser Run) ----------

const BENV = { BROWSER_ACCOUNT_ID: 'acc123', BROWSER_API_TOKEN: 'tok' };
let clock = 1_000_000;
const tick = () => (clock += 20_000); // each call 20 s apart, past the free-plan spacing

test('rendered HTML reveals a script-added gateway path, confirmed by /healthy', async () => {
  const f = fakeFetch();
  const deps = { ...makeDeps(f), browserScan: (u) => browserTagRequests(u, BENV, f, tick) };
  const r = await runScan('spa-site.com', deps);
  assert.equal(r.verdict.status, 'implemented');
  assert.equal(r.verdict.confidence, 'verified');
  assert.equal(r.gtg.servedBy, 'Vercel');
  assert.ok(r.warnings.some((w) => w.code === 'found_in_browser'));
});

test('browser ran but no tag request -> "could not confirm" with the browser reason', async () => {
  const f = fakeFetch();
  const r = await runScan('spa-site.com', { ...makeDeps(f), browserScan: async () => ({ ran: true, tagRequests: [] }) });
  assert.equal(r.verdict.status, 'unconfirmed');
  assert.equal(r.verdict.reason, 'not_seen_in_browser');
});

test('browser limit reached or not configured -> falls back quietly', async () => {
  const limited = async (url) => (String(url).includes('/browser-rendering/') ? new Response('{}', { status: 429 }) : fakeFetch()(url));
  const a = await browserTagRequests('https://spa-site.com/', BENV, limited, tick);
  assert.equal(a.ran, false);
  assert.equal(a.error, 'browser_limit');
  const b = await browserTagRequests('https://spa-site.com/', {}, fakeFetch(), tick);
  assert.equal(b.error, 'browser_not_configured');
  const fixed = () => 5_000_000;
  await browserTagRequests('https://spa-site.com/', BENV, fakeFetch(), fixed);
  const c = await browserTagRequests('https://spa-site.com/', BENV, fakeFetch(), fixed);
  assert.equal(c.error, 'browser_busy', 'second call inside 10 s is skipped');
});

test('tag loaders are read from rendered HTML', () => {
  const html = '<script src="https://www.googletagmanager.com/gtm.js?id=GTM-ABC1234"></script><script src="/app.js"></script><script src="/k7/?id=G-ABCDEF1234&amp;l=dl"></script>';
  assert.deepEqual(tagRequestsFromHtml(html, 'https://shop.com/'), ['https://www.googletagmanager.com/gtm.js?id=GTM-ABC1234', 'https://shop.com/k7/?id=G-ABCDEF1234&l=dl']);
});

// ---------- in-page probe: blocked sites, tag managers, consent ----------

let clock2 = 100_000_000; // later than any clock used above, so the 10-second spacing never trips
const tick2 = () => (clock2 += 20_000);

test('server blocked by Akamai: Browser Run probe accepts consent and confirms the gateway from inside the page', async () => {
  const f = fakeFetch();
  const r = await runScan('fortress-shop.com', { ...makeDeps(f), browserScan: (u) => browserTagRequests(u, BENV, f, tick2) });
  assert.equal(r.verdict.status, 'implemented');
  assert.equal(r.verdict.confidence, 'verified');
  assert.equal(r.checkedBy, 'browser_run');
  assert.equal(r.consent.banner, 'OneTrust');
  assert.equal(r.consent.consentMode, 'basic');
  assert.deepEqual(r.consent.tagsOnlyAfterConsent, ['G-FORT123456']);
  assert.ok(r.tagManagers.includes('Tealium iQ'));
  assert.equal(r.gtg.servedBy, 'Akamai');
  assert.ok(r.warnings.some((w) => w.code === 'server_blocked'));
});

test('Browser Run blocked too: stays "blocked" and says so, so the page can offer the visitor check', async () => {
  const f = fakeFetch();
  const r = await runScan('walled-shop.com', { ...makeDeps(f), browserScan: (u) => browserTagRequests(u, BENV, f, tick2) });
  assert.equal(r.verdict.status, 'blocked');
  assert.equal(r.browserCheck.error, 'browser_blocked');
});

test('visitor browser result: accepted for the same site, never cached, refused for another site', async () => {
  const h = makeHandler({ fetchImpl: fakeFetch() });
  const probe = { ...FORTRESS_PROBE, mode: 'visitor' };
  const a = await (await h(req('/api/scan', { url: 'fortress-shop.com', probe }, { ip: '8.8.1.1' }), ENV)).json();
  assert.equal(a.summary.status, 'implemented');
  assert.equal(a.summary.checkedBy, 'visitor_browser');
  assert.equal(a.cached, false);
  const b = await h(req('/api/scan', { url: 'walled-shop.com', probe }, { ip: '8.8.1.2' }), ENV);
  assert.equal(b.status, 422);
  assert.equal((await b.json()).error, 'bad_probe');
  // The visitor's result did not land in the shared cache: a plain scan of the same site is still blocked.
  const c = await (await h(req('/api/scan', { url: 'fortress-shop.com' }, { ip: '8.8.1.3' }), ENV)).json();
  assert.equal(c.summary.status, 'blocked');
});
