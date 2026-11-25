import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReport, normalizeProbe, detectTagManagers, freeSummary } from '../detect.js';
import { serverProbeScript, visitorProbeScript } from '../probe.js';

const AKAMAI_BLOCK = { 'server': 'AkamaiGHost', 'content-type': 'text/html' };

function probe(over = {}) {
  return {
    v: 1, mode: 'visitor', url: 'https://www.shop.example/en', host: 'www.shop.example', title: 'Shop', resources: 180,
    loaders: [{ url: 'https://www.shop.example/metrics/gtag/js', host: 'www.shop.example', path: '/metrics/gtag/js', id: '', sameHost: true, afterConsent: false }],
    measurement: [{ host: 'analytics.google.com', path: '/g/collect', id: 'G-ABC123456', gcs: 'G111', count: 2 }],
    ids: ['G-ABC123456'],
    tagManagers: ['Tealium iQ'],
    consent: { cmp: 'OneTrust', requested: true, action: { method: 'button', by: '#onetrust-accept-btn-handler' }, consentMode: [] },
    checks: [{ path: '/metrics/', healthStatus: 200, healthy: true, loaderStatus: 200, servesGoogleJs: true, headers: { server: 'AkamaiGHost' } }],
    ...over
  };
}

function evidence(extra = {}) {
  return {
    inputUrl: 'https://www.shop.example/en', finalUrl: 'https://www.shop.example/en', status: 403,
    headers: AKAMAI_BLOCK, html: '<html><head><title>Access Denied</title></head><body>Access Denied. Reference #18.abc</body></html>',
    cnames: ['www.shop.example.edgekey.net'], scannedAt: '2026-11-24T00:00:00Z', ...extra
  };
}

test('server blocked, but the browser probe confirms GTG through the in-page health check', () => {
  const p = normalizeProbe(probe(), 'www.shop.example', 'visitor_browser');
  const r = buildReport(evidence({ pageProbe: p }));
  assert.equal(r.verdict.status, 'implemented');
  assert.equal(r.verdict.confidence, 'verified');
  assert.deepEqual(r.verdict.gtgPaths, ['/metrics/']);
  assert.equal(r.checkedBy, 'visitor_browser');
  assert.ok(r.warnings.some((w) => w.code === 'server_blocked'));
  assert.ok(r.tagManagers.includes('Tealium iQ'));
  assert.equal(r.consent.banner, 'OneTrust');
  const s = freeSummary(r);
  assert.equal(s.status, 'implemented');
  assert.equal(s.checkedBy, 'visitor_browser');
});

test('without a probe the same response stays blocked', () => {
  const r = buildReport(evidence());
  assert.equal(r.verdict.status, 'blocked');
});

test('a probe that also saw Google-hosted loaders gives partial', () => {
  const p = normalizeProbe(probe({ loaders: [
    ...probe().loaders,
    { url: 'https://www.googletagmanager.com/gtag/js?id=AW-123456789', host: 'www.googletagmanager.com', path: '/gtag/js', id: 'AW-123456789', sameHost: false, afterConsent: true }
  ] }), 'www.shop.example', 'browser_run');
  const r = buildReport(evidence({ pageProbe: p }));
  assert.equal(r.verdict.status, 'partial');
  assert.equal(r.checkedBy, 'browser_run');
  assert.deepEqual(r.consent.tagsOnlyAfterConsent, ['AW-123456789']);
});

test('consent mode: denied by default and tags only after accepting is basic mode', () => {
  const p = normalizeProbe(probe({
    loaders: [{ url: 'https://www.googletagmanager.com/gtm.js?id=GTM-ABCD123', host: 'www.googletagmanager.com', path: '/gtm.js', id: 'GTM-ABCD123', sameHost: false, afterConsent: true }],
    checks: [],
    consent: { cmp: 'Cookiebot', requested: true, action: { method: 'api', by: 'Cookiebot' }, consentMode: [{ type: 'default', state: { ad_storage: 'denied', analytics_storage: 'denied' } }] }
  }), 'shop.example', 'browser_run');
  const r = buildReport(evidence({ status: 200, headers: { server: 'nginx' }, html: '<html><body>Shop</body></html>', pageProbe: p }));
  assert.equal(r.verdict.status, 'not_implemented');
  assert.equal(r.consent.consentMode, 'basic');
  assert.ok(r.warnings.some((w) => w.code === 'after_consent'));
});

test('normalizeProbe rejects a result from another site and drops bad fields', () => {
  assert.equal(normalizeProbe(probe({ host: 'evil.example' }), 'www.shop.example'), null);
  assert.equal(normalizeProbe({ v: 2 }, 'www.shop.example'), null);
  const p = normalizeProbe(probe({
    checks: [{ path: '../../etc/', healthy: true }, { path: '/ok/', healthy: 'yes', headers: { 'Bad Header': 'x', server: 'x'.repeat(500) } }],
    ids: ['G-ABC123456', '<script>'],
    loaders: [{ url: 'javascript:alert(1)' }, { url: 'https://www.shop.example/a/gtag/js', id: 'nope' }]
  }), 'www.shop.example');
  assert.equal(p.checks.length, 1);
  assert.equal(p.checks[0].healthy, false);
  assert.equal(p.checks[0].headers.server.length, 80);
  assert.equal(p.checks[0].headers['Bad Header'], undefined);
  assert.deepEqual(p.ids, ['G-ABC123456']);
  assert.equal(p.loaders.length, 1);
  assert.equal(p.loaders[0].id, '');
});

test('tag managers are named from the page HTML', () => {
  const html = '<script src="//tags.tiqcdn.com/utag/shop/main/prod/utag.js"></script><script src="https://assets.adobedtm.com/launch-EN1.min.js"></script><script src="/cdn-cgi/zaraz/i.js"></script>';
  assert.deepEqual(detectTagManagers(html), ['Tealium iQ', 'Adobe Experience Platform Tags (Launch)', 'Cloudflare Zaraz']);
});

test('the injected scripts are valid JavaScript', () => {
  assert.doesNotThrow(() => new Function(serverProbeScript()));
  assert.doesNotThrow(() => new Function(visitorProbeScript('https://example.org/gtg/')));
});
