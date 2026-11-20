// Browser check through Cloudflare Browser Run (Quick Actions REST API, /content).
// Cloudflare's browser loads the page, runs its scripts, and returns the finished HTML. A Google tag that a
// script adds after load is then in that HTML as <script src="…?id=GTM-…">, which reveals the gateway path;
// the normal /<path>/healthy probe confirms it.
//
// Free plan (Nov 2026): 10 minutes of browser time a day and one Quick Actions request every 10 seconds per
// account. So it runs only when the plain HTML cannot settle the answer, is spaced out, and on any refusal the
// result simply stays "could not confirm".
// Needs: Worker variable BROWSER_ACCOUNT_ID and secret BROWSER_API_TOKEN (token permission "Browser Rendering - Edit").

const TAG_ID = /^(GTM-[A-Z0-9]{4,10}|G-[A-Z0-9]{6,12}|AW-\d{6,12}|DC-\d{6,12}|GT-[A-Z0-9]{6,12})$/i;
const MIN_GAP_MS = 10_500;
let lastCall = 0;

export function isTagRequest(rawUrl) {
  let u;
  try { u = new URL(rawUrl); } catch { return false; }
  if (TAG_ID.test(u.searchParams.get('id') || '')) return true;
  return /\/(gtm\.js|gtag\/js)$/.test(u.pathname) && /googletagmanager\.com$/i.test(u.hostname);
}

// Script sources in rendered HTML that are Google tag loaders, as absolute URLs.
// One light regex pass: rendered pages can be large and the free plan allows ~10 ms CPU.
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

export function browserConfigured(env = {}) {
  return Boolean(env.BROWSER_ACCOUNT_ID && env.BROWSER_API_TOKEN && String(env.BROWSER_CHECK || 'true').toLowerCase() !== 'false');
}

export async function browserTagRequests(url, env, fetchImpl = fetch, now = Date.now) {
  if (!browserConfigured(env)) return { ran: false, error: 'browser_not_configured', tagRequests: [] };
  if (now() - lastCall < MIN_GAP_MS) return { ran: false, error: 'browser_busy', tagRequests: [] };
  lastCall = now();
  let res;
  try {
    res = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${env.BROWSER_ACCOUNT_ID}/browser-rendering/content`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.BROWSER_API_TOKEN}` },
      body: JSON.stringify({
        url,
        gotoOptions: { waitUntil: 'networkidle2', timeout: 20000 },
        rejectResourceTypes: ['image', 'media', 'font', 'stylesheet']
      }),
      signal: AbortSignal.timeout(25000)
    });
  } catch { return { ran: false, error: 'browser_failed', tagRequests: [] }; }
  if (res.status === 429) return { ran: false, error: 'browser_limit', tagRequests: [] };
  if (!res.ok) return { ran: false, error: 'browser_failed', status: res.status, tagRequests: [] };
  let html = '';
  const type = res.headers.get('content-type') || '';
  try {
    if (type.includes('application/json')) {
      const data = await res.json();
      if (data && data.success === false) return { ran: false, error: 'browser_failed', tagRequests: [] };
      html = typeof data.result === 'string' ? data.result : '';
    } else {
      html = await res.text();
    }
  } catch { return { ran: false, error: 'browser_failed', tagRequests: [] }; }
  return { ran: true, tagRequests: tagRequestsFromHtml(html, url) };
}
