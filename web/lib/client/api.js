// Calls the scanner API (the Cloudflare Worker). Its address is set at build time.
const BASE = (process.env.NEXT_PUBLIC_API_BASE || '').replace(/\/$/, '');
export const API_CONFIGURED = Boolean(BASE);

async function post(path, body) {
  if (!BASE) throw { code: 'not_configured', message: 'The checker is not connected to its scanner yet. Set NEXT_PUBLIC_API_BASE and rebuild.' };
  let res;
  try {
    res = await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw { code: 'network', message: 'We could not reach the checker. Check your connection and try again.' };
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw { code: data.error || 'error', message: data.message || 'Something went wrong. Try again in a minute.' };
  return data;
}

// probe: a result from the "check from your browser" script, sent only when the visitor ran it.
export const scanSite = (url, turnstileToken, probe) => post('/api/scan', { url, turnstileToken, ...(probe ? { probe } : {}) });
export const submitLead = ({ url, lead, utm, probe }) => post('/api/lead', { url, ...lead, utm, page: window.location.href, ...(probe ? { probe } : {}) });

// Reads a result the browser check put after #probe= in the address, then removes it from the address bar.
export function takeProbeFromHash() {
  try {
    const m = window.location.hash.match(/^#probe=([A-Za-z0-9_-]+)$/);
    if (!m) return null;
    history.replaceState(null, '', window.location.pathname + window.location.search);
    const b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(escape(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))));
    const probe = JSON.parse(json);
    return probe && probe.v === 1 && typeof probe.host === 'string' ? probe : null;
  } catch { return null; }
}
