import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReport, freeSummary, registrableDomain } from '../detect.js';
import { gradeLead, validateLead } from '../lead.js';

import { GTM_STANDARD, GTM_GTG, page } from './fixtures.js';

const R = (o) => buildReport({ inputUrl: o.url, finalUrl: o.url, status: o.status ?? 200, headers: o.headers || {}, html: o.html, cnames: o.cnames || [], assetHosts: o.assetHosts || [], probes: o.probes || {}, scannedAt: 't' });

test('GTG via GTM snippet on Cloudflare, health ok -> implemented, verified', () => {
  const r = R({ url: 'https://www.shop.example.com/', headers: { 'cf-ray': '8a1-BOM', server: 'cloudflare' }, html: page(GTM_GTG),
    probes: { '/k9Pm2Qx7/': { healthy: true, servesGoogleJs: true, headers: { 'cf-ray': 'x-BOM', server: 'cloudflare', 'cf-cache-status': 'MISS' } } } });
  assert.equal(r.verdict.status, 'implemented');
  assert.equal(r.verdict.confidence, 'verified');
  assert.equal(r.infra.primary, 'Cloudflare');
  assert.equal(r.route.key, 'cloudflare');
  assert.equal(r.gtg.servedBy, 'Cloudflare');
  assert.equal(r.gtg.basis, 'gateway_response');
  assert.equal(r.gtg.cacheStatus, 'cf-cache-status: MISS');
  assert.match(r.gtg.summary, /Cloudflare forwards \/k9Pm2Qx7\/ on your domain to Google/);
});

test('gateway path served by a different provider than the site -> split_edge warning', () => {
  const r = R({ url: 'https://www.example.com/', headers: { 'akamai-grn': '0.1', server: 'AkamaiGHost' }, html: page(GTM_GTG),
    probes: { '/k9Pm2Qx7/': { healthy: true, servesGoogleJs: true, headers: { 'x-amz-cf-id': 'abc', 'x-cache': 'Miss from cloudfront' } } } });
  assert.equal(r.infra.primary, 'Akamai');
  assert.equal(r.gtg.servedBy, 'Amazon CloudFront');
  assert.equal(r.gtg.differsFromSite, true);
  assert.ok(r.warnings.some((w) => w.code === 'split_edge'));
  assert.match(r.gtg.summary, /served by Akamai, but \/k9Pm2Qx7\/ is answered by Amazon CloudFront/);
});

test('gateway response without CDN headers falls back to the site infrastructure, and says so', () => {
  const r = R({ url: 'https://example.com/', cnames: ['example.com.edgekey.net'], html: page(GTM_GTG),
    probes: { '/k9Pm2Qx7/': { healthy: true, servesGoogleJs: true, headers: { 'content-type': 'application/javascript' } } } });
  assert.equal(r.gtg.servedBy, 'Akamai');
  assert.equal(r.gtg.basis, 'site_infrastructure');
  assert.match(r.gtg.summary, /based on the rest of your site/);
});

test('raw probe headers never appear in the report', () => {
  const r = R({ url: 'https://example.com/', html: page(GTM_GTG), probes: { '/k9Pm2Qx7/': { healthy: true, headers: { 'set-cookie': 'secret=1', 'cf-ray': 'x' } } } });
  assert.ok(!JSON.stringify(r).includes('secret=1'));
  assert.deepEqual(Object.keys(r.probes['/k9Pm2Qx7/']).sort(), ['healthBody', 'healthy', 'path', 'servesGoogleJs']);
});

test('no gateway -> no gtg block', () => {
  const r = R({ url: 'https://example.com/', html: page(GTM_STANDARD) });
  assert.equal(r.gtg, null);
  assert.equal(freeSummary(r).gtgServedBy, null);
});

test('GTG path found but health check fails -> implemented, unconfirmed + warning', () => {
  const r = R({ url: 'https://example.com/', html: page(GTM_GTG), probes: { '/k9Pm2Qx7/': { healthy: false, servesGoogleJs: false } } });
  assert.equal(r.verdict.confidence, 'unconfirmed');
  assert.ok(r.warnings.some((w) => w.code === 'unverified'));
});

test('Standard GTM on CloudFront + WordPress + hardcoded AW -> not implemented', () => {
  const html = page(GTM_STANDARD + `<link href="/wp-content/themes/x.css"><script async src="https://www.googletagmanager.com/gtag/js?id=AW-123456789"></script><script>gtag('config','AW-123456789');</script>`);
  const r = R({ url: 'https://brand.co.uk/', headers: { 'x-amz-cf-id': 'abc', 'x-amz-cf-pop': 'LHR50-C1' }, html });
  assert.equal(r.verdict.status, 'not_implemented');
  assert.equal(r.infra.primary, 'Amazon CloudFront');
  assert.equal(r.platform.name, 'WordPress');
  assert.deepEqual(r.tags.hardcoded, ['AW-123456789']);
  assert.equal(r.route.key, 'cloudfront');
});

test('GTM through GTG but gtag AW still from Google -> partial', () => {
  const html = page(GTM_GTG + `<script async src="https://www.googletagmanager.com/gtag/js?id=AW-987654321"></script>`);
  const r = R({ url: 'https://example.com/', html, probes: { '/k9Pm2Qx7/': { healthy: true } } });
  assert.equal(r.verdict.status, 'partial');
  assert.ok(r.gtg);
});

test('gtag.js served from a first-party path -> implemented', () => {
  const r = R({ url: 'https://www.example.com/', html: page(`<script async src="/metrics/?id=G-ABCDEF1234"></script>`), probes: { '/metrics/': { healthy: true } } });
  assert.equal(r.verdict.status, 'implemented');
  assert.deepEqual(r.verdict.gtgPaths, ['/metrics/']);
});

test('Server-side GTM custom subdomain is not counted as GTG', () => {
  const html = page(GTM_STANDARD.replace("'https://www.googletagmanager.com/gtm.js?id='", "'https://sst.example.com/gtm.js?id='"));
  const r = R({ url: 'https://www.example.com/', html });
  assert.equal(r.verdict.servingMode, 'server_side_tagging');
});

test('No tags, Nginx origin, CloudFront only on assets subdomain -> asset-only CDN, Nginx route', () => {
  const r = R({ url: 'https://www.example.com/', headers: { server: 'nginx/1.24.0' }, html: page('<img src="https://media.example.com/a.png">'),
    assetHosts: [{ host: 'media.example.com', cnames: ['d111.cloudfront.net'] }] });
  assert.equal(r.verdict.status, 'no_google_tags');
  assert.equal(r.infra.proxyType, 'asset_only_cdn');
  assert.equal(r.route.key, 'nginx');
});

test('Cloudflare challenge page -> blocked', () => {
  const r = R({ url: 'https://example.com/', status: 403, headers: { 'cf-ray': 'x', 'cf-mitigated': 'challenge' }, html: '<title>Just a moment...</title>' });
  assert.equal(r.verdict.status, 'blocked');
});

test('Shopify store -> hosted platform, limited', () => {
  const r = R({ url: 'https://store.example.com/', headers: { 'cf-ray': 'x', 'x-shopid': '123' }, html: page(GTM_STANDARD) });
  assert.equal(r.route.key, 'hosted_platform');
  assert.equal(r.route.eligible, 'limited');
});

test('free summary does not leak paths, IDs or setup route', () => {
  const r = R({ url: 'https://example.com/', html: page(GTM_GTG), probes: { '/k9Pm2Qx7/': { healthy: true, headers: { 'cf-ray': 'x' } } } });
  const s = JSON.stringify(freeSummary(r));
  assert.ok(!s.includes('k9Pm2Qx7'));
  assert.ok(!s.includes('GTM-ABC1234'));
  assert.ok(!s.includes('note'));
  assert.equal(freeSummary(r).gtgServedBy, 'Cloudflare');
});

test('registrable domain handles multi-part suffixes', () => {
  assert.equal(registrableDomain('www.brand.co.uk'), 'brand.co.uk');
  assert.equal(registrableDomain('a.b.brand.co.in'), 'brand.co.in');
});



test('lead grading', () => {
  const report = { host: 'www.brand.com', verdict: { status: 'not_implemented' }, route: { eligible: 'yes' } };
  assert.equal(gradeLead(validateLead({ email: 'cmo@brand.com', name: 'A', consent: true }), report).grade, 'A');
  assert.equal(gradeLead(validateLead({ email: 'me@agency.io', name: 'A', consent: true }), report).grade, 'B');
  assert.equal(gradeLead(validateLead({ email: 'me@gmail.com', name: 'A', consent: true }), report).grade, 'C');
  assert.throws(() => validateLead({ email: 'x@y.com', name: 'A', consent: false }));
});
