// Network layer for the Cloudflare Worker. Every outbound request to a scanned site goes through guardedFetch.
// DNS is read through DNS-over-HTTPS (Cloudflare 1.1.1.1), so results match what the public sees, and any
// host that resolves to a private, loopback, link-local or cloud-metadata address is refused.
import { registrableDomain } from '../../engine/detect.js';

const UA = 'DatahashGTGChecker/2.1 (+https://datahash.com/tools/gtg-checker)';
// Cloudflare's free plan allows about 10 ms of CPU per request. The detection takes ~1.3 ms per 100 KB and a
// scan runs it twice, so only the first 400 KB of a page is read. The Google tag snippet sits in <head>, at the top.
const MAX_HTML_BYTES = 400_000;
const MAX_REDIRECTS = 5;

export class ScanError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export function normalizeInputUrl(raw) {
  let s = String(raw || '').trim();
  if (!s) throw new ScanError('invalid_url', 'Enter a website address.');
  if (s.length > 2048) throw new ScanError('invalid_url', 'That address is too long.');
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  let u;
  try { u = new URL(s); } catch { throw new ScanError('invalid_url', 'That does not look like a website address.'); }
  if (!['http:', 'https:'].includes(u.protocol)) throw new ScanError('invalid_url', 'Only http and https addresses can be checked.');
  if (u.username || u.password) throw new ScanError('invalid_url', 'Addresses with login details cannot be checked.');
  if (u.port && !['80', '443'].includes(u.port)) throw new ScanError('invalid_url', 'Only standard web ports can be checked.');
  if (/^[\d.]+$/.test(u.hostname) || u.hostname.includes(':') || u.hostname.startsWith('[')) {
    throw new ScanError('invalid_url', 'Enter a public domain name, not an IP address.');
  }
  if (!u.hostname.includes('.')) throw new ScanError('invalid_url', 'Enter a full domain, like yourbrand.com.');
  if (/\.(local|localhost|internal|lan|home|corp|test|invalid|onion|arpa)$/i.test(u.hostname)) {
    throw new ScanError('invalid_url', 'Only public websites can be checked.');
  }
  u.hash = '';
  return u;
}

export function isPrivateIp(ip) {
  const s = String(ip).toLowerCase();
  if (s.includes(':')) {
    if (s.startsWith('::ffff:')) return isPrivateIp(s.slice(7));
    return s === '::1' || s === '::' || s.startsWith('fc') || s.startsWith('fd') || s.startsWith('fe8') ||
      s.startsWith('fe9') || s.startsWith('fea') || s.startsWith('feb') || s.startsWith('64:ff9b') || s.startsWith('2001:db8');
  }
  const p = s.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) || a >= 224;
}

async function doh(name, type, fetchImpl) {
  const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`;
  const res = await fetchImpl(url, { headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(4000) });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.Answer || []).map((a) => ({ type: a.type, data: String(a.data) }));
}

// Resolves a host through public DNS, refuses private addresses, and returns its CNAME chain.
export async function resolveHost(host, fetchImpl = fetch) {
  let records;
  try {
    const [a, aaaa] = await Promise.all([doh(host, 'A', fetchImpl), doh(host, 'AAAA', fetchImpl)]);
    records = [...a, ...aaaa];
  } catch { throw new ScanError('dns_failed', `We could not look up ${host}. Try again in a minute.`); }
  const ips = records.filter((r) => r.type === 1 || r.type === 28).map((r) => r.data);
  const cnames = [...new Set(records.filter((r) => r.type === 5).map((r) => r.data.replace(/\.$/, '')))];
  if (!ips.length) throw new ScanError('dns_failed', `We could not find ${host} in DNS. Check the address.`);
  if (ips.some(isPrivateIp)) throw new ScanError('blocked_target', 'That address points to a private network and cannot be checked.');
  return { ips, cnames };
}

export function makeDeps(fetchImpl = fetch) {
  return { fetch: fetchImpl, resolveHost: (h) => resolveHost(h, fetchImpl) };
}

async function readCapped(res, maxBytes) {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    chunks.push(value);
    if (total >= maxBytes) { try { await reader.cancel(); } catch {} break; }
  }
  const buf = new Uint8Array(Math.min(total, maxBytes));
  let off = 0;
  for (const c of chunks) {
    const take = Math.min(c.byteLength, buf.length - off);
    buf.set(c.subarray(0, take), off);
    off += take;
    if (off >= buf.length) break;
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(buf);
}

function mapNetworkError(e) {
  if (e instanceof ScanError) return e;
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return new ScanError('timeout', 'The site took too long to answer. Try again, or ask us for a manual check.');
  return new ScanError('fetch_failed', 'We could not reach that site. Check the address, or ask us for a manual check.');
}

// GET with manual redirects; every hop is re-validated and re-resolved.
export async function guardedFetch(startUrl, { deps, maxBytes = MAX_HTML_BYTES, timeoutMs = 10000 }) {
  let url = startUrl;
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const checked = normalizeInputUrl(url.href || url);
    const dnsInfo = await deps.resolveHost(checked.hostname);
    let res;
    try {
      res = await deps.fetch(checked.href, {
        method: 'GET',
        redirect: 'manual',
        headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,*/*;q=0.8', 'accept-language': 'en' },
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (e) { throw mapNetworkError(e); }
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get('location');
      if (!loc) throw new ScanError('fetch_failed', 'The site sent a redirect with no destination.');
      url = new URL(loc, checked);
      continue;
    }
    let body;
    try { body = await readCapped(res, maxBytes); } catch (e) { throw mapNetworkError(e); }
    return { url: checked, status: res.status, headers: res.headers, body, cnames: dnsInfo.cnames };
  }
  throw new ScanError('fetch_failed', 'The site redirected too many times.');
}

function headersToObject(h) {
  const out = {};
  for (const [k, v] of h.entries()) out[k.toLowerCase()] = v;
  if (typeof h.getSetCookie === 'function') {
    const c = h.getSetCookie();
    if (c.length) out['set-cookie'] = c.join('; ');
  }
  return out;
}

// Checks one first-party measurement path: /<path>/healthy and the loader script.
// Keeps the loader's response headers so the engine can tell which layer serves the gateway.
export async function probeGtgPath(origin, path, id, deps) {
  const out = { path, healthy: null, healthBody: null, servesGoogleJs: null, headers: null };
  try {
    const r = await guardedFetch(new URL(`${path}healthy`, origin), { deps, maxBytes: 2048, timeoutMs: 5000 });
    out.healthBody = r.body.trim().slice(0, 40);
    out.healthy = r.status === 200 && out.healthBody === 'ok';
    out.headers = headersToObject(r.headers);
  } catch { out.healthy = false; }
  if (id) {
    try {
      const r = await guardedFetch(new URL(`${path}?id=${encodeURIComponent(id)}`, origin), { deps, maxBytes: 60000, timeoutMs: 6000 });
      out.servesGoogleJs = r.status === 200 && /google_tag_manager|google_tag_data|gtag/.test(r.body);
      out.headers = headersToObject(r.headers);
    } catch { out.servesGoogleJs = false; }
  }
  return out;
}

export function assetSubdomains(html, pageHost) {
  const base = registrableDomain(pageHost);
  const hosts = new Set();
  const re = /(?:src|href)\s*=\s*["']https?:\/\/([a-z0-9.-]+)\//gi;
  let m;
  while ((m = re.exec(html))) {
    const h = m[1].toLowerCase();
    if (h !== pageHost && registrableDomain(h) === base) hosts.add(h);
    if (hosts.size >= 3) break;
  }
  return [...hosts];
}
