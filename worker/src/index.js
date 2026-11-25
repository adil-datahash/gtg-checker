// Cloudflare Worker: the scanner API behind the GitHub Pages site.
//   POST /api/scan  -> free summary only
//   POST /api/lead  -> validates + grades the lead, forwards it (dry run by default), returns the full report
//   GET  /api/health -> "ok" (for uptime checks)
// Settings are Worker variables (wrangler.toml [vars]); secrets are set in Cloudflare, never in the repo.
import { buildReport, freeSummary, normalizeProbe } from '../../engine/detect.js';
import { validateLead, gradeLead, buildLeadPayload, LeadError } from '../../engine/lead.js';
import { normalizeInputUrl, guardedFetch, probeGtgPath, assetSubdomains, makeDeps, ScanError } from './net.js';
import { browserTagRequests } from './browser.js';

const CONSENT_VERSION = 'gtg-consent-v1';
const flag = (v, dflt) => (v === undefined || v === '' ? dflt : String(v).toLowerCase() === 'true');
const num = (v, dflt) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : dflt);

export function getConfig(env = {}) {
  return {
    scannerEnabled: flag(env.SCANNER_ENABLED, true),
    leadsEnabled: flag(env.LEADS_ENABLED, true),
    leadsDryRun: flag(env.LEADS_DRY_RUN, true),
    zohoFlowWebhookUrl: env.ZOHO_FLOW_WEBHOOK_URL || '',
    dryRunWebhookUrl: env.DRY_RUN_WEBHOOK_URL || '',
    turnstileSecret: env.TURNSTILE_SECRET || '',
    allowedOrigins: String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean),
    scanRatePerMinute: num(env.SCAN_RATE_PER_MINUTE, 10),
    leadRatePerMinute: num(env.LEAD_RATE_PER_MINUTE, 5),
    cacheTtlSeconds: num(env.SCAN_CACHE_TTL_SECONDS, 60 * 60 * 24)
  };
}

// ---------- scan ----------

// The plain HTML cannot settle these, so they get the browser check (when configured): no tags seen,
// a tag added by a script, a site that blocked our server, or tags run by a tag manager other than GTM
// (Tealium, Adobe Launch...), which add the Google tag after load and often only after consent.
function needsBrowser(report) {
  const v = report.verdict;
  if (v.status === 'no_google_tags' || v.status === 'blocked') return true;
  if (v.status === 'unconfirmed' && v.servingMode === 'not_in_static_html') return true;
  const otherManager = (report.tagManagers || []).some((t) => t !== 'Google Tag Manager');
  return otherManager && !(v.status === 'implemented' && v.confidence === 'verified');
}

// visitorProbe: a result the visitor's own browser produced (already checked by normalizeProbe).
export async function runScan(rawUrl, deps, visitorProbe = null) {
  const input = normalizeInputUrl(rawUrl);
  let page;
  try {
    page = await guardedFetch(input, { deps });
  } catch (e) {
    // The server could not reach the site at all, but the visitor's browser did: use what it saw.
    if (!visitorProbe || !(e instanceof ScanError) || !['timeout', 'fetch_failed'].includes(e.code)) throw e;
    page = { url: input, status: 0, headers: {}, body: '', cnames: [], ips: [] };
  }
  const finalUrl = page.url.href;
  const html = page.body;
  const scannedAt = new Date().toISOString();

  // Asset subdomains and the owner network of the site's address, in parallel.
  const [assetHosts, network] = await Promise.all([
    Promise.all(assetSubdomains(html, page.url.hostname).map(async (h) => {
      try { return { host: h, cnames: (await deps.resolveHost(h)).cnames }; } catch { return null; }
    })).then((a) => a.filter(Boolean)),
    deps.lookupNetwork ? deps.lookupNetwork((page.ips || [])[0]) : null
  ]);

  const base = { inputUrl: input.href, finalUrl, status: page.status, headers: page.headers, html, cnames: page.cnames, assetHosts, scannedAt, network };

  // 1. Plain HTML (plus the visitor's browser result, when one was sent).
  let browser = visitorProbe ? null : { ran: false, error: 'browser_not_run', tagRequests: [] };
  let draft = buildReport({ ...base, probes: {}, browser, pageProbe: visitorProbe });

  // 2. If that cannot settle it, load the page in Cloudflare's browser with the in-page probe.
  if (!visitorProbe && needsBrowser(draft) && deps.browserScan) {
    browser = await deps.browserScan(finalUrl).catch(() => ({ ran: false, error: 'browser_failed', tagRequests: [] }));
    if (browser.probe) browser.probe = normalizeProbe(browser.probe, page.url.hostname, 'browser_run');
    draft = buildReport({ ...base, probes: {}, browser });
  }

  // 3. Every first-party path found gets the server's own health check too (max 3). Paths a browser
  // already confirmed from inside the page are skipped: the server is often blocked there.
  const inPage = (visitorProbe || (browser && browser.probe) || { checks: [] }).checks;
  const toProbe = draft.tags.loaders
    .filter((l) => l.serving === 'first_party_path' && !inPage.some((c) => c.path === l.path && c.healthy))
    .slice(0, 3);
  const probes = {};
  await Promise.all(toProbe.map(async (l) => { probes[l.path] = await probeGtgPath(page.url.origin, l.path, l.id, deps); }));
  return buildReport({ ...base, probes, browser, pageProbe: visitorProbe });
}

// ---------- cache + rate limit (per Worker instance; KV / rate-limit bindings used when configured) ----------

const memCache = new Map();
const memHits = new Map();

async function cacheGet(env, key) {
  const m = memCache.get(key);
  if (m && m.expires > Date.now()) return m.value;
  if (env.SCAN_CACHE) {
    const v = await env.SCAN_CACHE.get(key, 'json').catch(() => null);
    if (v) return v;
  }
  return null;
}
async function cacheSet(env, key, value, ttl) {
  if (memCache.size > 2000) memCache.delete(memCache.keys().next().value);
  memCache.set(key, { value, expires: Date.now() + ttl * 1000 });
  if (env.SCAN_CACHE) await env.SCAN_CACHE.put(key, JSON.stringify(value), { expirationTtl: ttl }).catch(() => {});
}
async function rateLimited(env, key, perMinute) {
  if (env.RATE_LIMITER) {
    try { const { success } = await env.RATE_LIMITER.limit({ key }); return !success; } catch {}
  }
  const now = Date.now();
  const recent = (memHits.get(key) || []).filter((t) => now - t < 60_000);
  recent.push(now);
  memHits.set(key, recent);
  if (memHits.size > 5000) memHits.delete(memHits.keys().next().value);
  return recent.length > perMinute;
}

async function verifyTurnstile(cfg, token, ip, fetchImpl) {
  if (!cfg.turnstileSecret) return true; // not configured
  if (!token) return false;
  const form = new FormData();
  form.append('secret', cfg.turnstileSecret);
  form.append('response', token);
  if (ip && ip !== 'unknown') form.append('remoteip', ip);
  try {
    const res = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
    return (await res.json()).success === true;
  } catch { return false; }
}

// A result from the visitor's browser, checked and trimmed. Throws for anything unusable.
function visitorProbeFor(body) {
  if (!body.probe) return null;
  const host = normalizeInputUrl(body.url).hostname;
  if (JSON.stringify(body.probe).length > 40_000) throw new ScanError('bad_probe', 'The browser check result is too large.');
  const p = normalizeProbe(body.probe, host, 'visitor_browser');
  if (!p) throw new ScanError('bad_probe', 'The browser check was run on a different site. Run it on the site you entered.');
  return p;
}

async function getReport(env, cfg, url, deps, visitorProbe = null) {
  // Visitor-supplied results are never cached: they must not change what anyone else sees.
  if (visitorProbe) return { report: await runScan(url, deps, visitorProbe), cached: false };
  const host = normalizeInputUrl(url).hostname;
  const key = `scan:${host}`;
  const hit = await cacheGet(env, key);
  if (hit) return { report: hit, cached: true };
  const report = await runScan(url, deps);
  await cacheSet(env, key, report, cfg.cacheTtlSeconds);
  return { report, cached: false };
}

function scanError(e) {
  if (e instanceof ScanError) {
    const status = e.code === 'timeout' ? 504 : e.code === 'fetch_failed' ? 502 : 422;
    return [status, { error: e.code, message: e.message }];
  }
  return [500, { error: 'server_error', message: 'Something went wrong on our side. Try again in a minute.' }];
}

export async function handleScan(body, { env, cfg, ip, deps, fetchImpl }) {
  if (!cfg.scannerEnabled) return [503, { error: 'paused', message: 'The checker is paused for maintenance. Try again later.' }];
  let host;
  try { host = normalizeInputUrl(body.url).hostname; } catch (e) { return scanError(e); }
  if (!(await verifyTurnstile(cfg, body.turnstileToken, ip, fetchImpl))) return [403, { error: 'bot_check', message: 'Complete the human check and try again.' }];
  let visitorProbe;
  try { visitorProbe = visitorProbeFor(body); } catch (e) { return scanError(e); }
  // Cached results cost nothing, so only real scans count against the limit.
  const hit = visitorProbe ? null : await cacheGet(env, `scan:${host}`);
  if (hit) return [200, { summary: freeSummary(hit), cached: true }];
  if (await rateLimited(env, `scan:${ip}`, cfg.scanRatePerMinute)) return [429, { error: 'rate_limited', message: 'Too many checks from your network. Wait a minute and try again.' }];
  try {
    const { report, cached } = await getReport(env, cfg, body.url, deps, visitorProbe);
    return [200, { summary: freeSummary(report), cached }];
  } catch (e) { return scanError(e); }
}

async function storeLead(cfg, payload, fetchImpl) {
  if (!cfg.leadsDryRun) {
    if (!cfg.zohoFlowWebhookUrl) throw new LeadError('not_configured', 'Lead capture is not set up yet. Try again later.');
    const res = await fetchImpl(cfg.zohoFlowWebhookUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(8000) }).catch(() => null);
    if (!res || !res.ok) throw new LeadError('forward_failed', 'We could not save your details. Try again in a minute.');
    return { delivered: true, dryRun: false };
  }
  // Dry run: nothing reaches the CRM. Optional internal test webhook only.
  if (cfg.dryRunWebhookUrl) {
    await fetchImpl(cfg.dryRunWebhookUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ dry_run: true, ...payload }) }).catch(() => {});
  }
  return { delivered: false, dryRun: true };
}

export async function handleLead(body, { env, cfg, ip, deps, fetchImpl, page }) {
  if (!cfg.leadsEnabled) return [503, { error: 'paused', message: 'Reports are paused right now. Try again later.' }];
  if (await rateLimited(env, `lead:${ip}`, cfg.leadRatePerMinute)) return [429, { error: 'rate_limited', message: 'Too many requests. Wait a minute and try again.' }];
  try {
    const lead = validateLead(body);
    const { report } = await getReport(env, cfg, body.url, deps, visitorProbeFor(body));
    const grading = gradeLead(lead, report);
    const payload = buildLeadPayload(lead, grading, report, { consentVersion: CONSENT_VERSION, page: String(body.page || page || '').slice(0, 300) });
    const stored = await storeLead(cfg, payload, fetchImpl);
    return [200, { report, ...stored }];
  } catch (e) {
    if (e instanceof LeadError) return [e.code === 'not_configured' || e.code === 'forward_failed' ? 503 : 400, { error: e.code, message: e.message }];
    return scanError(e);
  }
}

// ---------- HTTP ----------

function corsHeaders(origin, cfg) {
  if (origin && cfg.allowedOrigins.includes(origin)) {
    return { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400', vary: 'origin' };
  }
  return { vary: 'origin' };
}

const json = (status, data, cors) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...cors }
});

export function makeHandler({ fetchImpl = (...a) => fetch(...a) } = {}) {
  return async function handle(request, env = {}) {
    const cfg = getConfig(env);
    const url = new URL(request.url);
    const origin = request.headers.get('origin');
    const cors = corsHeaders(origin, cfg);
    if (url.pathname.endsWith('/api/health') && request.method === 'GET') return new Response('ok', { headers: { 'content-type': 'text/plain' } });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' }, cors);
    // Browsers always send Origin on cross-site POSTs: only the listed sites may call the API.
    if (origin && !cfg.allowedOrigins.includes(origin)) return json(403, { error: 'forbidden', message: 'Requests from this site are not allowed.' }, cors);
    if (Number(request.headers.get('content-length') || 0) > 60_000) return json(413, { error: 'too_large' }, cors);
    const body = await request.json().catch(() => ({}));
    const ip = request.headers.get('cf-connecting-ip') || 'unknown';
    const deps = { ...makeDeps(fetchImpl), browserScan: (u) => browserTagRequests(u, env, fetchImpl) };
    const ctx = { env, cfg, ip, deps, fetchImpl, page: request.headers.get('referer') || '' };
    let result;
    if (url.pathname.endsWith('/api/scan')) result = await handleScan(body || {}, ctx);
    else if (url.pathname.endsWith('/api/lead')) result = await handleLead(body || {}, ctx);
    else result = [404, { error: 'not_found' }];
    return json(result[0], result[1], cors);
  };
}

export default { fetch: makeHandler() };
