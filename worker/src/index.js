// Cloudflare Worker: the scanner API behind the GitHub Pages site.
//   POST /api/scan  -> free summary only
//   POST /api/lead  -> validates + grades the lead, forwards it (dry run by default), returns the full report
//   GET  /api/health -> "ok" (for uptime checks)
// Settings are Worker variables (wrangler.toml [vars]); secrets are set in Cloudflare, never in the repo.
import { buildReport, freeSummary } from '../../engine/detect.js';
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

// The plain HTML cannot settle these, so they get the browser check (when configured).
function needsBrowser(report) {
  const v = report.verdict;
  return v.status === 'no_google_tags' || (v.status === 'unconfirmed' && v.servingMode === 'not_in_static_html');
}

export async function runScan(rawUrl, deps) {
  const input = normalizeInputUrl(rawUrl);
  const page = await guardedFetch(input, { deps });
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

  // 1. Plain HTML.
  let browser = { ran: false, error: 'browser_not_run', tagRequests: [] };
  let draft = buildReport({ ...base, probes: {}, browser });

  // 2. If that cannot settle it, ask a real browser for the rendered page.
  if (needsBrowser(draft) && deps.browserScan) {
    browser = await deps.browserScan(finalUrl).catch(() => ({ ran: false, error: 'browser_failed', tagRequests: [] }));
    draft = buildReport({ ...base, probes: {}, browser });
  }

  // 3. Every first-party path found either way gets the health check (max 3).
  const toProbe = draft.tags.loaders.filter((l) => l.serving === 'first_party_path').slice(0, 3);
  const probes = {};
  await Promise.all(toProbe.map(async (l) => { probes[l.path] = await probeGtgPath(page.url.origin, l.path, l.id, deps); }));
  return buildReport({ ...base, probes, browser });
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

async function getReport(env, cfg, url, deps) {
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
  // Cached results cost nothing, so only real scans count against the limit.
  const hit = await cacheGet(env, `scan:${host}`);
  if (hit) return [200, { summary: freeSummary(hit), cached: true }];
  if (await rateLimited(env, `scan:${ip}`, cfg.scanRatePerMinute)) return [429, { error: 'rate_limited', message: 'Too many checks from your network. Wait a minute and try again.' }];
  try {
    const { report, cached } = await getReport(env, cfg, body.url, deps);
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
    const { report } = await getReport(env, cfg, body.url, deps);
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
    if (Number(request.headers.get('content-length') || 0) > 20_000) return json(413, { error: 'too_large' }, cors);
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
