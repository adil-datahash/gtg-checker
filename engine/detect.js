// GTG detection engine. Pure functions only: no network, no globals.
// Rules are written from Google's public Google tag gateway documentation and
// public CDN response-header conventions. Keep this file server-side only.
import { PROVIDERS, KIND_ORDER, KIND_LABEL } from './providers.js';
import { classifyNetwork } from './networks.js';

const MULTI_PART_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'org.au', 'co.in', 'net.in', 'org.in',
  'firm.in', 'gen.in', 'com.sa', 'net.sa', 'co.za', 'com.br', 'co.jp', 'com.sg', 'com.my', 'co.nz',
  'com.tr', 'com.eg', 'com.qa', 'com.kw', 'com.bh', 'com.om', 'co.ae', 'com.mx', 'com.ar', 'co.id',
  'com.hk', 'com.pk', 'com.ng', 'co.ke', 'com.ph', 'com.vn', 'co.th', 'co.kr', 'com.cn'
]);

export function registrableDomain(host) {
  const h = String(host || '').toLowerCase().replace(/\.$/, '');
  const parts = h.split('.');
  if (parts.length <= 2) return h;
  const lastTwo = parts.slice(-2).join('.');
  if (MULTI_PART_SUFFIXES.has(lastTwo)) return parts.slice(-3).join('.');
  return lastTwo;
}

const GOOGLE_TAG_HOSTS = ['www.googletagmanager.com', 'googletagmanager.com'];
const ID_RE = /\b(GTM-[A-Z0-9]{4,10}|G-[A-Z0-9]{6,12}|AW-\d{6,12}|DC-\d{6,12}|GT-[A-Z0-9]{6,12})\b/g;

function idKind(id) {
  if (id.startsWith('GTM-')) return 'gtm';
  if (id.startsWith('G-')) return 'ga4';
  if (id.startsWith('AW-')) return 'ads';
  if (id.startsWith('DC-')) return 'floodlight';
  return 'google_tag';
}

function uniq(arr) { return [...new Set(arr)]; }

function safeUrl(raw, base) {
  try { return new URL(raw.replace(/&amp;/g, '&'), base); } catch { return null; }
}

// The directory a first-party loader lives under: "/abc123/gtm.js" -> "/abc123/", "/abc123/" -> "/abc123/".
function loaderDir(pathname) {
  let p = pathname.replace(/\/gtag\/js$/, '/').replace(/\/gtm\.js$/, '/');
  if (!p.endsWith('/')) p = p.slice(0, p.lastIndexOf('/') + 1);
  return p || '/';
}

// Classify one loader URL (from a script src or from a GTM snippet string).
export function classifyLoader(rawUrl, pageUrl, idHint) {
  const u = safeUrl(rawUrl, pageUrl);
  if (!u) return null;
  const page = new URL(pageUrl);
  const id = (u.searchParams.get('id') || idHint || '').toUpperCase();
  const host = u.hostname.toLowerCase();
  const looksGoogleLoader = /\/gtm\.js$|\/gtag\/js$/.test(u.pathname);

  if (GOOGLE_TAG_HOSTS.includes(host)) {
    if (u.pathname.endsWith('/ns.html')) return null; // noscript iframe, not a loader
    return { url: u.href, id, kind: id ? idKind(id) : 'unknown', serving: 'google', host, path: null };
  }
  if (!id || !/^(GTM-|G-|AW-|DC-|GT-)/.test(id)) return null; // not a Google tag loader
  const sameHost = host === page.hostname.toLowerCase();
  const sameSite = registrableDomain(host) === registrableDomain(page.hostname);
  if (sameHost) {
    const path = loaderDir(u.pathname);
    if (path === '/') return { url: u.href, id, kind: idKind(id), serving: 'first_party_root', host, path };
    return { url: u.href, id, kind: idKind(id), serving: 'first_party_path', host, path };
  }
  if (sameSite || looksGoogleLoader) {
    // Tag loaded from a subdomain or another host: typical of server-side GTM custom domains.
    return { url: u.href, id, kind: idKind(id), serving: sameSite ? 'first_party_subdomain' : 'third_party_proxy', host, path: loaderDir(u.pathname) };
  }
  return null;
}

export function extractTags(html, pageUrl, browserRequests = []) {
  const text = String(html || '');
  const loaders = [];

  // 0. Tag requests a real browser made while loading the page (scripts that add GTM after load).
  for (const raw of browserRequests) {
    const l = classifyLoader(raw, pageUrl);
    if (l) loaders.push({ ...l, source: 'browser_network' });
  }

  // 1. <script src="...">
  const srcRe = /<script\b[^>]*\bsrc\s*=\s*(["'])([^"']+)\1/gi;
  let m;
  while ((m = srcRe.exec(text))) {
    const l = classifyLoader(m[2], pageUrl);
    if (l) loaders.push({ ...l, source: 'script_src' });
  }

  // 2. GTM / gtag snippet strings: j.src='<prefix>?id='+i+dl  ...  ('dataLayer','GTM-XXXX')
  const snippetRe = /\.src\s*=\s*(["'])([^"']*?\?id=)\1/g;
  while ((m = snippetRe.exec(text))) {
    const windowText = text.slice(m.index, m.index + 600);
    const idMatch = windowText.match(/['"](GTM-[A-Z0-9]{4,10}|G-[A-Z0-9]{6,12})['"]\s*\)/);
    const l = classifyLoader(m[2], pageUrl, idMatch ? idMatch[1] : '');
    if (l) loaders.push({ ...l, source: 'inline_snippet' });
  }

  // 3. IDs anywhere in the page and gtag('config', ...) calls.
  const allIds = uniq([...(text.match(ID_RE) || []), ...loaders.map((l) => l.id).filter(Boolean)].map((s) => s.toUpperCase()));
  const configIds = [];
  const cfgRe = /gtag\(\s*['"]config['"]\s*,\s*['"]([A-Z]{1,3}-[A-Z0-9-]+)['"]/gi;
  while ((m = cfgRe.exec(text))) configIds.push(m[1].toUpperCase());

  // Deduplicate loaders by id + serving + path.
  const seen = new Set();
  const dedup = loaders.filter((l) => {
    const k = `${l.id}|${l.serving}|${l.path}|${l.host}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const ids = { gtm: [], ga4: [], ads: [], floodlight: [], google_tag: [] };
  for (const id of allIds) ids[idKind(id)].push(id);

  // Hardcoded = a gtag.js loader or gtag('config') for G-/AW- IDs outside GTM.
  const hardcoded = uniq([
    ...dedup.filter((l) => l.kind !== 'gtm').map((l) => l.id),
    ...configIds.filter((id) => !id.startsWith('GTM-'))
  ]).filter(Boolean);

  return { loaders: dedup, ids, configIds: uniq(configIds), hardcoded };
}

// ---------- Infrastructure fingerprinting ----------

const HOSTED_PLATFORMS = [
  { name: 'Shopify', test: (h, html) => h['x-shopid'] || h['x-shopify-stage'] || /cdn\.shopify\.com/i.test(html) },
  { name: 'Webflow', test: (h, html) => /data-wf-site|webflow\.com\/css|website-files\.com/i.test(html) },
  { name: 'Wix', test: (h, html) => h['x-wix-request-id'] || /static\.wixstatic\.com/i.test(html) },
  { name: 'Squarespace', test: (h, html) => /squarespace/i.test(h.server || '') || /static1\.squarespace\.com/i.test(html) },
  { name: 'HubSpot CMS', test: (h, html) => h['x-hs-hub-id'] || /hs-sites\.com|hubspot-cms/i.test(html) },
  { name: 'BigCommerce', test: (h, html) => h['x-bc-storefront'] || /cdn\d+\.bigcommerce\.com/i.test(html) },
  { name: 'Framer', test: (h, html) => /framerusercontent\.com|data-framer-/i.test(html) },
  { name: 'Ghost(Pro)', test: (h, html) => h['ghost-fastly'] || /ghost\.io\/|content="Ghost \d/i.test(html) },
  { name: 'Duda', test: (h, html) => /dudaone|irp\.cdn-website\.com/i.test(html) },
  { name: 'Weebly / Square Online', test: (h, html) => /weebly\.com|editmysite\.com/i.test(html) },
  { name: 'Zoho Sites', test: (h, html) => /zohositescontent|sites\.zoho/i.test(html) }
];

const SELF_MANAGED_PLATFORMS = [
  { name: 'WordPress', test: (h, html) => /\/wp-content\/|\/wp-includes\//i.test(html) },
  { name: 'Drupal', test: (h, html) => h['x-drupal-cache'] || h['x-generator']?.includes('Drupal') || /\/sites\/default\/files\/|Drupal\.settings|drupal-settings-json/i.test(html) },
  { name: 'Magento / Adobe Commerce', test: (h, html) => /Magento_|mage\/cookies|static\/version\d+/i.test(html) },
  { name: 'Next.js', test: (h, html) => /__NEXT_DATA__|\/_next\/static\//i.test(html) || /next\.js/i.test(h['x-powered-by'] || '') },
  { name: 'Nuxt', test: (h, html) => /__NUXT__|\/_nuxt\//i.test(html) },
  { name: 'Gatsby', test: (h, html) => /___gatsby/i.test(html) },
  { name: 'Salesforce Commerce Cloud', test: (h, html) => /demandware/i.test(html) },
  { name: 'Adobe Experience Manager', test: (h, html) => /\/etc\.clientlibs\/|\/content\/dam\//i.test(html) },
  { name: 'Sitecore', test: (h, html) => /\/-\/media\/|sitecore/i.test(html) },
  { name: 'Joomla', test: (h, html) => /\/media\/jui\/|content="Joomla/i.test(html) },
  { name: 'PrestaShop', test: (h, html) => /prestashop/i.test(html) },
  { name: 'OpenCart', test: (h, html) => /catalog\/view\/theme/i.test(html) }
];

export function normalizeHeaders(headers) {
  const out = {};
  if (!headers) return out;
  const entries = typeof headers.entries === 'function' ? headers.entries() : Object.entries(headers);
  for (const [k, v] of entries) out[String(k).toLowerCase()] = String(v);
  return out;
}

const clean = (c) => String(c).toLowerCase().replace(/\.$/, '');

function matchCnames(cnames) {
  // Returns [{ provider, cname, depth }] where depth is the position in the CNAME chain (0 = outermost).
  const hits = [];
  cnames.map(clean).forEach((c, depth) => {
    for (const p of PROVIDERS) if (p.cnames.some((re) => re.test(c))) hits.push({ provider: p, cname: c, depth });
  });
  return hits;
}

export function fingerprintInfra(rawHeaders, cnames = [], assetHosts = [], network = null) {
  const h = normalizeHeaders(rawHeaders);
  const cookies = h['set-cookie'] || '';
  const found = new Map(); // id -> { provider, via: Set, depth }
  const signals = [];
  const add = (p, via, depth = 99) => {
    const cur = found.get(p.id) || { provider: p, via: new Set(), depth };
    cur.via.add(via);
    cur.depth = Math.min(cur.depth, depth);
    found.set(p.id, cur);
  };

  for (const p of PROVIDERS) {
    let ok = false;
    try { ok = Boolean(p.test(h, cookies)); } catch { ok = false; }
    if (ok) { add(p, 'header'); signals.push({ check: 'Response header', value: headerEvidence(p, h), points_to: p.name }); }
  }
  for (const hit of matchCnames(cnames)) {
    add(hit.provider, 'dns', hit.depth);
    signals.push({ check: 'DNS CNAME', value: hit.cname, points_to: hit.provider.name });
  }

  // The network that owns the site's address (ASN). Cannot be rewritten by anything in between.
  const net = classifyNetwork(network);
  if (net) {
    const p = net.providerId ? PROVIDERS.find((x) => x.id === net.providerId) : null;
    if (p) add(p, 'network', 50);
    signals.push({ check: 'IP network', value: `AS${net.asn} ${net.org}`, points_to: p ? p.name : null });
  }

  // Order: outermost kind first, then earlier in the CNAME chain, then catalogue order.
  const order = (x) => [KIND_ORDER.indexOf(x.provider.kind), x.depth, PROVIDERS.indexOf(x.provider)];
  const ranked = [...found.values()].sort((a, b) => {
    const A = order(a), B = order(b);
    for (let i = 0; i < A.length; i++) if (A[i] !== B[i]) return A[i] - B[i];
    return 0;
  });

  const edgeLayers = ranked.filter((x) => x.provider.kind !== 'origin');
  const originLayer = ranked.find((x) => x.provider.kind === 'origin');

  const assetCdns = [];
  for (const a of assetHosts) {
    for (const hit of matchCnames(a.cnames || [])) {
      if (['cdn', 'security'].includes(hit.provider.kind)) assetCdns.push({ host: a.host, cdn: hit.provider.name });
    }
  }

  const primary = edgeLayers[0]?.provider || null;
  let proxyType = 'unknown';
  if (primary) proxyType = ['paas', 'managed'].includes(primary.kind) ? 'managed_platform' : 'full_reverse_proxy';
  else if (assetCdns.length) proxyType = 'asset_only_cdn';
  else if (originLayer || net) proxyType = 'origin_direct';

  if (!ranked.length && !net) signals.push({ check: 'Response header', value: 'No CDN or server header exposed', points_to: null });

  return {
    primary: primary ? primary.name : null,
    primaryId: primary ? primary.id : null,
    primaryKind: primary ? primary.kind : null,
    layers: edgeLayers.map((x) => x.provider.name),
    stack: ranked.map((x) => ({ id: x.provider.id, name: x.provider.name, kind: x.provider.kind, kindLabel: KIND_LABEL[x.provider.kind], seenIn: [...x.via] })),
    proxyType,
    server: originLayer ? originLayer.provider.name : null,
    serverId: originLayer ? originLayer.provider.id : null,
    serverHeader: h.server || null,
    network: net ? { asn: net.asn, org: net.org, label: net.label, isEdge: Boolean(net.providerId) } : null,
    assetCdns,
    signals,
    poweredBy: h['x-powered-by'] || null
  };
}

// Shows which header gave a provider away, without echoing long values.
function headerEvidence(p, h) {
  const interesting = ['server', 'via', 'x-cache', 'x-served-by', 'x-powered-by', 'server-timing'];
  for (const k of interesting) {
    if (h[k] && p.test({ [k]: h[k] }, '')) return `${k}: ${h[k].slice(0, 60)}`;
  }
  for (const k of Object.keys(h)) {
    if (['set-cookie', ...interesting].includes(k)) continue;
    try { if (p.test({ [k]: h[k] }, '')) return `${k} header`; } catch {}
  }
  return 'cookie';
}

export function detectPlatform(rawHeaders, html) {
  const h = normalizeHeaders(rawHeaders);
  const text = String(html || '');
  for (const p of HOSTED_PLATFORMS) if (p.test(h, text)) return { name: p.name, hosted: true };
  for (const p of SELF_MANAGED_PLATFORMS) if (p.test(h, text)) return { name: p.name, hosted: false };
  return { name: null, hosted: false };
}

export function detectBlock(status, rawHeaders, html) {
  const h = normalizeHeaders(rawHeaders);
  const t = String(html || '').slice(0, 20000);
  if (h['cf-mitigated'] === 'challenge') return 'Cloudflare bot challenge';
  if ([401, 403, 405, 406, 429, 503].includes(status)) {
    if (/just a moment|cf-chl|challenge-platform|attention required/i.test(t)) return 'Cloudflare bot challenge';
    if (/sucuri website firewall|access denied - sucuri/i.test(t)) return 'Sucuri firewall';
    if (/reference #\d+\.[0-9a-f]+|akamai/i.test(t)) return 'Akamai bot manager';
    if (/incapsula|imperva|_incapsula_resource/i.test(t)) return 'Imperva firewall';
    if (/aws waf|awswaf|request blocked\.[\s\S]{0,200}cloudfront/i.test(t)) return 'AWS WAF';
    if (/azure front door|x-azure-ref/i.test(t)) return 'Azure Front Door WAF';
    if (/fastly error|varnish cache server/i.test(t)) return 'Fastly rule';
    if (/perimeterx|px-captcha|human security/i.test(t)) return 'HUMAN (PerimeterX) bot protection';
    if (/datadome/i.test(t)) return 'DataDome bot protection';
    if (/kasada|ips\.js\?/i.test(t)) return 'Kasada bot protection';
    if (/reblaze|rbzns/i.test(t)) return 'Reblaze firewall';
    if (/ddos-guard/i.test(t)) return 'DDoS-Guard';
    if (/wordfence/i.test(t)) return 'Wordfence firewall';
    if (/mod_security|modsecurity|not acceptable!/i.test(t)) return 'ModSecurity rule';
    return `HTTP ${status}`;
  }
  return null;
}

// ---------- Setup route + eligibility ----------

export function recommendRoute(infra, platform) {
  if (platform?.hosted) {
    return {
      key: 'hosted_platform', label: `${platform.name} (hosted)`, effort: 'Depends',
      note: `${platform.name} runs the servers and CDN for you, so you can only add a tag gateway if you put your own proxy, such as Cloudflare, in front of the store or site.`,
      eligible: 'limited'
    };
  }
  const byId = (id) => PROVIDERS.find((p) => p.id === id);
  // A managed host (Kinsta, WP Engine, Pantheon...) owns the CDN in front of it,
  // so the change goes through the host unless a security proxy sits outside both.
  const managed = (infra.stack || []).find((s) => s.kind === 'managed');
  if (managed && infra.primaryKind !== 'security') {
    const p = byId(managed.id);
    return { key: p.id, ...p.route };
  }
  if (infra.primaryId) {
    const p = byId(infra.primaryId);
    return { key: p.id, ...p.route };
  }
  if ((infra.proxyType === 'asset_only_cdn' || infra.proxyType === 'origin_direct') && infra.serverId) {
    const p = byId(infra.serverId);
    return { key: p.id, ...p.route };
  }
  if (infra.proxyType === 'origin_direct') {
    const where = infra.network && !infra.network.isEdge ? ` Your server is hosted on ${infra.network.label}.` : '';
    return { key: 'web_server', label: 'Your web server', effort: 'Medium', note: `No CDN sits in front of your main domain, so the proxy rule goes on the web server itself.${where}`, eligible: 'yes' };
  }
  if (infra.proxyType === 'asset_only_cdn') {
    return { key: 'web_server', label: 'Your web server', effort: 'Medium', note: 'No CDN sits in front of your main domain, so the proxy rule goes on the web server itself.', eligible: 'yes' };
  }
  return { key: 'unknown', label: 'Not identified', effort: 'Unknown', note: 'We could not identify what sits in front of your site. Most setups are still possible once we know.', eligible: 'conditional' };
}

// ---------- Final verdict ----------

export function decide({ tags, probes = {}, blocked, browser = null }) {
  if (blocked) return { status: 'blocked', reason: blocked };
  const loaders = tags.loaders;
  const anyIds = Object.values(tags.ids).some((a) => a.length);
  if (!loaders.length && !anyIds) return { status: 'no_google_tags', browserChecked: Boolean(browser && browser.ran) };

  const gtg = loaders.filter((l) => l.serving === 'first_party_path' || l.serving === 'first_party_root');
  const standard = loaders.filter((l) => l.serving === 'google');
  const sgtm = loaders.filter((l) => l.serving === 'first_party_subdomain' || l.serving === 'third_party_proxy');

  const verified = gtg.filter((l) => probes[l.path]?.healthy === true);
  const servesJs = gtg.filter((l) => probes[l.path]?.servesGoogleJs === true);

  if (gtg.length) {
    const base = verified.length ? 'verified' : servesJs.length ? 'serving' : 'unconfirmed';
    if (standard.length) return { status: 'partial', confidence: base, gtgPaths: uniq(gtg.map((l) => l.path)) };
    return { status: 'implemented', confidence: base, gtgPaths: uniq(gtg.map((l) => l.path)) };
  }
  if (sgtm.length) return { status: 'not_implemented', servingMode: 'server_side_tagging' };
  if (standard.length) return { status: 'not_implemented', servingMode: 'google_direct' };
  // A tag ID is on the page but no request for it was seen: we cannot tell where it loads from.
  // Never call this "not set up": without the path there is no health check to prove either way.
  return {
    status: 'unconfirmed',
    servingMode: 'not_in_static_html',
    reason: browser && browser.ran ? 'not_seen_in_browser'
      : browser && browser.error === 'browser_failed' ? 'browser_failed'
      : 'browser_not_run'
  };
}

// ---------- Gateway deployment: which layer serves the measurement path ----------

const GOOGLE_SERVER_HEADER = /google tag manager|^esf$|^sffe$|scaffolding on httpserver2/i;
const CACHE_HEADERS = ['cf-cache-status', 'x-cache', 'akamai-cache-status', 'x-vercel-cache', 'cdn-cache', 'x-cache-status', 'eo-cache-status'];

export function describeGtgDeployment(verdict, probes, siteInfra) {
  if (!['implemented', 'partial'].includes(verdict.status)) return null;
  const paths = verdict.gtgPaths || [];
  const perPath = paths.map((path) => {
    const p = probes[path] || {};
    const h = normalizeHeaders(p.headers || {});
    const fp = p.headers ? fingerprintInfra(h, []) : null;
    const edge = fp && fp.primary ? fp : null;
    const servedBy = edge ? edge.primary : siteInfra.primary || null;
    const basis = edge ? 'gateway_response' : siteInfra.primary ? 'site_infrastructure' : 'unknown';
    const cacheKey = CACHE_HEADERS.find((k) => h[k]);
    return {
      path,
      healthy: p.healthy === true,
      servesGoogleJs: p.servesGoogleJs === true,
      servedBy,
      servedById: edge ? edge.primaryId : siteInfra.primaryId || null,
      basis,
      layers: edge ? edge.stack.filter((x) => x.kind !== 'origin').map((x) => x.name) : siteInfra.layers,
      cacheStatus: cacheKey ? `${cacheKey}: ${String(h[cacheKey]).slice(0, 40)}` : null,
      googleServerHeader: GOOGLE_SERVER_HEADER.test(h.server || '') ? h.server : null,
      differsFromSite: Boolean(edge && siteInfra.primary && edge.primary !== siteInfra.primary),
      signals: edge ? edge.signals.filter((x) => x.points_to) : []
    };
  });
  const main = perPath.find((x) => x.healthy) || perPath[0];
  if (!main) return null;

  let summary;
  if (!main.servedBy) {
    summary = `${main.path} is answered on your domain, but the layer in front of it does not identify itself.`;
  } else if (main.differsFromSite) {
    summary = `Your pages are served by ${siteInfra.primary}, but ${main.path} is answered by ${main.servedBy}, which forwards it to Google.`;
  } else {
    summary = `${main.servedBy} forwards ${main.path} on your domain to Google's tag servers.`;
  }
  if (main.basis === 'site_infrastructure') summary += ' The gateway response itself carried no CDN headers, so this is based on the rest of your site.';

  return { ...main, paths: perPath, summary, sitePrimary: siteInfra.primary || null };
}

// One call that builds the complete report from collected evidence.
export function buildReport(evidence) {
  const { inputUrl, finalUrl, status, headers, html, cnames = [], assetHosts = [], probes = {}, scannedAt, browser = null, network = null } = evidence;
  const tags = extractTags(html, finalUrl, browser && browser.ran ? browser.tagRequests : []);
  const infra = fingerprintInfra(headers, cnames, assetHosts, network);
  const platform = detectPlatform(headers, html);
  const blocked = detectBlock(status, headers, html);
  const verdict = decide({ tags, probes, blocked, browser });
  const route = recommendRoute(infra, platform);
  const host = new URL(finalUrl).hostname;
  const gtg = describeGtgDeployment(verdict, probes, infra);

  const warnings = [];
  if (tags.hardcoded.length) warnings.push({ code: 'hardcoded_tags', ids: tags.hardcoded, text: 'Google tags are hardcoded in the page outside Google Tag Manager. Each one needs its own gateway path or should move into GTM.' });
  if (verdict.status === 'partial') warnings.push({ code: 'partial', text: 'Some Google tags load through your domain, others still load from googletagmanager.com and stay exposed to blockers.' });
  if (verdict.servingMode === 'server_side_tagging') warnings.push({ code: 'sgtm', text: 'Your tags load from a server-side tagging domain. That is first-party serving, but it is not Google tag gateway.' });
  if (verdict.status === 'unconfirmed') {
    const why = verdict.reason === 'not_seen_in_browser'
      ? 'We loaded the page in a browser too, but no Google tag request was made. Tags may wait for cookie consent or load only on other pages.'
      : 'The tag is added by a script after the page loads, and the browser check could not run.';
    warnings.push({ code: 'dynamic', text: `A Google tag ID is on the page, but we could not see where the tag loads from. ${why}` });
  }
  if (tags.loaders.some((l) => l.source === 'browser_network')) warnings.push({ code: 'found_in_browser', text: 'Your Google tag is added by a script after the page loads. We found where it loads from by loading the page in a browser.' });
  if (infra.proxyType === 'asset_only_cdn') warnings.push({ code: 'asset_only', text: 'Your CDN only serves static files from a subdomain. Your main domain is answered by the web server directly.' });
  if (gtg && gtg.differsFromSite) warnings.push({ code: 'split_edge', text: `The gateway path and the rest of your site go through different providers (${gtg.servedBy} and ${gtg.sitePrimary}). That works, but both need to stay in step when either changes.` });
  if (verdict.status === 'implemented' && verdict.confidence !== 'verified') warnings.push({ code: 'unverified', text: 'A first-party tag path was found, but its health check did not answer "ok".' });

  return {
    url: inputUrl,
    finalUrl,
    host,
    scannedAt,
    httpStatus: status,
    verdict,
    tags: { gtm: tags.ids.gtm, ga4: tags.ids.ga4, ads: tags.ids.ads, floodlight: tags.ids.floodlight, googleTag: tags.ids.google_tag, hardcoded: tags.hardcoded, loaders: tags.loaders },
    infra,
    platform,
    route,
    gtg,
    browserCheck: browser ? { ran: Boolean(browser.ran), tagRequestsSeen: (browser.tagRequests || []).length, error: browser.error || null } : null,
    // Raw probe headers stay on the server; only the results leave it.
    probes: Object.fromEntries(Object.entries(probes).map(([k, p]) => [k, { path: p.path, healthy: p.healthy, healthBody: p.healthBody, servesGoogleJs: p.servesGoogleJs }])),
    warnings
  };
}

// The free layer shown before the email gate. Keep this small on purpose.
export function freeSummary(report) {
  return {
    host: report.host,
    status: report.verdict.status,
    confidence: report.verdict.confidence || null,
    servingMode: report.verdict.servingMode || null,
    cdn: report.infra.primary || (report.infra.proxyType === 'asset_only_cdn' ? report.infra.server || 'Web server' : report.infra.server || null),
    hostedOn: report.infra.network && !report.infra.network.isEdge ? report.infra.network.label : null,
    platform: report.platform.name,
    gtgServedBy: report.gtg ? report.gtg.servedBy : null,
    gtgBasis: report.gtg ? report.gtg.basis : null,
    eligible: report.route.eligible,
    tagCount: report.tags.gtm.length + report.tags.ga4.length + report.tags.ads.length,
    issueCount: report.warnings.length,
    blockedReason: report.verdict.status === 'blocked' ? report.verdict.reason : null,
    unconfirmedReason: report.verdict.status === 'unconfirmed' ? report.verdict.reason : null
  };
}
