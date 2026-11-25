// Browser check through Cloudflare Browser Run (Quick Actions REST API, /content).
// Cloudflare's browser loads the page, then runs our in-page probe (engine/probe.js) inside it: the probe
// accepts the cookie banner, records every Google tag request whatever loaded it (GTM, Tealium, Adobe Launch,
// hand-written code), and calls /<path>/healthy from inside the page. It writes its result into the page as
// JSON, which comes back with the rendered HTML.
//
// Browser Run is always identified to websites as a bot, so strong bot protection (Akamai, Qrator, Myra...)
// may still block it. Then the visitor's own browser is the way to check (the bookmarklet on the result page).
//
// Free plan (Nov 2026): 10 minutes of browser time a day and one Quick Actions request every 10 seconds per
// account. It runs only when the plain HTML cannot settle the answer, and on any refusal the result keeps
// whatever the plain scan found.
// Needs: Worker variable BROWSER_ACCOUNT_ID and secret BROWSER_API_TOKEN (token permission "Browser Run: Edit").
import { serverProbeScript } from '../../engine/probe.js';

const TAG_ID = /^(GTM-[A-Z0-9]{4,10}|G-[A-Z0-9]{6,12}|AW-\d{6,12}|DC-\d{6,12}|GT-[A-Z0-9]{6,12})$/i;
const MIN_GAP_MS = 10_500;
const PROBE_MARK = 'id="dh-gtg-probe">';
let lastCall = 0;
let probeSource = null;

export function isTagRequest(rawUrl) {
  let u;
  try { u = new URL(rawUrl); } catch { return false; }
  if (TAG_ID.test(u.searchParams.get('id') || '')) return true;
  return /\/(gtm\.js|gtag\/js)$/.test(u.pathname) && /googletagmanager\.com$/i.test(u.hostname);
}

// Script sources in rendered HTML that are Google tag loaders, as absolute URLs. Used when the probe
// could not run (for example a strict Content-Security-Policy blocked it).
export function tagRequestsFromHtml(html, pageUrl) {
  const out = new Set();
  const re = /<script\b[^>]*\bsrc\s*=\s*(["'])([^"']+)\1/gi;
  const text = String(html || '').slice(0, 1_500_000);
  let m;
  while ((m = re.exec(text))) {
    let abs;
    try { abs = new URL(m[2].replace(/&amp;/g, '&'), pageUrl).href; } catch { continue; }
    if (isTagRequest(abs)) out.add(abs);
    if (out.size >= 20) break;
  }
  return [...out];
}

// The probe's JSON, found by its marker without scanning the whole page with a regex (CPU is tight).
export function probeFromHtml(html) {
  const text = String(html || '');
  const start = text.lastIndexOf(PROBE_MARK);
  if (start < 0) return null;
  const end = text.indexOf('</script>', start);
  if (end < 0) return null;
  try { return JSON.parse(text.slice(start + PROBE_MARK.length, end)); } catch { return null; }
}

export function browserConfigured(env = {}) {
  return Boolean(env.BROWSER_ACCOUNT_ID && env.BROWSER_API_TOKEN && String(env.BROWSER_CHECK || 'true').toLowerCase() !== 'false');
}

export async function browserTagRequests(url, env, fetchImpl = fetch, now = Date.now) {
  if (!browserConfigured(env)) return { ran: false, error: 'browser_not_configured', tagRequests: [] };
  if (now() - lastCall < MIN_GAP_MS) return { ran: false, error: 'browser_busy', tagRequests: [] };
  lastCall = now();
  if (!probeSource) probeSource = serverProbeScript();
  let res;
  try {
    res = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${env.BROWSER_ACCOUNT_ID}/browser-rendering/content`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.BROWSER_API_TOKEN}` },
      body: JSON.stringify({
        url,
        gotoOptions: { waitUntil: 'networkidle2', timeout: 20000 },
        bestAttempt: true,
        // Images, fonts and styles are not needed to see tag requests; skipping them saves browser time.
        rejectResourceTypes: ['image', 'media', 'font'],
        addScriptTag: [{ content: probeSource }],
        waitForSelector: { selector: '#dh-gtg-probe', timeout: 20000 },
        actionTimeout: 45000
      }),
      signal: AbortSignal.timeout(50000)
    });
  } catch { return { ran: false, error: 'browser_failed', tagRequests: [] }; }
  if (res.status === 429) return { ran: false, error: 'browser_limit', tagRequests: [] };
  let html = '';
  let pageStatus = 0;
  const type = res.headers.get('content-type') || '';
  try {
    if (type.includes('application/json')) {
      const data = await res.json();
      pageStatus = Number(data && data.meta && data.meta.status) || 0;
      html = data && typeof data.result === 'string' ? data.result : '';
      if (!html && data && data.success === false) return { ran: false, error: res.status === 429 ? 'browser_limit' : 'browser_failed', tagRequests: [] };
    } else {
      if (!res.ok) return { ran: false, error: 'browser_failed', status: res.status, tagRequests: [] };
      html = await res.text();
    }
  } catch { return { ran: false, error: 'browser_failed', tagRequests: [] }; }

  const probe = probeFromHtml(html);
  if (!probe && (pageStatus === 401 || pageStatus === 403 || pageStatus === 429 || pageStatus === 503)) {
    return { ran: false, error: 'browser_blocked', status: pageStatus, tagRequests: [] };
  }
  return { ran: true, probe, tagRequests: probe ? [] : tagRequestsFromHtml(html, url) };
}
