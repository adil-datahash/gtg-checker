import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeHandler, runScan } from '../src/index.js';
import { normalizeInputUrl, isPrivateIp, makeDeps } from '../src/net.js';
import { GTM_GTG, GTM_STANDARD, page } from '../../engine/test/fixtures.js';

// Simulated internet: DNS-over-HTTPS answers + site responses.
const DNS = {
  'gtg-site.com': { a: '104.16.1.1' }, 'www.gtg-site.com': { a: '104.16.1.2', cname: 'www.gtg-site.com.cdn.cloudflare.net.' },
  'plain-site.com': { a: '23.1.1.1', cname: 'plain-site.com.edgekey.net.' },
  'spa-site.com': { a: '76.76.21.21' },
  'internal.example.com': { a: '10.0.0.5' },
  'rebind.example.com': { a: '169.254.169.254' }
};
const SITES = {
  'https://gtg-site.com/': { status: 301, headers: { location: 'https://www.gtg-site.com/' } },
  'https://www.gtg-site.com/': { body: page(GTM_GTG), headers: { 'cf-ray': 'abc-BOM', server: 'cloudflare' } },
  'https://www.gtg-site.com/k9Pm2Qx7/healthy': { body: 'ok', headers: { 'cf-ray': 'abc-BOM', server: 'cloudflare' } },
  'https://www.gtg-site.com/k9Pm2Qx7/?id=GTM-ABC1234': { body: 'window.google_tag_manager={}', headers: { 'cf-ray': 'abc-BOM', server: 'cloudflare', 'cf-cache-status': 'HIT' } },
  'https://plain-site.com/': { body: page(GTM_STANDARD), headers: { server: 'AkamaiGHost', 'akamai-grn': '0.1' } },
  'https://spa-site.com/': { body: page('<script>window.c={gtm:"GTM-SPA1234"}</script>'), headers: { 'x-vercel-id': 'bom1::x', server: 'Vercel' } }
};

function fakeFetch(log = []) {
  return async (url, init = {}) => {
    const u = String(url);
    log.push(u);
    if (u.startsWith('https://cloudflare-dns.com/dns-query')) {
      const q = new URL(u); const name = q.searchParams.get('name'); const type = q.searchParams.get('type');
      const d = DNS[name];
      if (!d || type === 'AAAA') return Response.json({ Answer: [] });
      const ans = [];
      if (d.cname) ans.push({ type: 5, data: d.cname });
      ans.push({ type: 1, data: d.a });
      return Response.json({ Answer: ans });
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
